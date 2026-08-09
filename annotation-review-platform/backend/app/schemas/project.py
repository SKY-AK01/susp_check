from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.models.project import GTMode


class LabelAttributeCreate(BaseModel):
    name: str
    value_type: str
    allowed_values: Optional[list] = None
    is_grouping_key: bool = False


class LabelCreate(BaseModel):
    name: str
    geometry_type: str
    attributes: List[LabelAttributeCreate] = []


class ProjectCreate(BaseModel):
    name: str
    project_type: str
    gt_mode_default: GTMode
    labels: List[LabelCreate] = []
    box_iou_exact: Optional[float] = None
    box_iou_minor: Optional[float] = None
    polygon_iou_exact: Optional[float] = None
    polygon_iou_minor: Optional[float] = None
    ocr_edit_distance_minor: Optional[int] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    gt_mode_default: Optional[GTMode] = None
    box_iou_exact: Optional[float] = None
    box_iou_minor: Optional[float] = None
    polygon_iou_exact: Optional[float] = None
    polygon_iou_minor: Optional[float] = None
    ocr_edit_distance_minor: Optional[int] = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    project_type: str
    gt_mode_default: GTMode
    box_iou_exact: Optional[float]
    box_iou_minor: Optional[float]
    polygon_iou_exact: Optional[float]
    polygon_iou_minor: Optional[float]
    ocr_edit_distance_minor: Optional[int]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
