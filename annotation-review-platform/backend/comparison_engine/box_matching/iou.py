"""
Bounding-box IoU computation — §9.4 (ML-Model geometry).
Standard rectangle IoU = intersection / union.
"""
from __future__ import annotations
from comparison_engine.box_matching.validity import Box


def box_iou(a: Box, b: Box) -> float:
    """
    Compute Intersection-over-Union for two axis-aligned bounding boxes.
    Returns 0.0 if there is no intersection.
    """
    # Intersection rectangle
    inter_xtl = max(a.xtl, b.xtl)
    inter_ytl = max(a.ytl, b.ytl)
    inter_xbr = min(a.xbr, b.xbr)
    inter_ybr = min(a.ybr, b.ybr)

    inter_w = max(0.0, inter_xbr - inter_xtl)
    inter_h = max(0.0, inter_ybr - inter_ytl)
    intersection = inter_w * inter_h

    if intersection == 0.0:
        return 0.0

    union = a.area + b.area - intersection
    if union <= 0.0:
        return 0.0
    return intersection / union
