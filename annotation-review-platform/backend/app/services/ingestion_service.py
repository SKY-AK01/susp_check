"""
CVAT XML ingestion service — §5, §6.3, §8.2.
Implements:
- Two-pass incremental XML parsing (SAX-style iterparse, never full DOM load)
- Streaming ZIP extraction (never full decompression to disk)
- Batch DB writes (configurable batch size)
- Idempotent student/image upserts
- ParseWarning emission for per-element errors (non-fatal)
- Image content-hash dedup (§12.3)
- Pluggable parser interface (FR-3.6 / NG5)
"""
from __future__ import annotations

import gzip
import hashlib
import io
import os
import re
import shutil
import uuid
import zipfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Generator, Optional

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.feedback import ParseWarning, ParseWarningSeverity
from app.models.image import Image, Shape, ShapeAttribute, Tag
from app.models.project import Label, LabelSchema
from app.models.student import Student
from app.models.upload import Upload, UploadStatus

logger = structlog.get_logger(__name__)

# ── Normalisation helpers — §5.3, §9.2 ───────────────────────────────────────

_TRAILING_INT_RE = re.compile(r"_(\d+)$")


def normalize_image_key(filename: str) -> str:
    """
    Strip path, extension, lowercase, and strip optional trailing _<integer> — §5.3.
    e.g. "FLEXI_BATCH/images/Coupe_000015_2.jpg" → "coupe_000015"
    """
    basename = os.path.splitext(os.path.basename(filename))[0]
    basename = basename.lower()
    basename = _TRAILING_INT_RE.sub("", basename)
    return basename


# ── Pluggable parser interface — FR-3.6 ───────────────────────────────────────

@dataclass
class ParsedTask:
    task_id: int
    name: str
    assignee_username: Optional[str]
    assignee_email: Optional[str]
    owner_username: Optional[str]
    size: Optional[int]
    start_frame: Optional[int]
    stop_frame: Optional[int]


@dataclass
class ParsedAttribute:
    name: str
    value: str


@dataclass
class ParsedShape:
    type: str           # "box" | "polygon"
    label_name: str
    geometry: dict
    group_value: Optional[str]
    attributes: list[ParsedAttribute]
    occluded: bool = False
    z_order: int = 0


@dataclass
class ParsedTag:
    name: str


@dataclass
class ParsedImage:
    task_id: int
    raw_filename: str
    normalized_key: str
    width: Optional[int]
    height: Optional[int]
    shapes: list[ParsedShape]
    tags: list[ParsedTag]


@dataclass
class ParsedLabel:
    name: str
    geometry_type: str  # "box" | "polygon"
    attributes: list[dict]


@dataclass
class ParsedMeta:
    project_id: Optional[int]
    project_name: Optional[str]
    tasks: list[ParsedTask]
    labels: list[ParsedLabel]


class AnnotationFormatParser(ABC):
    """
    Pluggable parser interface — FR-3.6.
    A new format (COCO, YOLO) adds a subclass without touching orchestration.
    """

    @abstractmethod
    def parse_meta(self, xml_path: str) -> ParsedMeta:
        """Parse metadata (tasks + labels) from the annotation file."""

    @abstractmethod
    def stream_images(
        self, xml_path: str, batch_size: int
    ) -> Generator[list[ParsedImage], None, None]:
        """Yield batches of ParsedImage from the annotation file."""


# ── CVAT XML parser — §5.1, FR-3.2, FR-3.3 ────────────────────────────────────

