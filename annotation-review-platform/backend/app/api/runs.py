"""Comparison Runs API — §11.5."""
from __future__ import annotations
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.auth.rbac import require_any, require_supervisor_or_above
from app.database import get_db
from app.models.comparison import (
    ComparisonResult, ComparisonRun, ReferenceSet, RunStatus, ShapeDiff, Verdict,
)
from app.models.feedback import AuditLog
from app.models.user import User
from app.schemas.common import Page, PaginationParams
from app.schemas.comparison import ComparisonResultOut, ComparisonRunOut, RunCreate

router = APIRouter(prefix="/api", tags=["runs"])


@router.post("/reference-sets/{ref_set_id}/runs", response_model=ComparisonRunOut, status_code=202)
async def trigger_run(
    ref_set_id: uuid.UUID,
    body: RunCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """Trigger a ComparisonRun — §11.5, FR-5.5."""
    ref_set = (await db.execute(
        select(ReferenceSet).where(ReferenceSet.id == ref_set_id)
    )).scalar_one_or_none()
    if not ref_set:
        raise HTTPException(status_code=404, detail="ReferenceSet not found")

    # If upload_id not provided, derive it from the most recent ingested upload for this project
    upload_id = body.upload_id
    if upload_id is None:
        from app.models.upload import Upload as UploadModel, UploadStatus
        from sqlalchemy import desc
        latest_upload = (await db.execute(
            select(UploadModel)
            .where(
                UploadModel.project_id == ref_set.project_id,
                UploadModel.is_reference == False,
                UploadModel.status.in_([UploadStatus.ingested, UploadStatus.partially_failed]),
            )
            .order_by(desc(UploadModel.created_at))
            .limit(1)
        )).scalar_one_or_none()
        if not latest_upload:
            raise HTTPException(status_code=400, detail="No ingested upload found for this project. Upload a CVAT ZIP first.")
        upload_id = latest_upload.id

    run = ComparisonRun(
        project_id=ref_set.project_id,
        reference_set_id=ref_set_id,
        upload_id=upload_id,
        status=RunStatus.pending,
    )
    db.add(run)
    await db.flush()

    db.add(AuditLog(
        actor_id=current_user.id, action="trigger_run",
        entity_type="comparison_run", entity_id=str(run.id),
        metadata_={"upload_id": str(upload_id)},
    ))
    await db.flush()

    from app.workers.comparison_tasks import run_comparison
    run_comparison.apply_async(args=[str(run.id)], queue="comparison")

    return run


@router.get("/runs/{run_id}", response_model=ComparisonRunOut)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    return await _get_run_or_404(db, run_id)


@router.get("/runs/{run_id}/results", response_model=Page[ComparisonResultOut])
async def list_results(
    run_id: uuid.UUID,
    student_id: Optional[uuid.UUID] = Query(None),
    verdict: Optional[Verdict] = Query(None),
    score_min: Optional[float] = Query(None),
    score_max: Optional[float] = Query(None),
    sort_by: str = Query("score"),         # "score" | "verdict"
    sort_dir: str = Query("asc"),          # "asc" | "desc"
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """Paginated, filtered, server-sorted results table — §11.5, §13.7, §18.2."""
    stmt = select(ComparisonResult).where(ComparisonResult.run_id == run_id)
    count_stmt = select(func.count(ComparisonResult.id)).where(ComparisonResult.run_id == run_id)

    if student_id:
        stmt = stmt.where(ComparisonResult.student_id == student_id)
        count_stmt = count_stmt.where(ComparisonResult.student_id == student_id)
    if verdict:
        stmt = stmt.where(ComparisonResult.verdict == verdict)
        count_stmt = count_stmt.where(ComparisonResult.verdict == verdict)
    if score_min is not None:
        stmt = stmt.where(ComparisonResult.score >= score_min)
        count_stmt = count_stmt.where(ComparisonResult.score >= score_min)
    if score_max is not None:
        stmt = stmt.where(ComparisonResult.score <= score_max)
        count_stmt = count_stmt.where(ComparisonResult.score <= score_max)

    # Sorting — §18.2
    sort_col = ComparisonResult.score if sort_by == "score" else ComparisonResult.verdict
    stmt = stmt.order_by(sort_col.asc() if sort_dir == "asc" else sort_col.desc())

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset(pagination.offset).limit(pagination.limit))).scalars().all()

    # Eagerly load shape_diffs for the returned page (avoids N+1)
    result_ids = [r.id for r in rows]
    diffs_by_result: dict[uuid.UUID, list] = {r.id: [] for r in rows}
    if result_ids:
        diffs = (await db.execute(
            select(ShapeDiff).where(ShapeDiff.comparison_result_id.in_(result_ids))
        )).scalars().all()
        for d in diffs:
            diffs_by_result[d.comparison_result_id].append(d)

    out_rows = []
    for r in rows:
        r_dict = ComparisonResultOut.model_validate(r)
        r_dict.shape_diffs = [
            __import__("app.schemas.comparison", fromlist=["ShapeDiffOut"]).ShapeDiffOut.model_validate(d)
            for d in diffs_by_result[r.id]
        ]
        out_rows.append(r_dict)

    return Page.build(items=out_rows, total=total, limit=pagination.limit, offset=pagination.offset)


@router.get("/runs/{run_id}/results/{result_id}", response_model=ComparisonResultOut)
async def get_result(
    run_id: uuid.UUID,
    result_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    result = (await db.execute(
        select(ComparisonResult).where(
            ComparisonResult.id == result_id,
            ComparisonResult.run_id == run_id,
        )
    )).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    diffs = (await db.execute(
        select(ShapeDiff).where(ShapeDiff.comparison_result_id == result_id)
    )).scalars().all()

    from app.schemas.comparison import ShapeDiffOut
    out = ComparisonResultOut.model_validate(result)
    out.shape_diffs = [ShapeDiffOut.model_validate(d) for d in diffs]
    return out


class RunSummary(BaseModel):
    run_id: uuid.UUID
    total: int
    by_verdict: dict
    by_student: list


@router.get("/runs/{run_id}/summary", response_model=RunSummary)
async def run_summary(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """Aggregate per-verdict and per-student counts — §11.5."""
    await _get_run_or_404(db, run_id)

    # Per-verdict counts
    verdict_rows = (await db.execute(
        select(ComparisonResult.verdict, func.count(ComparisonResult.id))
        .where(ComparisonResult.run_id == run_id)
        .group_by(ComparisonResult.verdict)
    )).all()
    by_verdict = {row[0].value: row[1] for row in verdict_rows}

    total = sum(by_verdict.values())

    # Per-student counts
    student_rows = (await db.execute(
        select(
            ComparisonResult.student_id,
            ComparisonResult.verdict,
            func.count(ComparisonResult.id),
        )
        .where(ComparisonResult.run_id == run_id)
        .group_by(ComparisonResult.student_id, ComparisonResult.verdict)
    )).all()

    student_map: dict[str, dict] = {}
    for sid, verdict, count in student_rows:
        key = str(sid)
        if key not in student_map:
            student_map[key] = {"student_id": key, "verdicts": {}}
        student_map[key]["verdicts"][verdict.value] = count

    return RunSummary(
        run_id=run_id,
        total=total,
        by_verdict=by_verdict,
        by_student=list(student_map.values()),
    )


async def _get_run_or_404(db: AsyncSession, run_id: uuid.UUID) -> ComparisonRun:
    result = (await db.execute(select(ComparisonRun).where(ComparisonRun.id == run_id))).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Run not found")
    return result
