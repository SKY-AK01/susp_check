"""Feedback / rework API — §11.7, §19."""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_supervisor_or_above, require_any
from app.database import get_db
from app.models.comparison import ComparisonResult, ReviewStatus
from app.models.feedback import AuditLog, Feedback
from app.models.user import User
from app.schemas.comparison import (
    BulkStatusUpdate, FeedbackCreate, FeedbackOut, ReviewStatusUpdate,
)

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/comparison-results/{result_id}/feedback", response_model=FeedbackOut, status_code=201)
async def add_feedback(
    result_id: uuid.UUID,
    body: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """Attach a free-text note to a ComparisonResult or ShapeDiff — FR-10.1."""
    await _get_result_or_404(db, result_id)
    fb = Feedback(
        comparison_result_id=result_id,
        shape_diff_id=body.shape_diff_id,
        reviewer_id=current_user.id,
        note=body.note,
    )
    db.add(fb)
    db.add(AuditLog(
        actor_id=current_user.id,
        action="add_feedback",
        entity_type="comparison_result",
        entity_id=str(result_id),
        metadata_={"note_length": len(body.note)},
    ))
    await db.flush()
    return fb


@router.patch("/comparison-results/{result_id}", response_model=dict)
async def update_review_status(
    result_id: uuid.UUID,
    body: ReviewStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """Update review_status on a single result — FR-10.2."""
    result = await _get_result_or_404(db, result_id)
    old_status = result.review_status
    result.review_status = body.review_status
    db.add(AuditLog(
        actor_id=current_user.id,
        action="update_review_status",
        entity_type="comparison_result",
        entity_id=str(result_id),
        metadata_={"old": old_status.value, "new": body.review_status.value},
    ))
    return {"id": result_id, "review_status": body.review_status}


@router.post("/comparison-results/{result_id}/bulk-status", response_model=dict)
async def bulk_update_status(
    result_id: uuid.UUID,   # kept for route consistency but body carries the actual IDs
    body: BulkStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """
    Bulk review_status update across multiple results — FR-9.3.
    Accepts a list of result_ids; all must belong to accessible runs.
    """
    # Update all in one statement
    await db.execute(
        update(ComparisonResult)
        .where(ComparisonResult.id.in_(body.result_ids))
        .values(review_status=body.review_status)
    )
    db.add(AuditLog(
        actor_id=current_user.id,
        action="bulk_update_review_status",
        entity_type="comparison_result",
        entity_id="bulk",
        metadata_={
            "result_ids": [str(i) for i in body.result_ids],
            "new_status": body.review_status.value,
        },
    ))
    return {"updated": len(body.result_ids), "review_status": body.review_status}


async def _get_result_or_404(db: AsyncSession, result_id: uuid.UUID) -> ComparisonResult:
    result = (await db.execute(
        select(ComparisonResult).where(ComparisonResult.id == result_id)
    )).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="ComparisonResult not found")
    return result
