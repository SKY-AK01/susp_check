"""
Six-state verdict taxonomy and image-level rollup — §9.6.
Kept in shared/ because it applies to both box and polygon geometry types.
"""
from enum import Enum


class Verdict(str, Enum):
    exact_match = "exact_match"
    minor_difference = "minor_difference"
    significant_difference = "significant_difference"
    missing = "missing"
    extra = "extra"
    needs_manual_review = "needs_manual_review"


# Severity order for worst-case-wins rollup (higher index = more severe).
_SEVERITY = [
    Verdict.exact_match,
    Verdict.minor_difference,
    Verdict.significant_difference,
    Verdict.needs_manual_review,
    Verdict.missing,
    Verdict.extra,
]

# Missing and Extra are treated as equally severe at image level
_SEVERITY_RANK = {v: i for i, v in enumerate(_SEVERITY)}
_SEVERITY_RANK[Verdict.extra] = _SEVERITY_RANK[Verdict.missing]  # tie at top


def rollup_verdicts(verdicts: list[Verdict]) -> Verdict:
    """
    Worst-case-wins rollup of a list of shape-level verdicts to produce
    an image-level verdict — §9.6.
    An image with even one Missing/Extra/Significant/Needs Manual Review is
    not reported as an overall match.
    """
    if not verdicts:
        return Verdict.exact_match
    return max(verdicts, key=lambda v: _SEVERITY_RANK[v])
