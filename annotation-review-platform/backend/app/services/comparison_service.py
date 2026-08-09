"""
Comparison service — bridges the DB / task layer to the comparison engine.
Called by comparison Celery tasks (§8.3).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import structlog
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.comparison import (
    ComparisonResult, ComparisonRun, ReferenceSet, ReferenceSourceType,
    ReviewStatus, RunStatus, ShapeDiff, Verdict,
)
from app.models.image import Image, Shape, ShapeAttribute, Tag
from app.models.project import Label, LabelAttribute, LabelSchema, Project, AttributeValueType
from app.models.student import Student
from comparison_engine.dispatcher import (
    ProjectComparisonConfig, compare_image_pair,
)
from comparison_engine.box_matching.matcher import BoxThresholds
from comparison_engine.polygon_matching.matcher import PolygonThresholds
from comparison_engine.shared.scoring import ScoringWeights

logger = structlog.get_logger(__name__)


def build_project_config(db: Session, project: Project) -> ProjectComparisonConfig:
    """
    Load per-project thresholds + label schema into ProjectComparisonConfig — §9.5, FR-6.3.
    Falls back to system defaults when project overrides are None.
    """
    # Latest label schema
    schema_stmt = (
        select(LabelSchema)
        .where(LabelSchema.project_id == project.id)
        .order_by(LabelSchema.version.desc())
    )
    schema = db.execute(schema_stmt).scalar_one_or_none()

    label_geometry_types: dict[str, str] = {}
    label_attribute_types: dict[str, dict[str, str]] = {}
    grouping_key_by_label: dict[str, str] = {}

    if schema:
        for label in schema.labels:
            label_geometry_types[label.name] = label.geometry_type
            attr_types: dict[str, str] = {}
            for attr in label.attributes:
                attr_types[attr.name] = attr.value_type
                if attr.is_grouping_key:
                    grouping_key_by_label[label.name] = attr.name
            label_attribute_types[label.name] = attr_types

    box_thresh = BoxThresholds(
        iou_exact=project.box_iou_exact or settings.default_box_iou_exact,
        iou_minor=project.box_iou_minor or settings.default_box_iou_minor,
    )
    poly_thresh = PolygonThresholds(
        iou_exact=project.polygon_iou_exact or settings.default_polygon_iou_exact,
        iou_minor=project.polygon_iou_minor or settings.default_polygon_iou_minor,
    )

    return ProjectComparisonConfig(
        default_geometry_type="box",
        label_geometry_types=label_geometry_types,
        label_attribute_types=label_attribute_types,
        grouping_key_by_label=grouping_key_by_label,
        box_thresholds=box_thresh,
        polygon_thresholds=poly_thresh,
        ocr_minor_threshold=project.ocr_edit_distance_minor or settings.default_ocr_edit_distance_minor,
    )


def load_image_shapes(db: Session, image_id: uuid.UUID) -> list[dict]:
    """
    Load shapes + attributes for one image into the dict format expected
    by the comparison engine dispatcher.
    """
    shapes_stmt = select(Shape).where(Shape.image_id == image_id)
    shapes = db.execute(shapes_stmt).scalars().all()

    result = []
    for s in shapes:
        attrs_stmt = select(ShapeAttribute).where(ShapeAttribute.shape_id == s.id)
        attrs = db.execute(attrs_stmt).scalars().all()
        result.append({
            "id": str(s.id),
            "label_name": s.label_name or "",
            "type": s.type,
            "geometry": s.geometry,
            "group_value": s.group_value,
            "attributes": {a.name: a.value for a in attrs},
            "geometry_invalid": s.geometry_invalid,
        })
    return result


def load_image_tags(db: Session, image_id: uuid.UUID) -> set[str]:
    """Load frame-level tag names for one image."""
    tags_stmt = select(Tag).where(Tag.image_id == image_id)
    tags = db.execute(tags_stmt).scalars().all()
    return {t.name for t in tags}


def resolve_reference_images(
    db: Session,
    ref_set: ReferenceSet,
    project_id: uuid.UUID,
) -> dict[str, uuid.UUID]:
    """
    Build normalized_key → reference_image_id index — §9.2.
    Used as an O(1) lookup during per-student comparison.
    """
    if ref_set.source_type == ReferenceSourceType.uploaded_gt:
        stmt = select(Image).where(
            Image.upload_id == ref_set.reference_upload_id,
            Image.project_id == project_id,
        )
    else:
        # Student reference — only this student's images in the upload
        stmt = select(Image).where(
            Image.student_id == ref_set.reference_student_id,
            Image.project_id == project_id,
        )

    images = db.execute(stmt).scalars().all()
    return {img.normalized_key: img.id for img in images}


def compare_student(
    db: Session,
    run: ComparisonRun,
    student: Student,
    ref_image_index: dict[str, uuid.UUID],
    config: ProjectComparisonConfig,
) -> None:
    """
    Compare all images for one student against the reference index.
    Writes ComparisonResult + ShapeDiff rows in batches — §8.3.4.
    """
    student_images_stmt = select(Image).where(
        Image.upload_id == run.upload_id,
        Image.student_id == student.id,
    )
    student_images = db.execute(student_images_stmt).scalars().all()

    for img in student_images:
        # Idempotent — skip if already computed for this run/student/image
        existing_stmt = select(ComparisonResult).where(
            ComparisonResult.run_id == run.id,
            ComparisonResult.student_id == student.id,
            ComparisonResult.student_image_id == img.id,
        )
        if db.execute(existing_stmt).scalar_one_or_none():
            continue

        ref_image_id = ref_image_index.get(img.normalized_key)

        if ref_image_id is None:
            # Student has an image with no reference match → Extra
            result = ComparisonResult(
                run_id=run.id,
                student_id=student.id,
                student_image_id=img.id,
                reference_image_id=None,
                verdict=Verdict.extra,
                score=None,
                review_status=ReviewStatus.open,
            )
            db.add(result)
            db.commit()
            continue

        ref_shapes = load_image_shapes(db, ref_image_id)
        student_shapes = load_image_shapes(db, img.id)
        ref_tags = load_image_tags(db, ref_image_id)

        engine_result = compare_image_pair(
            ref_shapes=ref_shapes,
            student_shapes=student_shapes,
            ref_tags=ref_tags,
            student_image_id=str(img.id),
            reference_image_id=str(ref_image_id),
            config=config,
        )

        result = ComparisonResult(
            run_id=run.id,
            student_id=student.id,
            student_image_id=img.id,
            reference_image_id=ref_image_id,
            verdict=Verdict(engine_result.verdict.value),
            score=engine_result.score,
            review_status=ReviewStatus.open,
        )
        db.add(result)
        db.flush()

        for sr in engine_result.shape_results:
            attr_diffs_payload = None
            if hasattr(sr, "attribute_diffs") and sr.attribute_diffs:
                attr_diffs_payload = [
                    {
                        "name": d.name,
                        "ref_value": d.ref_value,
                        "student_value": d.student_value,
                        "edit_distance": d.edit_distance,
                        "verdict": d.verdict.value,
                    }
                    for d in sr.attribute_diffs
                ]
            diff = ShapeDiff(
                comparison_result_id=result.id,
                reference_shape_id=uuid.UUID(sr.reference_shape_id) if sr.reference_shape_id else None,
                student_shape_id=uuid.UUID(sr.student_shape_id) if sr.student_shape_id else None,
                verdict=Verdict(sr.verdict.value),
                iou_score=sr.iou_score,
                attribute_diffs=attr_diffs_payload,
            )
            db.add(diff)

        db.commit()

    # Handle reference images the student didn't submit → Missing (§9.2)
    student_normalized_keys = {img.normalized_key for img in student_images}
    for ref_key, ref_image_id in ref_image_index.items():
        if ref_key not in student_normalized_keys:
            ref_img_stmt = select(Image).where(Image.id == ref_image_id)
            ref_img = db.execute(ref_img_stmt).scalar_one_or_none()
            if ref_img is None:
                continue
            # Create a synthetic "missing" student image placeholder entry
            # via a ComparisonResult with null student_image_id is not allowed
            # by schema (NOT NULL); instead we flag the result differently.
            # Per §9.2: image-level Missing = student didn't submit this image at all.
            # We store it as a result with student_image_id = the ref image's id
            # and a distinct "image_missing" flag encoded as Verdict.missing.
            existing_stmt = select(ComparisonResult).where(
                ComparisonResult.run_id == run.id,
                ComparisonResult.student_id == student.id,
                ComparisonResult.reference_image_id == ref_image_id,
                ComparisonResult.verdict == Verdict.missing,
            )
            if db.execute(existing_stmt).scalar_one_or_none():
                continue
            result = ComparisonResult(
                run_id=run.id,
                student_id=student.id,
                student_image_id=ref_image_id,   # use ref id as placeholder
                reference_image_id=ref_image_id,
                verdict=Verdict.missing,
                score=0.0,
                review_status=ReviewStatus.open,
            )
            db.add(result)

    db.commit()