class CVATXMLParser(AnnotationFormatParser):
    """
    Two-pass incremental CVAT 1.1 XML parser.
    Pass 1: reads <meta><project> fully (small, safe to hold in memory).
    Pass 2: streams <image> elements one at a time via iterparse.
    """

    def parse_meta(self, xml_path: str) -> ParsedMeta:
        """Pass 1 — parse <meta><project><tasks> and <labels>."""
        from lxml import etree

        tasks: list[ParsedTask] = []
        labels: list[ParsedLabel] = []
        project_id: Optional[int] = None
        project_name: Optional[str] = None

        context = etree.iterparse(xml_path, events=("end",), tag="meta")
        for _event, meta_el in context:
            project_el = meta_el.find("project")
            if project_el is not None:
                pid = project_el.findtext("id")
                project_id = int(pid) if pid else None
                project_name = project_el.findtext("name")

                for task_el in project_el.findall(".//task"):
                    tid = task_el.findtext("id")
                    if tid is None:
                        continue
                    assignee_el = task_el.find("assignee")
                    owner_el = task_el.find("owner")
                    size_txt = task_el.findtext("size")
                    sf_txt = task_el.findtext("start_frame")
                    stf_txt = task_el.findtext("stop_frame")
                    tasks.append(ParsedTask(
                        task_id=int(tid),
                        name=task_el.findtext("name") or "",
                        assignee_username=(assignee_el.findtext("username") if assignee_el is not None else None),
                        assignee_email=(assignee_el.findtext("email") if assignee_el is not None else None),
                        owner_username=(owner_el.findtext("username") if owner_el is not None else None),
                        size=int(size_txt) if size_txt else None,
                        start_frame=int(sf_txt) if sf_txt else None,
                        stop_frame=int(stf_txt) if stf_txt else None,
                    ))

                for label_el in project_el.findall(".//labels/label"):
                    lname = label_el.findtext("name") or ""
                    attrs = []
                    for attr_el in label_el.findall(".//attribute"):
                        attrs.append({
                            "name": attr_el.findtext("name") or "",
                            "input_type": attr_el.findtext("input_type") or "text",
                            "values": [v.text for v in attr_el.findall("values/value") if v.text],
                        })
                    # Geometry type inferred from first <box> or <polygon> we'll see;
                    # here we set a placeholder — corrected per shape during Pass 2.
                    labels.append(ParsedLabel(name=lname, geometry_type="unknown", attributes=attrs))

            meta_el.clear()
            break  # Only one <meta> element

        return ParsedMeta(
            project_id=project_id,
            project_name=project_name,
            tasks=tasks,
            labels=labels,
        )

    def stream_images(
        self, xml_path: str, batch_size: int = 500
    ) -> Generator[list[ParsedImage], None, None]:
        """
        Pass 2 — stream <image> elements, yielding them in batches of batch_size.
        Each element is cleared from memory after processing — §13.3.
        """
        from lxml import etree

        batch: list[ParsedImage] = []

        for event, elem in etree.iterparse(xml_path, events=("end",), tag="image"):
            try:
                parsed = self._parse_image_element(elem)
                if parsed is not None:
                    batch.append(parsed)
                if len(batch) >= batch_size:
                    yield batch
                    batch = []
            except Exception as exc:
                logger.warning("image_parse_error", error=str(exc),
                               filename=elem.get("name", "?"))
            finally:
                elem.clear()

        if batch:
            yield batch

    @staticmethod
    def _parse_image_element(elem) -> Optional[ParsedImage]:
        """Parse one <image> element into a ParsedImage."""
        task_id_str = elem.get("task_id")
        if not task_id_str:
            raise ValueError("Missing task_id attribute on <image>")
        task_id = int(task_id_str)

        raw_filename = elem.get("name", "")
        width_str = elem.get("width")
        height_str = elem.get("height")

        shapes: list[ParsedShape] = []
        tags: list[ParsedTag] = []

        for child in elem:
            tag = child.tag
            if tag == "box":
                shapes.append(CVATXMLParser._parse_box(child))
            elif tag == "polygon":
                shapes.append(CVATXMLParser._parse_polygon(child))
            elif tag == "tag":
                tag_label = child.get("label", "")
                if tag_label:
                    tags.append(ParsedTag(name=tag_label))

        return ParsedImage(
            task_id=task_id,
            raw_filename=raw_filename,
            normalized_key=normalize_image_key(raw_filename),
            width=int(width_str) if width_str else None,
            height=int(height_str) if height_str else None,
            shapes=shapes,
            tags=tags,
        )

    @staticmethod
    def _parse_box(elem) -> ParsedShape:
        label_name = elem.get("label", "")
        attributes = CVATXMLParser._parse_shape_attributes(elem)
        group_value = next((a.value for a in attributes if a.name == "vehicle_id"), None)
        return ParsedShape(
            type="box",
            label_name=label_name,
            geometry={
                "xtl": float(elem.get("xtl", 0)),
                "ytl": float(elem.get("ytl", 0)),
                "xbr": float(elem.get("xbr", 0)),
                "ybr": float(elem.get("ybr", 0)),
            },
            group_value=group_value,
            attributes=attributes,
            occluded=elem.get("occluded", "0") == "1",
            z_order=int(elem.get("z_order", 0)),
        )

    @staticmethod
    def _parse_polygon(elem) -> ParsedShape:
        label_name = elem.get("label", "")
        points_str = elem.get("points", "")
        points = []
        for pt in points_str.split(";"):
            pt = pt.strip()
            if pt:
                x, y = pt.split(",")
                points.append([float(x), float(y)])
        attributes = CVATXMLParser._parse_shape_attributes(elem)
        group_value = next((a.value for a in attributes if a.name == "vehicle_id"), None)
        return ParsedShape(
            type="polygon",
            label_name=label_name,
            geometry={"points": points},
            group_value=group_value,
            attributes=attributes,
            occluded=elem.get("occluded", "0") == "1",
            z_order=int(elem.get("z_order", 0)),
        )

    @staticmethod
    def _parse_shape_attributes(elem) -> list[ParsedAttribute]:
        attrs = []
        for attr_el in elem.findall("attribute"):
            name = attr_el.get("name", "")
            value = attr_el.text or ""
            attrs.append(ParsedAttribute(name=name, value=value))
        return attrs


