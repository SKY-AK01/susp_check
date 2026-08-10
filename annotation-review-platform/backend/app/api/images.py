"""
Images / shapes / overlay API — §11.6.
The overlay endpoint is the hot path for the image detail view and returns
all data needed for GT-vs-student rendering in a single call (§FR-8.2).
"""
from __future__ import annotations
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import require_any
from app.config import settings
from app.database import get_db
from app.models.comparison import ComparisonResult, ShapeDiff
from app.models.image import Image, Shape, ShapeAttribute, Tag
from app.models.user import User
from app.schemas.comparison import OverlayPayload, ShapeData, ShapeDiffOut

router = APIRouter(prefix="/api", tags=["images"])


@router.get("/images/{image_id}")
async def get_image_metadata(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """Image metadata + authenticated URL for the image bytes — §11.6."""
    img = await _get_image_or_404(db, image_id)
    url = f"/api/images/{image_id}/bytes" if img.storage_ref else None
    return {
        "id": img.id,
        "raw_filename": img.raw_filename,
        "normalized_key": img.normalized_key,
        "width": img.width,
        "height": img.height,
        "content_hash": img.content_hash,
        "url": url,
    }


@router.get("/images/{image_id}/bytes")
async def serve_image_bytes(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    Serve image bytes directly from disk — §22.6.
    All routes are authenticated; no public unauthenticated paths.
    """
    img = await _get_image_or_404(db, image_id)
    if not img.storage_ref:
        raise HTTPException(status_code=404, detail="Image bytes not available")
    full_path = os.path.join(settings.images_dir, img.storage_ref)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Image file not found on disk")
    return FileResponse(full_path)


@router.get("/images/{image_id}/shapes")
async def list_image_shapes(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """All shapes for one image — vector data for overlay rendering — §11.6."""
    await _get_image_or_404(db, image_id)
    shapes = (await db.execute(select(Shape).where(Shape.image_id == image_id))).scalars().all()
    result = []
    for s in shapes:
        attrs = (await db.execute(
            select(ShapeAttribute).where(ShapeAttribute.shape_id == s.id)
        )).scalars().all()
        result.append(ShapeData(
            id=s.id,
            label_name=s.label_name,
            type=s.type,
            geometry=s.geometry,
            attributes={a.name: a.value for a in attrs},
            geometry_invalid=s.geometry_invalid,
        ))
    return result


@router.get("/comparison-results/{result_id}/overlay", response_model=OverlayPayload)
async def get_overlay(
    result_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any),
):
    """
    Combined payload for the image detail viewer — §11.6, FR-8.1–8.3.
    Single API call returns: reference image + shapes, student image + shapes,
    all ShapeDiffs with attribute diff badges.  Prevents N+1 from the frontend.
    """
    result = (await db.execute(
        select(ComparisonResult).where(ComparisonResult.id == result_id)
    )).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    # Student image + shapes
    stu_img = await _get_image_or_404(db, result.student_image_id)
    stu_shapes = await _load_shapes(db, result.student_image_id)
    stu_tags = await _load_tags(db, result.student_image_id)

    stu_url = f"/api/images/{result.student_image_id}/bytes" if stu_img.storage_ref else None

    # Reference image + shapes (may be None for Extra verdicts)
    ref_shapes: list[ShapeData] = []
    ref_tags: list[str] = []
    ref_url: Optional[str] = None
    ref_image_id: Optional[uuid.UUID] = None

    if result.reference_image_id:
        ref_img = (await db.execute(
            select(Image).where(Image.id == result.reference_image_id)
        )).scalar_one_or_none()
        if ref_img:
            ref_image_id = ref_img.id
            ref_url = f"/api/images/{ref_img.id}/bytes" if ref_img.storage_ref else None
            ref_shapes = await _load_shapes(db, ref_img.id)
            ref_tags = list(await _load_tags(db, ref_img.id))

    # Shape diffs
    diffs = (await db.execute(
        select(ShapeDiff).where(ShapeDiff.comparison_result_id == result_id)
    )).scalars().all()

    return OverlayPayload(
        reference_image_url=ref_url,
        reference_image_id=ref_image_id,
        student_image_url=stu_url,
        student_image_id=result.student_image_id,
        reference_shapes=ref_shapes,
        student_shapes=stu_shapes,
        shape_diffs=[ShapeDiffOut.model_validate(d) for d in diffs],
        ref_tags=list(ref_tags),
        student_tags=list(stu_tags),
        student_image_width=stu_img.width,
        student_image_height=stu_img.height,
        reference_image_width=ref_img.width if result.reference_image_id and ref_img else None,
        reference_image_height=ref_img.height if result.reference_image_id and ref_img else None,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_image_or_404(db: AsyncSession, image_id: uuid.UUID) -> Image:
    img = (await db.execute(select(Image).where(Image.id == image_id))).scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return img


async def _load_shapes(db: AsyncSession, image_id: uuid.UUID) -> list[ShapeData]:
    shapes = (await db.execute(select(Shape).where(Shape.image_id == image_id))).scalars().all()
    result = []
    for s in shapes:
        attrs = (await db.execute(
            select(ShapeAttribute).where(ShapeAttribute.shape_id == s.id)
        )).scalars().all()
        result.append(ShapeData(
            id=s.id,
            label_name=s.label_name,
            type=s.type,
            geometry=s.geometry,
            attributes={a.name: a.value for a in attrs},
            geometry_invalid=s.geometry_invalid,
        ))
    return result


async def _load_tags(db: AsyncSession, image_id: uuid.UUID) -> set[str]:
    tags = (await db.execute(select(Tag).where(Tag.image_id == image_id))).scalars().all()
    return {t.name for t in tags}
