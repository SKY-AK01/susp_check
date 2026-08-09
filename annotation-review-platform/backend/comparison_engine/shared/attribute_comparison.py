"""
Attribute comparison for matched shape pairs — §9.5.
Handles categorical, free_text/OCR, and linking attributes.
Linking attributes (vehicle_id) are NOT compared for value equality here —
they are used upstream in grouping (§9.3) and excluded from this step.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional

from Levenshtein import distance as levenshtein_distance

from comparison_engine.shared.verdict import Verdict


@dataclass
class AttributeDiff:
    name: str
    ref_value: Optional[str]
    student_value: Optional[str]
    edit_distance: Optional[int]    # set only for free_text attributes
    verdict: Verdict


def compare_categorical(
    name: str,
    ref_value: Optional[str],
    student_value: Optional[str],
) -> AttributeDiff:
    """
    Categorical attribute (fixed value set, e.g. Position, vehicle_type).
    Exact match required; anything else = significant_difference — §9.5.
    """
    if ref_value == student_value:
        verdict = Verdict.exact_match
    else:
        verdict = Verdict.significant_difference
    return AttributeDiff(
        name=name,
        ref_value=ref_value,
        student_value=student_value,
        edit_distance=None,
        verdict=verdict,
    )


def compare_free_text(
    name: str,
    ref_value: Optional[str],
    student_value: Optional[str],
    ocr_minor_threshold: int = 1,
) -> AttributeDiff:
    """
    Free-text / OCR attribute (e.g. plate_text).
    edit_distance == 0 → exact_match
    edit_distance <= threshold → minor_difference  (0/O, 1/I confusions)
    edit_distance > threshold → significant_difference
    §9.5 — threshold is project-configurable; default 1.
    """
    r = (ref_value or "").strip()
    s = (student_value or "").strip()

    if r == s:
        return AttributeDiff(name=name, ref_value=ref_value, student_value=student_value,
                             edit_distance=0, verdict=Verdict.exact_match)

    dist = levenshtein_distance(r, s)
    if dist <= ocr_minor_threshold:
        verdict = Verdict.minor_difference
    else:
        verdict = Verdict.significant_difference

    return AttributeDiff(name=name, ref_value=ref_value, student_value=student_value,
                         edit_distance=dist, verdict=verdict)


def compare_attributes(
    ref_attrs: dict[str, str],
    student_attrs: dict[str, str],
    label_attribute_types: dict[str, str],  # name → "categorical" | "free_text" | "linking"
    ocr_minor_threshold: int = 1,
) -> list[AttributeDiff]:
    """
    Compare all non-linking attributes on a matched shape pair.
    Attributes present in the reference but absent in the student (and vice
    versa) are treated as mismatches.
    """
    diffs: list[AttributeDiff] = []

    # All attribute names across both sides, excluding linking-type attributes
    all_names = set(ref_attrs) | set(student_attrs)
    for name in sorted(all_names):
        attr_type = label_attribute_types.get(name, "free_text")
        if attr_type == "linking":
            # vehicle_id and similar linking attributes — not compared here (§9.5)
            continue

        ref_val = ref_attrs.get(name)
        stu_val = student_attrs.get(name)

        if attr_type == "categorical":
            diffs.append(compare_categorical(name, ref_val, stu_val))
        else:
            diffs.append(compare_free_text(name, ref_val, stu_val, ocr_minor_threshold))

    return diffs
