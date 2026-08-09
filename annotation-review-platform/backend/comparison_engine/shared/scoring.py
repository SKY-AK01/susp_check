"""
Numeric image-level score (0–100) — §9.8.
Used purely for sorting/prioritization in the dashboard; verdict is always
the authoritative classification, never derived from this score alone.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

from comparison_engine.shared.verdict import Verdict


@dataclass
class ScoringWeights:
    """
    Per-project configurable weights — §9.8.
    All defaults are tuning starting points; expect iterative calibration (§21.2).
    """
    iou_weight: float = 0.6          # contribution of mean IoU across matched shapes
    missing_penalty: float = 15.0    # deducted per Missing shape
    extra_penalty: float = 10.0      # deducted per Extra shape
    attr_mismatch_penalty: float = 5.0  # deducted per attribute mismatch


def compute_image_score(
    shape_ious: list[Optional[float]],
    shape_verdicts: list[Verdict],
    attr_mismatch_count: int,
    weights: Optional[ScoringWeights] = None,
) -> float:
    """
    Compute a 0–100 score for a single image comparison result.

    shape_ious: IoU per matched shape pair (None for Missing/Extra shapes)
    shape_verdicts: verdict per shape (including Missing/Extra)
    attr_mismatch_count: total number of attribute-level mismatches across all shapes
    """
    if weights is None:
        weights = ScoringWeights()

    # Base score starts at 100
    score = 100.0

    # Penalise missing and extra shapes
    missing_count = sum(1 for v in shape_verdicts if v == Verdict.missing)
    extra_count = sum(1 for v in shape_verdicts if v == Verdict.extra)
    score -= missing_count * weights.missing_penalty
    score -= extra_count * weights.extra_penalty

    # Penalise attribute mismatches
    score -= attr_mismatch_count * weights.attr_mismatch_penalty

    # IoU component: deduct from the iou_weight portion based on mean IoU gap
    valid_ious = [iou for iou in shape_ious if iou is not None]
    if valid_ious:
        mean_iou = sum(valid_ious) / len(valid_ious)
        # iou_weight * 100 points available; full marks at IoU=1.0, zero at IoU=0
        score -= weights.iou_weight * 100.0 * (1.0 - mean_iou)

    return max(0.0, min(100.0, score))
