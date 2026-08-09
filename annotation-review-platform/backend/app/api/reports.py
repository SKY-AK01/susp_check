"""Reporting API — §11.8, §18."""
from __future__ import annotations
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_any
from app.database import get_db
from app.models.comparison import ComparisonResult, ComparisonRun, Verdict
from app.models.feedback import AuditLog
from app.models.image import Shape
from app.models.project import Project
from app.models.user import User

router = APIRouter(prefix="/api/projects", tags=["reports"])


class StudentTrendPoint(BaseModel):
    run_id: uuid.UUID
    student_id: uuid.UUID
    avg_score: float
    verdict_counts: dict


class StudentTrendReport(BaseModel):
    project_id: uuid.UUID
    data: List[StudentTrendPoint]


@router.get("/{project_id}/reports/student-trend", response_model=StudentTrendReport)
async def student_trend(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    Per-student score/verdict trend across all runs — §11.8, §18.1.
    Returns one data point per (run, student) pair.
    """
    await _get_project_or_404(db, project_id)

    rows = (await db.execute(
        select(
            ComparisonResult.run_id,
            ComparisonResult.student_id,
            func.avg(ComparisonResult.score).label("avg_score"),
            ComparisonResult.verdict,
            func.count(ComparisonResult.id).label("cnt"),
        )
        .join(ComparisonRun, ComparisonRun.id == ComparisonResult.run_id)
        .where(ComparisonRun.project_id == project_id)
        .group_by(ComparisonResult.run_id, ComparisonResult.student_id, ComparisonResult.verdict)
    )).all()

    # Aggregate into (run_id, student_id) → {avg_score, verdict_counts}
    aggregated: dict[tuple, dict] = {}
    for run_id, student_id, avg_score, verdict, cnt in rows:
        key = (run_id, student_id)
        if key not in aggregated:
            aggregated[key] = {"run_id": run_id, "student_id": student_id,
                                "avg_score": float(avg_score or 0), "verdict_counts": {}}
        aggregated[key]["verdict_counts"][verdict.value] = cnt

    data = [
        StudentTrendPoint(
            run_id=v["run_id"],
            student_id=v["student_id"],
            avg_score=v["avg_score"],
            verdict_counts=v["verdict_counts"],
        )
        for v in aggregated.values()
    ]
    return StudentTrendReport(project_id=project_id, data=data)


class LabelErrorRate(BaseModel):
    label_name: str
    total_shapes: int
    error_count: int
    error_rate: float


class LabelErrorReport(BaseModel):
    project_id: uuid.UUID
    rates: List[LabelErrorRate]


@router.get("/{project_id}/reports/label-error-rates", response_model=LabelErrorReport)
async def label_error_rates(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    Error rate per label across all students in the latest run — §11.8, §18.4.
    Helps identify systematically hard/ambiguous labels.
    """
    await _get_project_or_404(db, project_id)

    # Latest completed run for this project
    latest_run = (await db.execute(
        select(ComparisonRun)
        .where(ComparisonRun.project_id == project_id)
        .order_by(ComparisonRun.completed_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not latest_run:
        return LabelErrorReport(project_id=project_id, rates=[])

    from app.models.comparison import ShapeDiff
    rows = (await db.execute(
        select(
            Shape.label_name,
            ShapeDiff.verdict,
            func.count(ShapeDiff.id).label("cnt"),
        )
        .join(ComparisonResult, ComparisonResult.id == ShapeDiff.comparison_result_id)
        .outerjoin(Shape, Shape.id == ShapeDiff.student_shape_id)
        .where(ComparisonResult.run_id == latest_run.id)
        .group_by(Shape.label_name, ShapeDiff.verdict)
    )).all()

    label_stats: dict[str, dict] = {}
    error_verdicts = {
        Verdict.missing, Verdict.extra,
        Verdict.significant_difference, Verdict.needs_manual_review,
    }
    for label_name, verdict, cnt in rows:
        ln = label_name or "unknown"
        if ln not in label_stats:
            label_stats[ln] = {"total": 0, "errors": 0}
        label_stats[ln]["total"] += cnt
        if verdict in error_verdicts:
            label_stats[ln]["errors"] += cnt

    rates = [
        LabelErrorRate(
            label_name=ln,
            total_shapes=stats["total"],
            error_count=stats["errors"],
            error_rate=round(stats["errors"] / stats["total"], 4) if stats["total"] else 0.0,
        )
        for ln, stats in sorted(label_stats.items(), key=lambda x: -x[1]["errors"])
    ]
    return LabelErrorReport(project_id=project_id, rates=rates)


class ReviewerActivity(BaseModel):
    reviewer_id: uuid.UUID
    reviewer_name: str
    actions_count: int


class ReviewerActivityReport(BaseModel):
    project_id: uuid.UUID
    activity: List[ReviewerActivity]


@router.get("/{project_id}/reports/reviewer-activity", response_model=ReviewerActivityReport)
async def reviewer_activity(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """Reviewer throughput derived from AuditLog — §11.8, §18.5."""
    await _get_project_or_404(db, project_id)

    from app.models.user import User as UserModel
    rows = (await db.execute(
        select(
            AuditLog.actor_id,
            UserModel.name,
            func.count(AuditLog.id).label("cnt"),
        )
        .join(UserModel, UserModel.id == AuditLog.actor_id)
        .where(
            AuditLog.action.in_(["add_feedback", "update_review_status", "bulk_update_review_status"]),
        )
        .group_by(AuditLog.actor_id, UserModel.name)
        .order_by(func.count(AuditLog.id).desc())
    )).all()

    return ReviewerActivityReport(
        project_id=project_id,
        activity=[
            ReviewerActivity(reviewer_id=actor_id, reviewer_name=name, actions_count=cnt)
            for actor_id, name, cnt in rows
        ],
    )


async def _get_project_or_404(db: AsyncSession, project_id: uuid.UUID) -> Project:
    p = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p
