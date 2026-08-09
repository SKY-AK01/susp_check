"""Projects API — §11.1."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_any, require_supervisor_or_above
from app.database import get_db
from app.models.project import Label, LabelAttribute, LabelSchema, Project
from app.models.feedback import AuditLog
from app.models.user import User
from app.schemas.common import Page, PaginationParams
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    project = Project(
        name=body.name,
        project_type=body.project_type,
        gt_mode_default=body.gt_mode_default,
        box_iou_exact=body.box_iou_exact,
        box_iou_minor=body.box_iou_minor,
        polygon_iou_exact=body.polygon_iou_exact,
        polygon_iou_minor=body.polygon_iou_minor,
        ocr_edit_distance_minor=body.ocr_edit_distance_minor,
    )
    db.add(project)
    await db.flush()

    if body.labels:
        schema = LabelSchema(project_id=project.id, version=1)
        db.add(schema)
        await db.flush()
        for label_in in body.labels:
            label = Label(
                label_schema_id=schema.id,
                name=label_in.name,
                geometry_type=label_in.geometry_type,
            )
            db.add(label)
            await db.flush()
            for attr_in in label_in.attributes:
                db.add(LabelAttribute(
                    label_id=label.id,
                    name=attr_in.name,
                    value_type=attr_in.value_type,
                    allowed_values=attr_in.allowed_values,
                    is_grouping_key=attr_in.is_grouping_key,
                ))

    db.add(AuditLog(
        actor_id=current_user.id, action="create_project",
        entity_type="project", entity_id=str(project.id),
    ))
    return project


@router.get("", response_model=Page[ProjectOut])
async def list_projects(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    total = (await db.execute(select(func.count(Project.id)))).scalar_one()
    rows = (await db.execute(
        select(Project).offset(pagination.offset).limit(pagination.limit)
    )).scalars().all()
    return Page.build(items=rows, total=total, limit=pagination.limit, offset=pagination.offset)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    project = await _get_or_404(db, project_id)
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    project = await _get_or_404(db, project_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    project.updated_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        actor_id=current_user.id, action="update_project",
        entity_type="project", entity_id=str(project.id),
        metadata_=body.model_dump(exclude_none=True),
    ))
    return project


async def _get_or_404(db: AsyncSession, project_id: uuid.UUID) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
