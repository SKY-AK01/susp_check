"""
Comparison engine dispatcher — §9.4.
Selects box_matching or polygon_matching based on the project's per-label
geometry type configuration.  All per-project branching lives here and
only here; neither geometry module knows about the other.

Entry point:  compare_image_pair(...)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

from comparison_engine.box_matching.matcher import (
    BoxThresholds, match_boxes,
    ShapeMatchResult as BoxMatchResult,
)
from comparison_engine.polygon_matching.matcher import (
    PolygonThresholds, match_polygons,
    ShapeMatchResult as PolyMatchResult,
)
from comparison_engine.shared.verdict import Verdict, rollup_verdicts
from comparison_engine.shared.scoring import ScoringWeights, compute_image_score


@dataclass
class ProjectComparisonConfig:
    """
    All comparison parameters for one project — §9.5, FR-6.3.
    All values are project-configurable; these are the defaults from §.env.
    """
    # Geometry type for this project's labels: "box" | "polygon"
    # Projects can mix geometry types per label; dispatcher checks per label.
    default_geometry_type: str = "box"

    # Per-label geometry type override: label_name → "box" | "polygon"
    label_geometry_types: dict[str, str] = field(default_factory=dict)

    # Per-label attribute types: label_name → {attr_name → value_type}
    label_attribute_types: dict[str, dict[str, str]] = field(default_factory=dict)

    # Grouping key attribute name per label (e.g. "vehicle_id") — §9.3
    grouping_key_by_label: dict[str, str] = field(default_factory=dict)

    box_thresholds: BoxThresholds = field(default_factory=BoxThresholds)
    polygon_thresholds: PolygonThresholds = field(default_factory=PolygonThresholds)
    ocr_minor_threshold: int = 1
    scoring_weights: ScoringWeights = field(default_factory=ScoringWeights)


@dataclass
class ImageComparisonResult:
    """Result for one (reference_image, student_image) pair."""
    reference_image_id: Optional[str]
    student_image_id: str
    verdict: Verdict
    score: Optional[float]
    shape_results: list  # list[BoxMatchResult | PolyMatchResult]


def _get_geometry_type(label_name: str, config: ProjectComparisonConfig) -> str:
    return config.label_geometry_types.get(label_name, config.default_geometry_type)


def _group_shapes_by_geometry(
    shapes: list[dict],
    config: ProjectComparisonConfig,
) -> tuple[list[dict], list[dict]]:
    """Split a flat shape list into box-type and polygon-type sub-lists."""
    boxes = [s for s in shapes if _get_geometry_type(s["label_name"], config) == "box"]
    polys = [s for s in shapes if _get_geometry_type(s["label_name"], config) == "polygon"]
    return boxes, polys


def _apply_grouping(shapes: list[dict], config: ProjectComparisonConfig) -> list[dict]:
    """
    Shape grouping via linking attributes (§9.3).
    Attaches the group_value from the configured grouping-key attribute onto
    each shape dict so the matcher can use it for intra-group assignment.
    For now this is a pass-through that ensures group_value is populated;
    the matchers already handle the vehicle_id-within-image grouping via
    label separation — this step would extend to cross-label group handling
    in a future iteration.
    """
    for shape in shapes:
        label = shape.get("label_name", "")
        gk = config.grouping_key_by_label.get(label)
        if gk and gk in shape.get("attributes", {}):
            shape["group_value"] = shape["attributes"][gk]
    return shapes


def compare_image_pair(
    ref_shapes: list[dict],
    student_shapes: list[dict],
    ref_tags: set[str],
    student_image_id: str,
    reference_image_id: Optional[str],
    config: ProjectComparisonConfig,
    handle_missing_image: bool = False,
) -> ImageComparisonResult:
    """
    Core dispatcher: compare one reference image's shapes against one student
    image's shapes.  Returns an ImageComparisonResult.

    handle_missing_image=True: student image has no reference match → Extra verdict.
    """
    if handle_missing_image:
        return ImageComparisonResult(
            reference_image_id=None,
            student_image_id=student_image_id,
            verdict=Verdict.extra,
            score=None,
            shape_results=[],
        )

    # Apply grouping annotation (§9.3)
    ref_shapes = _apply_grouping(list(ref_shapes), config)
    student_shapes = _apply_grouping(list(student_shapes), config)

    # Split by geometry type and run appropriate matcher
    ref_boxes, ref_polys = _group_shapes_by_geometry(ref_shapes, config)
    stu_boxes, stu_polys = _group_shapes_by_geometry(student_shapes, config)

    all_shape_results: list = []

    if ref_boxes or stu_boxes:
        box_results = match_boxes(
            ref_shapes=ref_boxes,
            student_shapes=stu_boxes,
            label_attribute_types=config.label_attribute_types,
            thresholds=config.box_thresholds,
            ocr_minor_threshold=config.ocr_minor_threshold,
            ref_tags=ref_tags,
        )
        all_shape_results.extend(box_results)

    if ref_polys or stu_polys:
        poly_results = match_polygons(
            ref_shapes=ref_polys,
            student_shapes=stu_polys,
            label_attribute_types=config.label_attribute_types,
            thresholds=config.polygon_thresholds,
            ocr_minor_threshold=config.ocr_minor_threshold,
            ref_tags=ref_tags,
        )
        all_shape_results.extend(poly_results)

    # Handle reference image with zero annotations — §9.7
    if not ref_shapes and not student_shapes:
        verdicts_list = [Verdict.exact_match]
    elif not ref_shapes and student_shapes:
        # Reference has zero annotations; student has some → Extra per §9.7
        verdicts_list = [Verdict.extra]
    else:
        verdicts_list = [r.verdict for r in all_shape_results]

    image_verdict = rollup_verdicts(verdicts_list)

    # Mirror-Image / Rotated tags → Needs Manual Review regardless of geometry — §9.7
    if ref_tags & {"Mirror-Image", "Rotated"}:
        image_verdict = Verdict.needs_manual_review

    # Compute numeric score
    shape_ious = [r.iou_score for r in all_shape_results]
    attr_mismatch_count = sum(
        sum(1 for d in getattr(r, "attribute_diffs", []) if d.verdict != Verdict.exact_match)
        for r in all_shape_results
    )
    score = compute_image_score(
        shape_ious=shape_ious,
        shape_verdicts=verdicts_list,
        attr_mismatch_count=attr_mismatch_count,
        weights=config.scoring_weights,
    )

    return ImageComparisonResult(
        reference_image_id=reference_image_id,
        student_image_id=student_image_id,
        verdict=image_verdict,
        score=score,
        shape_results=all_shape_results,
    )
