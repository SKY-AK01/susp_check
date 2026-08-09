"""
Polygon validity checks — §15.3.
A polygon is valid if:
- It has at least 3 distinct points.
- It is not self-intersecting (checked via Shapely).
Invalid polygons are excluded from IoU scoring and flagged Needs Manual Review.
"""
from __future__ import annotations
from typing import Optional
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.validation import explain_validity


def polygon_from_geometry(geometry: dict) -> Optional[ShapelyPolygon]:
    """
    Parse a geometry dict {"points": [[x, y], ...]} into a Shapely Polygon.
    Returns None if the geometry is malformed.
    """
    try:
        points = geometry["points"]
        if len(points) < 3:
            return None
        return ShapelyPolygon(points)
    except (KeyError, TypeError, ValueError):
        return None


def is_valid_polygon(poly: Optional[ShapelyPolygon]) -> tuple[bool, str]:
    """
    Returns (is_valid, reason).
    Checks for None, insufficient points, and self-intersection via Shapely.
    """
    if poly is None:
        return False, "Could not parse polygon geometry (missing/malformed points)"
    if len(poly.exterior.coords) < 4:  # Shapely closes the ring; need ≥ 4 coords
        return False, "Polygon has fewer than 3 distinct points"
    if not poly.is_valid:
        return False, f"Self-intersecting or degenerate polygon: {explain_validity(poly)}"
    return True, ""
