"""
Bounding-box validity checks — §15.3.
A box is valid if xtl < xbr and ytl < ybr (non-degenerate, non-zero area).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional


@dataclass
class Box:
    xtl: float
    ytl: float
    xbr: float
    ybr: float

    @property
    def width(self) -> float:
        return self.xbr - self.xtl

    @property
    def height(self) -> float:
        return self.ybr - self.ytl

    @property
    def area(self) -> float:
        return self.width * self.height


def box_from_geometry(geometry: dict) -> Optional[Box]:
    """
    Parse a geometry dict {"xtl": f, "ytl": f, "xbr": f, "ybr": f} into a Box.
    Returns None if required keys are missing.
    """
    try:
        return Box(
            xtl=float(geometry["xtl"]),
            ytl=float(geometry["ytl"]),
            xbr=float(geometry["xbr"]),
            ybr=float(geometry["ybr"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def is_valid_box(box: Optional[Box]) -> tuple[bool, str]:
    """
    Returns (is_valid, reason).
    A box is invalid if:
    - It could not be parsed (None)
    - xtl >= xbr (zero or negative width)
    - ytl >= ybr (zero or negative height)
    """
    if box is None:
        return False, "Missing required geometry fields (xtl/ytl/xbr/ybr)"
    if box.xtl >= box.xbr:
        return False, f"Degenerate box: xtl ({box.xtl}) >= xbr ({box.xbr})"
    if box.ytl >= box.ybr:
        return False, f"Degenerate box: ytl ({box.ytl}) >= ybr ({box.ybr})"
    return True, ""
