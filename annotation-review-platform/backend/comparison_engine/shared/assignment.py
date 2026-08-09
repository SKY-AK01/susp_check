"""
Bipartite shape matching via the Hungarian algorithm — §9.4.
Used by both box_matching and polygon_matching after their respective IoU
matrices are computed.  The assignment logic itself is geometry-agnostic.
"""
from __future__ import annotations
import numpy as np
from scipy.optimize import linear_sum_assignment


def hungarian_match(
    iou_matrix: np.ndarray,
    iou_threshold: float = 0.0,
) -> list[tuple[int, int]]:
    """
    Given an IoU matrix of shape (n_reference, n_student), return a list of
    (ref_idx, student_idx) pairs that represent the optimal assignment.

    Pairs whose IoU falls below `iou_threshold` are excluded — they are
    treated as unmatched (the reference shape has no valid student counterpart
    and vice versa).

    Uses scipy.optimize.linear_sum_assignment on a cost matrix = 1 - IoU,
    which is the standard Hungarian implementation in SciPy (§9.4).
    """
    if iou_matrix.size == 0:
        return []

    # Cost = 1 - IoU so the algorithm minimises cost = maximises IoU
    cost = 1.0 - iou_matrix
    row_ind, col_ind = linear_sum_assignment(cost)

    matched = []
    for r, c in zip(row_ind, col_ind):
        if iou_matrix[r, c] >= iou_threshold:
            matched.append((int(r), int(c)))
    return matched


def greedy_match(
    iou_matrix: np.ndarray,
    iou_threshold: float = 0.0,
) -> list[tuple[int, int]]:
    """
    Greedy descending-IoU matching — O(n²) but produces identical results to
    Hungarian for the typical case of 1–3 shapes per label per image (§9.4).
    Used as a faster path for very small groups.
    """
    if iou_matrix.size == 0:
        return []

    n_ref, n_stu = iou_matrix.shape
    used_ref: set[int] = set()
    used_stu: set[int] = set()
    matched: list[tuple[int, int]] = []

    # Collect all (iou, r, c) above threshold, sort descending
    candidates = [
        (iou_matrix[r, c], r, c)
        for r in range(n_ref)
        for c in range(n_stu)
        if iou_matrix[r, c] >= iou_threshold
    ]
    candidates.sort(reverse=True)

    for iou, r, c in candidates:
        if r not in used_ref and c not in used_stu:
            matched.append((r, c))
            used_ref.add(r)
            used_stu.add(c)

    return matched


def best_match(
    iou_matrix: np.ndarray,
    iou_threshold: float = 0.0,
) -> list[tuple[int, int]]:
    """
    Picks greedy for small groups (≤ 4 shapes), Hungarian otherwise.
    Ensures each reference shape and each student shape is claimed at most once.
    """
    if iou_matrix.size == 0:
        return []
    n_ref, n_stu = iou_matrix.shape
    if max(n_ref, n_stu) <= 4:
        return greedy_match(iou_matrix, iou_threshold)
    return hungarian_match(iou_matrix, iou_threshold)
