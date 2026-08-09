"""Students API — §11.3 + student performance tracker."""
from __future__ import annotations
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime

from app.auth.rbac import require_any
from app.database import get_db
from app.models.comparison import ComparisonResult, ComparisonRun, RunStatus, Verdict
from app.models.image import Image
from app.models.student import Student
from app.models.user import User
from app.schemas.common import Page, PaginationParams

router = APIRouter(prefix="/api", tags=["students"])


class StudentOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    cvat_task_id: int
    display_name: Optional[str]
    username: Optional[str]
    email: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class ImageOut(BaseModel):
    id: uuid.UUID
    raw_filename: str
    normalized_key: str
    width: Optional[int]
    height: Optional[int]
    storage_ref: Optional[str]
    model_config = {"from_attributes": True}


class VerdictBreakdown(BaseModel):
    exact_match: int = 0
    minor_difference: int = 0
    significant_difference: int = 0
    missing: int = 0
    extra: int = 0
    needs_manual_review: int = 0


class RunPerformancePoint(BaseModel):
    run_id: uuid.UUID
    run_completed_at: Optional[datetime]
    avg_score: Optional[float]
    total_images: int
    verdicts: VerdictBreakdown


class StudentPerformance(BaseModel):
    student: StudentOut
    latest_avg_score: Optional[float]
    latest_run_id: Optional[uuid.UUID]
    total_runs: int
    total_images_reviewed: int
    latest_verdicts: VerdictBreakdown
    run_history: List[RunPerformancePoint]   # oldest → newest for trend chart


@router.get("/projects/{project_id}/students", response_model=Page[StudentOut])
async def list_students(
    project_id: uuid.UUID,
    upload_id: Optional[uuid.UUID] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    stmt = select(Student).where(Student.project_id == project_id)
    count_stmt = select(func.count(Student.id)).where(Student.project_id == project_id)

    if upload_id:
        sub = select(Image.student_id).where(Image.upload_id == upload_id).scalar_subquery()
        stmt = stmt.where(Student.id.in_(sub))
        count_stmt = count_stmt.where(Student.id.in_(sub))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset(pagination.offset).limit(pagination.limit))).scalars().all()
    return Page.build(items=rows, total=total, limit=pagination.limit, offset=pagination.offset)


