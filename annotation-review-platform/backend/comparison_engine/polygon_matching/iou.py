"""
Polygon IoU computation using Shapely — §9.4 (Car-Parts geometry).
Handles non-rectangular polygons correctly; uses computational-geometry
intersection/union rather than bounding-box approximation.
"""
from __future__ import annotations
from shapely.geometry import Polygon as ShapelyPolygon


def polygon_iou(a: ShapelyPolygon, b: ShapelyPolygon) -> float:
    """
    Compute Intersection-over-Union for two polygons using Shapely.
    Returns 0.0 if either polygon is empty or there is no intersection.
    Both polygons are assumed to be valid (caller must check is_valid_polygon
    before calling this function).
    """
    if a.is_empty or b.is_empty:
        return 0.0

    try:
        intersection_area = a.intersection(b).area
    except Exception:
        # Shapely can occasionally raise on pathological geometry despite
        # passing is_valid; return 0 rather than propagate.
        return 0.0

    if intersection_area == 0.0:
        return 0.0

    union_area = a.union(b).area
    if union_area <= 0.0:
        return 0.0

    return intersection_area / union_area