# ── Storage helpers — §12.2, §12.3 ───────────────────────────────────────────

def content_hash_and_store(image_bytes: bytes, original_filename: str) -> tuple[str, str]:
    """
    Compute SHA-256 of image bytes, derive storage path, write if new.
    Returns (content_hash, storage_ref).
    storage_ref is relative to DATA_DIR/images/ — §22.2.
    """
    content_hash = hashlib.sha256(image_bytes).hexdigest()
    ext = os.path.splitext(original_filename)[1].lower() or ".jpg"
    # Content-addressed path: {hash[0:2]}/{hash}.{ext}
    rel_path = os.path.join(content_hash[:2], f"{content_hash}{ext}")
    full_path = os.path.join(settings.images_dir, rel_path)

    if not os.path.exists(full_path):
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as f:
            f.write(image_bytes)

    return content_hash, rel_path


# ── Batch DB writer — §8.2, §13.4 ────────────────────────────────────────────

def persist_meta(
    db: Session,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
    parsed_meta: ParsedMeta,
    is_reference: bool,
) -> dict[int, uuid.UUID]:
    """
    Persist students from parsed meta.  Returns {cvat_task_id: student_id}.
    Uses upsert semantics — idempotent per FR-4.2.
    """
    task_to_student: dict[int, uuid.UUID] = {}

    for task in parsed_meta.tasks:
        # Upsert: find existing or create — keyed by (project_id, cvat_task_id)
        stmt = select(Student).where(
            Student.project_id == project_id,
            Student.cvat_task_id == task.task_id,
        )
        result = db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # FR-4.4: warn if assignee changed
            if existing.username and task.assignee_username and \
               existing.username != task.assignee_username:
                logger.warning(
                    "task_assignee_changed",
                    cvat_task_id=task.task_id,
                    old=existing.username,
                    new=task.assignee_username,
                )
            student_id = existing.id
        else:
            student = Student(
                project_id=project_id,
                cvat_task_id=task.task_id,
                display_name=task.name,
                username=task.assignee_username,
                email=task.assignee_email,
                task_size=task.size,
                start_frame=task.start_frame,
                stop_frame=task.stop_frame,
            )
            db.add(student)
            db.flush()
            student_id = student.id

        task_to_student[task.task_id] = student_id

    db.commit()
    return task_to_student


