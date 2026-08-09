"""
Feedback, ParseWarning, JobRun, AuditLog models — §10, §17.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
import enum

from sqlalchemy import String, DateTime, Enum as SAEnum, ForeignKey, Integer, Text, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ParseWarningSeverity(str, enum.Enum):
    warning = "warning"
    error = "error"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"
    retrying = "retrying"


class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    comparison_result_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("comparison_results.id"), nullable=True
    )
    shape_diff_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("shape_diffs.id"), nullable=True
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_feedbacks_result_id", "comparison_result_id"),
    )


class ParseWarning(Base):
    __tablename__ = "parse_warnings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    upload_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("uploads.id"), nullable=False)
    image_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("images.id"), nullable=True)
    severity: Mapped[ParseWarningSeverity] = mapped_column(SAEnum(ParseWarningSeverity), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_parse_warnings_upload_id", "upload_id"),
    )


class JobRun(Base):
    """Operational job execution audit — §17."""
    __tablename__ = "job_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_type: Mapped[str] = mapped_column(String(100), nullable=False)
    related_entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    related_entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), nullable=False, default=JobStatus.pending)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_job_runs_entity", "related_entity_type", "related_entity_id"),
    )


class AuditLog(Base):
    """User-facing audit trail — §17."""
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_actor_time", "actor_id", "created_at"),
    )