@router.get("/students/{student_id}", response_model=StudentOut)
async def get_student(
    student_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    student = (await db.execute(select(Student).where(Student.id == student_id))).scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.get("/students/{student_id}/images", response_model=Page[ImageOut])
async def list_student_images(
    student_id: uuid.UUID,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    total = (await db.execute(
        select(func.count(Image.id)).where(Image.student_id == student_id)
    )).scalar_one()
    rows = (await db.execute(
        select(Image).where(Image.student_id == student_id)
        .offset(pagination.offset).limit(pagination.limit)
    )).scalars().all()
    return Page.build(items=rows, total=total, limit=pagination.limit, offset=pagination.offset)


@router.get("/students/{student_id}/performance", response_model=StudentPerformance)
async def get_student_performance(
    student_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    Full performance profile for one student across all comparison runs.
    Returns per-run score trend + latest verdict breakdown.
    """
    student = (await db.execute(select(Student).where(Student.id == student_id))).scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # All completed runs for this student's project
    runs_stmt = (
        select(ComparisonRun)
        .where(
            ComparisonRun.project_id == student.project_id,
            ComparisonRun.status == RunStatus.complete,
        )
        .order_by(ComparisonRun.completed_at.asc())
    )
    runs = (await db.execute(runs_stmt)).scalars().all()

    run_history: List[RunPerformancePoint] = []

    for run in runs:
        # Aggregate results for this student in this run
        rows = (await db.execute(
            select(
                ComparisonResult.verdict,
                func.count(ComparisonResult.id).label("cnt"),
                func.avg(ComparisonResult.score).label("avg_score"),
            )
            .where(
                ComparisonResult.run_id == run.id,
                ComparisonResult.student_id == student_id,
            )
            .group_by(ComparisonResult.verdict)
        )).all()

        if not rows:
            continue

        verdicts = VerdictBreakdown()
        total_imgs = 0
        avg_scores = []

        for verdict, cnt, avg_score in rows:
            total_imgs += cnt
            if avg_score is not None:
                avg_scores.append(float(avg_score) * cnt)
            v = verdict.value if hasattr(verdict, "value") else verdict
            if hasattr(verdicts, v):
                setattr(verdicts, v, cnt)

        run_avg = sum(avg_scores) / total_imgs if total_imgs and avg_scores else None

        run_history.append(RunPerformancePoint(
            run_id=run.id,
            run_completed_at=run.completed_at,
            avg_score=round(run_avg, 2) if run_avg is not None else None,
            total_images=total_imgs,
            verdicts=verdicts,
        ))

    # Latest run stats
    latest = run_history[-1] if run_history else None
    total_reviewed = sum(p.total_images for p in run_history)

    return StudentPerformance(
        student=StudentOut.model_validate(student),
        latest_avg_score=latest.avg_score if latest else None,
        latest_run_id=latest.run_id if latest else None,
        total_runs=len(run_history),
        total_images_reviewed=total_reviewed,
        latest_verdicts=latest.verdicts if latest else VerdictBreakdown(),
        run_history=run_history,
    )


class LeaderboardEntry(BaseModel):
    rank: int
    student: StudentOut
    latest_avg_score: Optional[float]
    total_images: int
    exact_match_pct: Optional[float]
    needs_rework_count: int


class StudentLeaderboard(BaseModel):
    project_id: uuid.UUID
    run_id: Optional[uuid.UUID]
    entries: List[LeaderboardEntry]


@router.get("/projects/{project_id}/students/leaderboard", response_model=StudentLeaderboard)
async def student_leaderboard(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    All students in a project ranked by avg score on the latest completed run.
    Supervisors use this to identify who needs the most attention.
    """
    # Get latest completed run for this project
    latest_run = (await db.execute(
        select(ComparisonRun)
        .where(
            ComparisonRun.project_id == project_id,
            ComparisonRun.status == RunStatus.complete,
        )
        .order_by(ComparisonRun.completed_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not latest_run:
        return StudentLeaderboard(project_id=project_id, run_id=None, entries=[])

    # Per-student aggregates for this run
    rows = (await db.execute(
        select(
            ComparisonResult.student_id,
            func.avg(ComparisonResult.score).label("avg_score"),
            func.count(ComparisonResult.id).label("total"),
            func.sum(
                (ComparisonResult.verdict == Verdict.exact_match).cast(
                    __import__("sqlalchemy", fromlist=["Integer"]).Integer
                )
            ).label("exact_count"),
            func.sum(
                (ComparisonResult.review_status == "needs_rework").cast(
                    __import__("sqlalchemy", fromlist=["Integer"]).Integer
                )
            ).label("rework_count"),
        )
        .where(ComparisonResult.run_id == latest_run.id)
        .group_by(ComparisonResult.student_id)
        .order_by(func.avg(ComparisonResult.score).desc())
    )).all()

    # Load student objects
    student_ids = [r.student_id for r in rows]
    students_map: dict[uuid.UUID, Student] = {}
    if student_ids:
        stus = (await db.execute(
            select(Student).where(Student.id.in_(student_ids))
        )).scalars().all()
        students_map = {s.id: s for s in stus}

    entries: List[LeaderboardEntry] = []
    for rank, row in enumerate(rows, start=1):
        stu = students_map.get(row.student_id)
        if not stu:
            continue
        total = row.total or 0
        exact = int(row.exact_count or 0)
        entries.append(LeaderboardEntry(
            rank=rank,
            student=StudentOut.model_validate(stu),
            latest_avg_score=round(float(row.avg_score), 2) if row.avg_score is not None else None,
            total_images=total,
            exact_match_pct=round(exact / total * 100, 1) if total > 0 else None,
            needs_rework_count=int(row.rework_count or 0),
        ))

    return StudentLeaderboard(
        project_id=project_id,
        run_id=latest_run.id,
        entries=entries,
    )