def persist_image_batch(
    db: Session,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
    task_to_student: dict[int, uuid.UUID],
    label_name_to_id: dict[str, uuid.UUID],
    image_batch: list[ParsedImage],
    is_reference: bool,
) -> list[ParseWarning]:
    """
    Batch-write images, shapes, shape_attributes, tags to DB.
    Returns any ParseWarning objects to persist separately.
    Idempotent via unique (project_id, upload_id, normalized_key, student_id).
    """
    warnings: list[ParseWarning] = []

    for parsed_img in image_batch:
        student_id = task_to_student.get(parsed_img.task_id) if not is_reference else None

        if not is_reference and student_id is None:
            warnings.append(ParseWarning(
                upload_id=upload_id,
                severity=ParseWarningSeverity.error,
                message=f"task_id={parsed_img.task_id} not found in task map; image '{parsed_img.raw_filename}' skipped.",
            ))
            continue

        # Check duplicate (idempotent re-ingest)
        stmt = select(Image).where(
            Image.project_id == project_id,
            Image.upload_id == upload_id,
            Image.normalized_key == parsed_img.normalized_key,
            Image.student_id == student_id,
        )
        existing = db.execute(stmt).scalar_one_or_none()
        if existing:
            continue  # already ingested in a prior run of this upload

        img = Image(
            project_id=project_id,
            upload_id=upload_id,
            student_id=student_id,
            raw_filename=parsed_img.raw_filename,
            normalized_key=parsed_img.normalized_key,
            width=parsed_img.width,
            height=parsed_img.height,
        )
        db.add(img)
        db.flush()  # get img.id

        for parsed_shape in parsed_img.shapes:
            label_id = label_name_to_id.get(parsed_shape.label_name)
            if label_id is None:
                warnings.append(ParseWarning(
                    upload_id=upload_id,
                    image_id=img.id,
                    severity=ParseWarningSeverity.warning,
                    message=f"Unknown label '{parsed_shape.label_name}' on image '{parsed_img.raw_filename}'; shape stored but excluded from comparison.",
                ))

            shape = Shape(
                image_id=img.id,
                label_id=label_id,
                label_name=parsed_shape.label_name,
                type=parsed_shape.type,
                geometry=parsed_shape.geometry,
                group_value=parsed_shape.group_value,
                occluded=parsed_shape.occluded,
                z_order=parsed_shape.z_order,
            )
            db.add(shape)
            db.flush()

            for attr in parsed_shape.attributes:
                db.add(ShapeAttribute(
                    shape_id=shape.id,
                    name=attr.name,
                    value=attr.value,
                ))

        for parsed_tag in parsed_img.tags:
            db.add(Tag(image_id=img.id, name=parsed_tag.name))

    db.commit()
    return warnings


def archive_xml(project_id: uuid.UUID, upload_id: uuid.UUID, xml_path: str) -> None:
    """Gzip-compress and store annotations.xml — §12.4."""
    archive_dir = os.path.join(settings.xml_archive_dir, str(project_id), str(upload_id))
    os.makedirs(archive_dir, exist_ok=True)
    archive_path = os.path.join(archive_dir, "annotations.xml.gz")
    if not os.path.exists(archive_path):
        with open(xml_path, "rb") as f_in, gzip.open(archive_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)


def find_annotation_xml_in_zip(zf: zipfile.ZipFile) -> Optional[str]:
    """
    Locate annotations.xml inside the ZIP, possibly nested — FR-3.5.
    Returns the entry name, or None.
    Raises if multiple top-level annotation XML files are found.
    """
    candidates = [name for name in zf.namelist()
                  if os.path.basename(name) == "annotations.xml" and not name.endswith("/")]
    if len(candidates) == 0:
        return None
    if len(candidates) > 1:
        raise ValueError(
            f"ZIP contains multiple annotation XML files: {candidates}. "
            "Configure the project to expect multiple files or re-export."
        )
    return candidates[0]
