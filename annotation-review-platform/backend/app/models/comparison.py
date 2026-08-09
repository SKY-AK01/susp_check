"""
ReferenceSet, ComparisonRun, ComparisonResult, ShapeDiff models — §10.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
import enum

from sqlalchemy import String, DateTime, Enum as SAEnum, ForeignKey, Integer, Float, JSON, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReferenceSourceType(str, enum.Enum):
    uploaded_gt = "uploaded_gt"
    student = "student"


class RunStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"
    partially_failed = "partially_failed"


class Verdict(str, enum.Enum):
    exact_match = "exact_match"
    minor_difference = "minor_difference"
    significant_difference = "significant_difference"
    missing = "missing"
    extra = "extra"
    needs_manual_review = "needs_manual_review"


class ReviewStatus(str, enum.Enum):
    open = "open"
    in_review = "in_review"
    needs_rework = "needs_rework"
    approved = "approved"
    resolved = "resolved"


class ReferenceSet(Base):
    __tablename__ = "reference_sets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    source_type: Mapped[ReferenceSourceType] = mapped_column(SAEnum(ReferenceSourceType), nullable=False)
    # Set when source_type = uploaded_gt
    reference_upload_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("uploads.id"), nullable=True)
    # Set when source_type = student
    reference_student_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("students.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    runs: Mapped[list["ComparisonRun"]] = relationship("ComparisonRun", back_populates="reference_set")


class ComparisonRun(Base):
    __tablename__ = "comparison_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    reference_set_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reference_sets.id"), nullable=False)
    upload_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("uploads.id"), nullable=False)
    status: Mapped[RunStatus] = mapped_column(SAEnum(RunStatus), nullable=False, default=RunStatus.pending)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    reference_set: Mapped["ReferenceSet"] = relationship("ReferenceSet", back_populates="runs")
    results: Mapped[list["ComparisonResult"]] = relationship("ComparisonResult", back_populates="run")

    __table_args__ = (
        Index("ix_runs_project_status", "project_id", "status"),
        Index("ix_runs_upload_id", "upload_id"),
    )


class ComparisonResult(Base):
    """One row per (run, student, image) — §10."""
    __tablename__ = "comparison_results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comparison_runs.id"), nullable=False)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id"), nullable=False)
    student_image_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("images.id"), nullable=False)
    # Null when student image had no reference match (Extra verdict at image level)
    reference_image_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("images.id"), nullable=True)
    verdict: Mapped[Verdict] = mapped_column(SAEnum(Verdict), nullable=False)
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    review_status: Mapped[ReviewStatus] = mapped_column(
        SAEnum(ReviewStatus), nullable=False, default=ReviewStatus.open
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    run: Mapped["ComparisonRun"] = relationship("ComparisonRun", back_populates="results")
    shape_diffs: Mapped[list["ShapeDiff"]] = relationship("ShapeDiff", back_populates="result")

    __table_args__ = (
        UniqueConstraint("run_id", "student_id", "student_image_id", name="uq_result_run_student_image"),
        Index("ix_results_run_student", "run_id", "student_id"),
        Index("ix_results_run_verdict", "run_id", "verdict"),
        Index("ix_results_run_score", "run_id", "score"),
    )


class ShapeDiff(Base):
    """One row per matched/unmatched shape pair within a ComparisonResult — §10."""
    __tablename__ = "shape_diffs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    comparison_result_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comparison_results.id"), nullable=False)
    reference_shape_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("shapes.id"), nullable=True)
    student_shape_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("shapes.id"), nullable=True)
    verdict: Mapped[Verdict] = mapped_column(SAEnum(Verdict), nullable=False)
    iou_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # [{name, ref_value, student_value, verdict}] — §23.2
    attribute_diffs: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    result: Mapped["ComparisonResult"] = relationship("ComparisonResult", back_populates="shape_diffs")

    __table_args__ = (
        Index("ix_shape_diffs_result_id", "comparison_result_id"),
    )
