"""
Uploads API — §11.2.
Chunked upload: POST initiate → PUT chunks → POST complete → background ingest.
"""
from __future__ import annotations
import os
import uuid
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_any, require_supervisor_or_above
from app.config import settings
from app.database import get_db
from app.models.feedback import AuditLog, ParseWarning
from app.models.project import Project
from app.models.upload import Upload, UploadStatus
from app.models.user import User
from app.schemas.common import Page, PaginationParams
from app.schemas.upload import ParseWarningOut, UploadInitiate, UploadOut
from app.services.ingestion_service import find_annotation_xml_in_zip
from app.workers.ingestion_tasks import ingest_upload

router = APIRouter(tags=["uploads"])


@router.post("/api/projects/{project_id}/uploads", response_model=UploadOut, status_code=202)
async def initiate_upload(
    project_id: uuid.UUID,
    body: UploadInitiate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """Initiate an upload, return an Upload record in pending state — FR-2.2."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    upload = Upload(
        project_id=project_id,
        uploaded_by=current_user.id,
        status=UploadStatus.pending,
        is_reference=body.is_reference,
        chunk_count=body.chunk_count,
    )
    db.add(upload)
    await db.flush()
    db.add(AuditLog(
        actor_id=current_user.id, action="initiate_upload",
        entity_type="upload", entity_id=str(upload.id),
    ))
    return upload


@router.put("/api/uploads/{upload_id}/chunks/{chunk_n}", status_code=204)
async def upload_chunk(
    upload_id: uuid.UUID,
    chunk_n: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """
    Accept one chunk of a multi-part upload — §13.1.
    Chunks are written to a staging directory; assembled on finalize.
    """
    upload = await _get_upload_or_404(db, upload_id)
    staging_dir = _staging_dir(upload)
    os.makedirs(staging_dir, exist_ok=True)
    chunk_path = os.path.join(staging_dir, f"chunk_{chunk_n:06d}")
    content = await file.read()
    with open(chunk_path, "wb") as f:
        f.write(content)
    upload.chunks_received = (upload.chunks_received or 0) + 1
    # no await needed for non-async property


@router.post("/api/uploads/{upload_id}/complete", response_model=UploadOut)
async def finalize_upload(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """
    Assemble chunks → validate ZIP → enqueue ingest_upload job — FR-2.3, §8.2.
    """
    upload = await _get_upload_or_404(db, upload_id)
    staging_dir = _staging_dir(upload)
    zip_path = _zip_path(upload)
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)

    # Assemble chunks in order
    chunk_files = sorted(
        [f for f in os.listdir(staging_dir) if f.startswith("chunk_")],
        key=lambda x: int(x.split("_")[1]),
    )
    if not chunk_files:
        raise HTTPException(status_code=400, detail="No chunks received")

    with open(zip_path, "wb") as out:
        for cf in chunk_files:
            with open(os.path.join(staging_dir, cf), "rb") as c:
                out.write(c.read())

    # Clean staging dir
    import shutil
    shutil.rmtree(staging_dir, ignore_errors=True)

    # ── Synchronous validation — FR-2.3, §15.1 ────────────────────────────────
    file_size = os.path.getsize(zip_path)
    if file_size > settings.max_zip_size_bytes:
        os.unlink(zip_path)
        raise HTTPException(status_code=400, detail=f"ZIP exceeds maximum allowed size")

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            xml_entry = find_annotation_xml_in_zip(zf)
            if xml_entry is None:
                os.unlink(zip_path)
                raise HTTPException(status_code=400, detail="ZIP contains no annotations.xml")
    except zipfile.BadZipFile:
        os.unlink(zip_path)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive")

    upload.source_zip_ref = zip_path
    upload.status = UploadStatus.pending
    db.add(AuditLog(
        actor_id=current_user.id, action="finalize_upload",
        entity_type="upload", entity_id=str(upload.id),
    ))
    await db.flush()

    # Enqueue background ingestion — §7.4
    ingest_upload.apply_async(args=[str(upload_id)], queue="ingestion")

    return upload


@router.get("/api/uploads/{upload_id}", response_model=UploadOut)
async def get_upload(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    return await _get_upload_or_404(db, upload_id)


@router.get("/api/uploads/{upload_id}/warnings", response_model=Page[ParseWarningOut])
async def list_warnings(
    upload_id: uuid.UUID,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    await _get_upload_or_404(db, upload_id)
    total = (await db.execute(
        select(func.count(ParseWarning.id)).where(ParseWarning.upload_id == upload_id)
    )).scalar_one()
    rows = (await db.execute(
        select(ParseWarning)
        .where(ParseWarning.upload_id == upload_id)
        .offset(pagination.offset).limit(pagination.limit)
    )).scalars().all()
    return Page.build(items=rows, total=total, limit=pagination.limit, offset=pagination.offset)


@router.delete("/api/uploads/{upload_id}", status_code=204)
async def delete_upload(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """Cancel/delete a pending upload — §11.2. Completed uploads are retained by default (§12.5)."""
    upload = await _get_upload_or_404(db, upload_id)
    if upload.status == UploadStatus.ingested:
        raise HTTPException(status_code=409, detail="Completed uploads are retained by default (§12.5)")
    await db.delete(upload)
    db.add(AuditLog(
        actor_id=current_user.id, action="delete_upload",
        entity_type="upload", entity_id=str(upload_id),
    ))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_upload_or_404(db: AsyncSession, upload_id: uuid.UUID) -> Upload:
    result = await db.execute(select(Upload).where(Upload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    return upload


def _staging_dir(upload: Upload) -> str:
    return os.path.join(settings.raw_zips_dir, str(upload.project_id),
                        str(upload.id), "staging")


def _zip_path(upload: Upload) -> str:
    return os.path.join(settings.raw_zips_dir, str(upload.project_id),
                        str(upload.id), "source.zip")
