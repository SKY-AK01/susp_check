import { Verdict } from "../../api/client";
import clsx from "clsx";

const CONFIG: Record<Verdict, { label: string; classes: string }> = {
  exact_match:            { label: "Exact Match",          classes: "bg-green-900/50 text-green-300 border-green-700" },
  minor_difference:       { label: "Minor",                classes: "bg-yellow-900/50 text-yellow-300 border-yellow-700" },
  significant_difference: { label: "Significant",          classes: "bg-orange-900/50 text-orange-300 border-orange-700" },
  missing:                { label: "Missing",              classes: "bg-red-900/50 text-red-300 border-red-700" },
  extra:                  { label: "Extra",                classes: "bg-purple-900/50 text-purple-300 border-purple-700" },
  needs_manual_review:    { label: "Needs Manual Review",  classes: "bg-slate-700/50 text-slate-300 border-slate-500" },
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
