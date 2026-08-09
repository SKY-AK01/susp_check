from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from app.models.upload import UploadStatus


class UploadInitiate(BaseModel):
    is_reference: bool = False
    chunk_count: Optional[int] = None  # if known upfront


class UploadOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: UploadStatus
    is_reference: bool
    progress_pct: float
    processed_count: int
    total_count: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ParseWarningOut(BaseModel):
    id: uuid.UUID
    upload_id: uuid.UUID
    image_id: Optional[uuid.UUID]
    severity: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}
