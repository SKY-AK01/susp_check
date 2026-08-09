"""
Project, LabelSchema, Label, LabelAttribute models — §10.
"""
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional, List
import enum

from sqlalchemy import String, DateTime, Enum as SAEnum, ForeignKey, Integer, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.upload import Upload
    from app.models.student import Student


class GTMode(str, enum.Enum):
    uploaded_gt = "uploaded_gt"
    student_reference = "student_reference"


class GeometryType(str, enum.Enum):
    box = "box"
    polygon = "polygon"


class AttributeValueType(str, enum.Enum):
    categorical = "categorical"
    free_text = "free_text"
    linking = "linking"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_type: Mapped[str] = mapped_column(String(100), nullable=False)
    gt_mode_default: Mapped[GTMode] = mapped_column(SAEnum(GTMode), nullable=False)

    # Per-project comparison threshold overrides — FR-6.3
    box_iou_exact: Mapped[Optional[float]] = mapped_column(nullable=True)
    box_iou_minor: Mapped[Optional[float]] = mapped_column(nullable=True)
    polygon_iou_exact: Mapped[Optional[float]] = mapped_column(nullable=True)
    polygon_iou_minor: Mapped[Optional[float]] = mapped_column(nullable=True)
    ocr_edit_distance_minor: Mapped[Optional[int]] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    label_schemas: Mapped[List["LabelSchema"]] = relationship("LabelSchema", back_populates="project")
    uploads: Mapped[List["Upload"]] = relationship("Upload", back_populates="project")
    students: Mapped[List["Student"]] = relationship("Student", back_populates="project")


class LabelSchema(Base):
    __tablename__ = "label_schemas"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped["Project"] = relationship("Project", back_populates="label_schemas")
    labels: Mapped[List["Label"]] = relationship("Label", back_populates="schema", lazy="selectin")


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    label_schema_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("label_schemas.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    geometry_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "box" | "polygon"

    schema: Mapped["LabelSchema"] = relationship("LabelSchema", back_populates="labels")
    attributes: Mapped[List["LabelAttribute"]] = relationship(
        "LabelAttribute", back_populates="label", lazy="selectin"
    )

    __table_args__ = (
        Index("ix_labels_schema_name", "label_schema_id", "name"),
    )


class LabelAttribute(Base):
    __tablename__ = "label_attributes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    label_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("labels.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    value_type: Mapped[str] = mapped_column(String(20), nullable=False)  # categorical|free_text|linking
    allowed_values: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Whether this attribute acts as a shape grouping key (e.g. vehicle_id) — §9.3
    is_grouping_key: Mapped[bool] = mapped_column(default=False)

    label: Mapped["Label"] = relationship("Label", back_populates="attributes")
