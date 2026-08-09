"""
Direct image upload for a project — supervisor uploads raw image files
without packaging them into a ZIP first.  Useful for:
 - Uploading the actual source photos so overlay visualisation works
 - Uploading a Ground Truth image set outside of CVAT
Images are stored with content-hash dedup (§12.3) and linked to any
existing Image rows in the project that share the same normalized key.
"""
from __future__ import annotations

import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_supervisor_or_above
from app.config import settings
from app.database import get_db
from app.models.image import Image
from app.models.project import Project
from app.models.user import User
from app.services.ingestion_service import content_hash_and_store, normalize_image_key

router = APIRouter(prefix="/api", tags=["direct-images"])

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff"}
MAX_IMAGE_BYTES = 50 * 1024 * 1024  # 50 MB per image


class DirectUploadResult(BaseModel):
    filename: str
    content_hash: str
    storage_ref: str
    matched_image_count: int   # how many DB Image rows were linked
    already_existed: bool


class DirectUploadResponse(BaseModel):
    project_id: uuid.UUID
    uploaded: List[DirectUploadResult]
    skipped: List[str]   # filenames skipped due to bad extension / size


@router.post(
    "/projects/{project_id}/images/direct",
    response_model=DirectUploadResponse,
    status_code=201,
)
async def direct_image_upload(
    project_id: uuid.UUID,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_above),
):
    """
    Upload one or more image files directly to a project.
    Files are stored content-addressed and automatically linked to any
    existing Image rows whose normalized_key matches the uploaded filename.
    """
    proj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    uploaded: List[DirectUploadResult] = []
    skipped: List[str] = []

    for upload_file in files:
        fname = upload_file.filename or "unknown"
        ext = os.path.splitext(fname)[1].lstrip(".").lower()

        if ext not in ALLOWED_EXTENSIONS:
            skipped.append(fname)
            continue

        image_bytes = await upload_file.read()

        if len(image_bytes) > MAX_IMAGE_BYTES:
            skipped.append(f"{fname} (too large: {len(image_bytes)//1024}KB)")
            continue

        # Store content-addressed on disk — §12.2, §12.3
        content_hash, storage_ref = content_hash_and_store(image_bytes, fname)
        already_existed = False

        # Check if this exact file was already stored
        existing_check = (await db.execute(
            select(Image).where(Image.content_hash == content_hash).limit(1)
        )).scalar_one_or_none()
        if existing_check:
            already_existed = True

        # Link to matching Image rows in this project (by normalized key)
        norm_key = normalize_image_key(fname)
        matching_images = (await db.execute(
            select(Image).where(
                Image.project_id == project_id,
                Image.normalized_key == norm_key,
                Image.storage_ref.is_(None),   # only update rows that have no file yet
            )
        )).scalars().all()

        for img in matching_images:
            img.content_hash = content_hash
            img.storage_ref = storage_ref

        await db.flush()

        uploaded.append(DirectUploadResult(
            filename=fname,
            content_hash=content_hash,
            storage_ref=storage_ref,
            matched_image_count=len(matching_images),
            already_existed=already_existed,
        ))

    return DirectUploadResponse(
        project_id=project_id,
        uploaded=uploaded,
        skipped=skipped,
    )


@router.get("/projects/{project_id}/images/direct")
async def list_project_image_files(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_supervisor_or_above),
):
    """
    List all distinct image files stored for a project (by content_hash),
    with how many Image rows reference each one.
    Useful for supervisors to see which source images have been uploaded.
    """
    proj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    rows = (await db.execute(
        select(
            Image.content_hash,
            Image.raw_filename,
            Image.storage_ref,
            Image.normalized_key,
        )
        .where(
            Image.project_id == project_id,
            Image.storage_ref.is_not(None),
        )
        .distinct(Image.content_hash)
        .order_by(Image.normalized_key)
    )).all()

    return [
        {
            "content_hash": r.content_hash,
            "raw_filename": r.raw_filename,
            "normalized_key": r.normalized_key,
            "url": f"/api/images/by-hash/{r.content_hash}",
        }
        for r in rows
    ]


@router.get("/images/by-hash/{content_hash}")
async def serve_image_by_hash(
    content_hash: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_supervisor_or_above),
):
    """Serve an image directly by its content hash — useful for preview."""
    from fastapi.responses import FileResponse

    img = (await db.execute(
        select(Image).where(Image.content_hash == content_hash).limit(1)
    )).scalar_one_or_none()

    if not img or not img.storage_ref:
        raise HTTPException(status_code=404, detail="Image not found")

    full_path = os.path.join(settings.images_dir, img.storage_ref)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Image file missing from disk")

    return FileResponse(full_path)
