import { Verdict } from "../../api/client";
import clsx from "clsx";

const CONFIG: Record<Verdict, { label: string; classes: string }> = {
  exact_match:            { label: "Exact Match",          classes: "bg-neo-teal   text-white border-black" },
  minor_difference:       { label: "Minor",                classes: "bg-neo-yellow text-black border-black" },
  significant_difference: { label: "Significant",          classes: "bg-neo-orange text-white border-black" },
  missing:                { label: "Missing",              classes: "bg-neo-red    text-white border-black" },
  extra:                  { label: "Extra",                classes: "bg-neo-purple text-white border-black" },
  needs_manual_review:    { label: "Needs Manual Review",  classes: "bg-gray-200   text-black border-black" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const cfg = CONFIG[verdict] ?? CONFIG.needs_manual_review;
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        cfg.classes
      )}
    >
      {cfg.label}
    </span>
  );
}
