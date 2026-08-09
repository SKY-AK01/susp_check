"""Reference Sets / GT API — §11.4."""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_any, require_supervisor_or_above
from app.database import get_db
from app.models.comparison import ReferenceSet, ReferenceSourceType
from app.models.feedback import AuditLog
from app.models.project import Project
from app.models.student import Student
from app.models.upload import Upload
from app.models.user import User
from app.schemas.common import Page, PaginationParams
from app.schemas.comparison import ReferenceSetCreate, ReferenceSetOut

router = APIRouter(prefix="/api", tags=["reference-sets"])


@router.post("/projects/{project_id}/reference-sets", response_model=ReferenceSetOut, status_code=201)
async def create_reference_set(
    project_id: uuid.UUID,
    body: ReferenceSetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """
    Create a ReferenceSet — §11.4, FR-5.1, FR-5.2.
    uploaded_gt: pass reference_upload_id pointing to an is_reference=True upload.
    student_reference: pass reference_student_id.
    """
    # Validate project exists
    proj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.source_type == ReferenceSourceType.uploaded_gt:
        if not body.reference_upload_id:
            raise HTTPException(status_code=400, detail="reference_upload_id required for uploaded_gt")
        upload = (await db.execute(
            select(Upload).where(Upload.id == body.reference_upload_id, Upload.is_reference == True)
        )).scalar_one_or_none()
        if not upload:
            raise HTTPException(status_code=404, detail="Reference upload not found or not marked as GT")

    elif body.source_type == ReferenceSourceType.student:
        if not body.reference_student_id:
            raise HTTPException(status_code=400, detail="reference_student_id required for student mode")
        student = (await db.execute(
            select(Student).where(
                Student.id == body.reference_student_id,
                Student.project_id == project_id,
            )
        )).scalar_one_or_none()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found in this project")

    ref_set = ReferenceSet(
        project_id=project_id,
        source_type=body.source_type,
        reference_upload_id=body.reference_upload_id,
        reference_student_id=body.reference_student_id,
    )
    db.add(ref_set)
    await db.flush()

    db.add(AuditLog(
        actor_id=current_user.id,
        action="create_reference_set",
        entity_type="reference_set",
        entity_id=str(ref_set.id),
        metadata_={"source_type": body.source_type.value},
    ))
    return ref_set


@router.get("/projects/{project_id}/reference-sets", response_model=Page[ReferenceSetOut])
async def list_reference_sets(
    project_id: uuid.UUID,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    total = (await db.execute(
        select(func.count(ReferenceSet.id)).where(ReferenceSet.project_id == project_id)
    )).scalar_one()
    rows = (await db.execute(
        select(ReferenceSet)
        .where(ReferenceSet.project_id == project_id)
        .order_by(ReferenceSet.created_at.desc())
        .offset(pagination.offset).limit(pagination.limit)
    )).scalars().all()
    return Page.build(items=rows, total=total, limit=pagination.limit, offset=pagination.offset)
