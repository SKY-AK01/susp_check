"""
Upload model — §10.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
import enum

from sqlalchemy import String, DateTime, Enum as SAEnum, ForeignKey, Integer, Float, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UploadStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    ingested = "ingested"
    failed = "failed"
    partially_failed = "partially_failed"


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    source_zip_ref: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[UploadStatus] = mapped_column(
        SAEnum(UploadStatus), nullable=False, default=UploadStatus.pending
    )
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    # True if this upload is an official GT submission (not student work)
    is_reference: Mapped[bool] = mapped_column(Boolean, default=False)
    # Stores chunk assembly info until finalized
    chunk_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    chunks_received: Mapped[int] = mapped_column(Integer, default=0)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped["Project"] = relationship("Project", back_populates="uploads")  # type: ignore[name-defined]

    __table_args__ = (
        Index("ix_uploads_project_status", "project_id", "status"),
    )
