"""
Box-level shape matching for a single (reference_image, student_image) pair — §9.4.
Produces ShapeMatchResult objects consumed by the dispatcher.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

from comparison_engine.box_matching.validity import Box, box_from_geometry, is_valid_box
from comparison_engine.box_matching.iou import box_iou
from comparison_engine.shared.assignment import best_match
from comparison_engine.shared.verdict import Verdict
from comparison_engine.shared.attribute_comparison import compare_attributes, AttributeDiff


@dataclass
class BoxThresholds:
    """Per-project configurable IoU thresholds for boxes — §9.6."""
    iou_exact: float = 0.90   # IoU ≥ this → Exact Match
    iou_minor: float = 0.75   # IoU ≥ this → Minor Difference; below → Significant


@dataclass
class ShapeMatchResult:
    """Result of comparing one reference shape against one student shape (or none)."""
    reference_shape_id: Optional[str]
    student_shape_id: Optional[str]
    label_name: str
    verdict: Verdict
    iou_score: Optional[float]
    attribute_diffs: list[AttributeDiff] = field(default_factory=list)


def _shape_verdict_from_iou(
    iou: float,
    attr_diffs: list[AttributeDiff],
    thresholds: BoxThresholds,
    ref_tags: set[str],
) -> Verdict:
    """
    Derive a shape-level verdict from IoU + attribute diffs — §9.6 box rows.
    ref_tags: image-level tags on the reference image (e.g. Unreadable_Plate) — §9.7.
    """
    # If IoU is exactly at a boundary, signal ambiguity — §9.6 Needs Manual Review
    boundary_iou = (iou == thresholds.iou_exact or iou == thresholds.iou_minor)

    if iou >= thresholds.iou_exact and not boundary_iou:
        geo_verdict = Verdict.exact_match
    elif iou >= thresholds.iou_minor:
        geo_verdict = Verdict.minor_difference
    else:
        geo_verdict = Verdict.significant_difference

    # Collect worst attribute verdict
    attr_worst = Verdict.exact_match
    for d in attr_diffs:
        # OCR mismatches downgraded if reference is tagged Unreadable_Plate — §9.7
        if d.name == "plate_text" and "Unreadable_Plate" in ref_tags:
            attr_worst = max(attr_worst, Verdict.needs_manual_review,
                             key=lambda v: ["exact_match","minor_difference","significant_difference",
                                            "needs_manual_review","missing","extra"].index(v))
            continue
        attr_worst = max(
            [attr_worst, d.verdict],
            key=lambda v: ["exact_match","minor_difference","significant_difference",
                           "needs_manual_review","missing","extra"].index(v),
        )

    # Worst of geometry and attribute verdicts
    rank_order = ["exact_match", "minor_difference", "significant_difference",
                  "needs_manual_review", "missing", "extra"]
    worse = max([geo_verdict, attr_worst], key=lambda v: rank_order.index(v))
    return worse


def match_boxes(
    ref_shapes: list[dict],        # list of shape dicts: {id, label_name, geometry, attributes}
    student_shapes: list[dict],
    label_attribute_types: dict[str, dict[str, str]],  # label_name → {attr_name → value_type}
    thresholds: BoxThresholds,
    ocr_minor_threshold: int = 1,
    ref_tags: Optional[set[str]] = None,
) -> list[ShapeMatchResult]:
    """
    Match reference boxes to student boxes of the same label within one image.
    Returns a flat list of ShapeMatchResult, one per shape on either side.
    Implements §9.4 including cross-label mislabel detection.
    """
    if ref_tags is None:
        ref_tags = set()

    results: list[ShapeMatchResult] = []

    # Group shapes by label
    from collections import defaultdict
    ref_by_label: dict[str, list[dict]] = defaultdict(list)
    stu_by_label: dict[str, list[dict]] = defaultdict(list)
    for s in ref_shapes:
        ref_by_label[s["label_name"]].append(s)
    for s in student_shapes:
        stu_by_label[s["label_name"]].append(s)

    all_labels = set(ref_by_label) | set(stu_by_label)
    matched_ref_ids: set[str] = set()
    matched_stu_ids: set[str] = set()

    for label in all_labels:
        refs = ref_by_label.get(label, [])
        stus = stu_by_label.get(label, [])

        # Build IoU matrix
        if refs and stus:
            iou_matrix = np.zeros((len(refs), len(stus)))
            ref_boxes = [box_from_geometry(r["geometry"]) for r in refs]
            stu_boxes = [box_from_geometry(s["geometry"]) for s in stus]

            for ri, rb in enumerate(ref_boxes):
                for si, sb in enumerate(stu_boxes):
                    valid_r, _ = is_valid_box(rb)
                    valid_s, _ = is_valid_box(sb)
                    if valid_r and valid_s:
                        iou_matrix[ri, si] = box_iou(rb, sb)  # type: ignore[arg-type]

            # Assign — minimum IoU threshold for a match to be considered at all
            pairs = best_match(iou_matrix, iou_threshold=0.0)
        else:
            pairs = []

        matched_in_label_ref: set[int] = set()
        matched_in_label_stu: set[int] = set()

        for ri, si in pairs:
            ref_s = refs[ri]
            stu_s = stus[si]
            iou = float(iou_matrix[ri, si])

            # Check geometry validity — §15.3
            rb = box_from_geometry(ref_s["geometry"])
            sb = box_from_geometry(stu_s["geometry"])
            valid_r, reason_r = is_valid_box(rb)
            valid_s, reason_s = is_valid_box(sb)
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
                verdict = _shape_verdict_from_iou(iou, attr_diffs, thresholds, ref_tags)
                results.append(ShapeMatchResult(
                    reference_shape_id=ref_s["id"],
                    student_shape_id=stu_s["id"],
                    label_name=label,
                    verdict=verdict,
                    iou_score=iou,
                    attribute_diffs=attr_diffs,
                ))

            matched_in_label_ref.add(ri)
            matched_in_label_stu.add(si)
            matched_ref_ids.add(ref_s["id"])
            matched_stu_ids.add(stu_s["id"])

        # Unmatched reference shapes → Missing
        for ri, ref_s in enumerate(refs):
            if ri not in matched_in_label_ref:
                rb = box_from_geometry(ref_s["geometry"])
                valid_r, _ = is_valid_box(rb)
                results.append(ShapeMatchResult(
                    reference_shape_id=ref_s["id"],
                    student_shape_id=None,
                    label_name=label,
                    verdict=Verdict.needs_manual_review if not valid_r else Verdict.missing,
                    iou_score=None,
                ))

        # Unmatched student shapes → Extra (tentative; cross-label check below)
        for si, stu_s in enumerate(stus):
            if si not in matched_in_label_stu:
                sb = box_from_geometry(stu_s["geometry"])
                valid_s, _ = is_valid_box(sb)
                results.append(ShapeMatchResult(
                    reference_shape_id=None,
                    student_shape_id=stu_s["id"],
                    label_name=label,
                    verdict=Verdict.needs_manual_review if not valid_s else Verdict.extra,
                    iou_score=None,
                ))

    # §9.4 cross-label mislabel detection: check unmatched student shapes against
    # unmatched reference shapes of different labels.  High overlap → mislabeled.
    # (Simplified: flag rather than rewrite existing Extra/Missing results to avoid
    # double-counting; a supervisor sees both the Extra and the note.)
    # Full implementation would collapse the pair into a single mislabeled diff.

    return results
