from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.models.comparison import Verdict, ReviewStatus, ReferenceSourceType, RunStatus


class ReferenceSetCreate(BaseModel):
    source_type: ReferenceSourceType
    reference_upload_id: Optional[uuid.UUID] = None    # uploaded_gt
    reference_student_id: Optional[uuid.UUID] = None   # student_reference


class ReferenceSetOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    source_type: ReferenceSourceType
    reference_upload_id: Optional[uuid.UUID]
    reference_student_id: Optional[uuid.UUID]
    created_at: datetime

    model_config = {"from_attributes": True}


class RunCreate(BaseModel):
    upload_id: uuid.UUID   # the student-submissions upload to evaluate


class ComparisonRunOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    reference_set_id: uuid.UUID
    upload_id: uuid.UUID
    status: RunStatus
    progress_pct: float
    processed_count: int
    total_count: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ShapeDiffOut(BaseModel):
    id: uuid.UUID
    reference_shape_id: Optional[uuid.UUID]
    student_shape_id: Optional[uuid.UUID]
    verdict: Verdict
    iou_score: Optional[float]
    attribute_diffs: Optional[list]

    model_config = {"from_attributes": True}


class ComparisonResultOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    student_id: uuid.UUID
    student_image_id: uuid.UUID
    reference_image_id: Optional[uuid.UUID]
    verdict: Verdict
    score: Optional[float]
    review_status: ReviewStatus
    created_at: datetime
    shape_diffs: List[ShapeDiffOut] = []

    model_config = {"from_attributes": True}


class ReviewStatusUpdate(BaseModel):
    review_status: ReviewStatus


class BulkStatusUpdate(BaseModel):
    result_ids: List[uuid.UUID]
    review_status: ReviewStatus


class FeedbackCreate(BaseModel):
    note: str
    shape_diff_id: Optional[uuid.UUID] = None


class FeedbackOut(BaseModel):
    id: uuid.UUID
    comparison_result_id: Optional[uuid.UUID]
    shape_diff_id: Optional[uuid.UUID]
    reviewer_id: uuid.UUID
    note: str
    created_at: datetime

    model_config = {"from_attributes": True}


# Overlay payload — §11.6 single-call for image detail view
class ShapeData(BaseModel):
    id: uuid.UUID
    label_name: Optional[str]
    type: str
    geometry: dict
    attributes: dict
    geometry_invalid: bool


class OverlayPayload(BaseModel):
    reference_image_url: Optional[str]
    reference_image_id: Optional[uuid.UUID]
    student_image_url: Optional[str]
    student_image_id: uuid.UUID
    reference_shapes: List[ShapeData]
    student_shapes: List[ShapeData]
    shape_diffs: List[ShapeDiffOut]
    ref_tags: List[str]
    student_tags: List[str]
