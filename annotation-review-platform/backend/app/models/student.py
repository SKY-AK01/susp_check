"""
Student model — §10.  Keyed by (project_id, cvat_task_id) to support idempotent upsert (FR-4.2).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Integer, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), nullable=False)
    # CVAT task_id — the authoritative student identifier per §5.2
    cvat_task_id: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Task size metadata from CVAT <task> element
    task_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    start_frame: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    stop_frame: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped["Project"] = relationship("Project", back_populates="students")  # type: ignore[name-defined]

    __table_args__ = (
        # Idempotent upsert guarantee — FR-4.2
        UniqueConstraint("project_id", "cvat_task_id", name="uq_student_project_task"),
        Index("ix_students_project_id", "project_id"),
    )
