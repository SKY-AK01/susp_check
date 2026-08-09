"""
Polygon-level shape matching for a single (reference_image, student_image) pair — §9.4.
Mirrors box_matching/matcher.py in structure but uses Shapely polygon IoU.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from collections import defaultdict
from typing import Optional
import numpy as np

from comparison_engine.polygon_matching.validity import polygon_from_geometry, is_valid_polygon
from comparison_engine.polygon_matching.iou import polygon_iou
from comparison_engine.shared.assignment import best_match
from comparison_engine.shared.verdict import Verdict
from comparison_engine.shared.attribute_comparison import compare_attributes, AttributeDiff


@dataclass
class PolygonThresholds:
    """Per-project configurable IoU thresholds for polygons — §9.6."""
    iou_exact: float = 0.90   # IoU ≥ this → Exact Match
    iou_minor: float = 0.60   # IoU ≥ this → Minor Difference; below → Significant


@dataclass
class ShapeMatchResult:
    reference_shape_id: Optional[str]
    student_shape_id: Optional[str]
    label_name: str
    verdict: Verdict
    iou_score: Optional[float]
    attribute_diffs: list[AttributeDiff] = field(default_factory=list)


def _shape_verdict_from_iou(
    iou: float,
    attr_diffs: list[AttributeDiff],
    thresholds: PolygonThresholds,
) -> Verdict:
    """Derive shape-level verdict from IoU + attribute diffs — §9.6 polygon rows."""
    if iou >= thresholds.iou_exact:
        geo_verdict = Verdict.exact_match
    elif iou >= thresholds.iou_minor:
        geo_verdict = Verdict.minor_difference
    else:
        geo_verdict = Verdict.significant_difference

    rank_order = ["exact_match", "minor_difference", "significant_difference",
                  "needs_manual_review", "missing", "extra"]

    attr_worst = Verdict.exact_match
    for d in attr_diffs:
        if rank_order.index(d.verdict) > rank_order.index(attr_worst):
            attr_worst = d.verdict

    return max([geo_verdict, attr_worst], key=lambda v: rank_order.index(v))


def match_polygons(
    ref_shapes: list[dict],
    student_shapes: list[dict],
    label_attribute_types: dict[str, dict[str, str]],
    thresholds: PolygonThresholds,
    ocr_minor_threshold: int = 1,
    ref_tags: Optional[set[str]] = None,
) -> list[ShapeMatchResult]:
    """
    Match reference polygons to student polygons of the same label within one image.
    Implements §9.4 for polygon geometry.
    """
    if ref_tags is None:
        ref_tags = set()

    results: list[ShapeMatchResult] = []

    ref_by_label: dict[str, list[dict]] = defaultdict(list)
    stu_by_label: dict[str, list[dict]] = defaultdict(list)
    for s in ref_shapes:
        ref_by_label[s["label_name"]].append(s)
    for s in student_shapes:
        stu_by_label[s["label_name"]].append(s)

    all_labels = set(ref_by_label) | set(stu_by_label)

    for label in all_labels:
        refs = ref_by_label.get(label, [])
        stus = stu_by_label.get(label, [])

        ref_polys = [polygon_from_geometry(r["geometry"]) for r in refs]
        stu_polys = [polygon_from_geometry(s["geometry"]) for s in stus]

        iou_matrix = np.zeros((len(refs), len(stus)))
        if refs and stus:
            for ri, rp in enumerate(ref_polys):
                for si, sp in enumerate(stu_polys):
                    valid_r, _ = is_valid_polygon(rp)
                    valid_s, _ = is_valid_polygon(sp)
                    if valid_r and valid_s:
                        iou_matrix[ri, si] = polygon_iou(rp, sp)  # type: ignore[arg-type]

            pairs = best_match(iou_matrix, iou_threshold=0.0)
        else:
            pairs = []

        matched_ref_idx: set[int] = set()
        matched_stu_idx: set[int] = set()

        for ri, si in pairs:
            ref_s = refs[ri]
            stu_s = stus[si]
            iou = float(iou_matrix[ri, si])
            rp = ref_polys[ri]
            sp = stu_polys[si]

            valid_r, _ = is_valid_polygon(rp)
            valid_s, _ = is_valid_polygon(sp)

            if not valid_r or not valid_s:
                results.append(ShapeMatchResult(
                    reference_shape_id=ref_s["id"],
                    student_shape_id=stu_s["id"],
                    label_name=label,
                    verdict=Verdict.needs_manual_review,
                    iou_score=None,
                ))
            else:
                attr_types = label_attribute_types.get(label, {})
                attr_diffs = compare_attributes(
                    ref_s.get("attributes", {}),
                    stu_s.get("attributes", {}),
                    attr_types,
                    ocr_minor_threshold,
                )
                verdict = _shape_verdict_from_iou(iou, attr_diffs, thresholds)
                results.append(ShapeMatchResult(
                    reference_shape_id=ref_s["id"],
                    student_shape_id=stu_s["id"],
                    label_name=label,
                    verdict=verdict,
                    iou_score=iou,
                    attribute_diffs=attr_diffs,
                ))

            matched_ref_idx.add(ri)
            matched_stu_idx.add(si)

        # Unmatched reference shapes → Missing
        for ri, ref_s in enumerate(refs):
            if ri not in matched_ref_idx:
                valid_r, _ = is_valid_polygon(ref_polys[ri])
                results.append(ShapeMatchResult(
                    reference_shape_id=ref_s["id"],
                    student_shape_id=None,
                    label_name=label,
                    verdict=Verdict.needs_manual_review if not valid_r else Verdict.missing,
                    iou_score=None,
                ))

        # Unmatched student shapes → Extra
        for si, stu_s in enumerate(stus):
            if si not in matched_stu_idx:
                valid_s, _ = is_valid_polygon(stu_polys[si])
                results.append(ShapeMatchResult(
                    reference_shape_id=None,
                    student_shape_id=stu_s["id"],
                    label_name=label,
                    verdict=Verdict.needs_manual_review if not valid_s else Verdict.extra,
                    iou_score=None,
                ))

    return results
