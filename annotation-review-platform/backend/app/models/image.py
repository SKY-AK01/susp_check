"""
Image, Shape, ShapeAttribute, Tag models — §10.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List
import enum

from sqlalchemy import String, DateTime, ForeignKey, Integer, Boolean, JSON, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Image(Base):
    """One row per (student, photo) pair — or (reference, photo) for GT images."""
    __tablename__ = "images"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    upload_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("uploads.id"), nullable=False)
    # Null when image belongs to an uploaded-GT upload (no student owns it)
    student_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("students.id"), nullable=True)
    raw_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    # Normalized key for cross-student matching — §9.2, §5.3
    normalized_key: Mapped[str] = mapped_column(String(500), nullable=False)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # SHA-256 of the image bytes — §12.3 dedup
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Relative path under DATA_DIR/images/ — §22.2
    storage_ref: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    shapes: Mapped[List["Shape"]] = relationship("Shape", back_populates="image")
    tags: Mapped[List["Tag"]] = relationship("Tag", back_populates="image")

    __table_args__ = (
        # Hot-path for image matching per run — §10.1
        Index("ix_images_project_normalized_key", "project_id", "normalized_key"),
        Index("ix_images_upload_student", "upload_id", "student_id"),
        Index("ix_images_content_hash", "content_hash"),
    )


class Shape(Base):
    """
    A single annotated object: <box> or <polygon>.
    Geometry is stored as JSONB so both types share one table (§5.4).
    """
    __tablename__ = "shapes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    image_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("images.id"), nullable=False)
    label_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("labels.id"), nullable=True)
    # "box" | "polygon"
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Box: {"xtl": f, "ytl": f, "xbr": f, "ybr": f}
    # Polygon: {"points": [[x, y], ...]}
    geometry: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Raw linking-attribute value (e.g. vehicle_id) — §9.3
    group_value: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Flagged by §15.3 geometry validation
    geometry_invalid: Mapped[bool] = mapped_column(Boolean, default=False)
    occluded: Mapped[bool] = mapped_column(Boolean, default=False)
    z_order: Mapped[int] = mapped_column(Integer, default=0)
    label_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # denormalized for perf

    image: Mapped["Image"] = relationship("Image", back_populates="shapes")
    attributes: Mapped[List["ShapeAttribute"]] = relationship("ShapeAttribute", back_populates="shape")

    __table_args__ = (
        Index("ix_shapes_image_id", "image_id"),
        Index("ix_shapes_image_label", "image_id", "label_id"),
    )


class ShapeAttribute(Base):
    __tablename__ = "shape_attributes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    shape_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shapes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    shape: Mapped["Shape"] = relationship("Shape", back_populates="attributes")

    __table_args__ = (
        Index("ix_shape_attributes_shape_id", "shape_id"),
    )


class Tag(Base):
    """
    Image-level (frame-level) non-geometric label — §5.5.
    e.g. Mirror-Image, Rotated, No Plates, Unreadable_Plate.
    """
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    image_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("images.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    image: Mapped["Image"] = relationship("Image", back_populates="tags")

    __table_args__ = (
        Index("ix_tags_image_id", "image_id"),
    )
