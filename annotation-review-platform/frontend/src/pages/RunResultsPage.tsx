import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { runsApi } from "../api/client";
import ResultsTable from "../components/ResultsTable/ResultsTable";

const VERDICT_PASTELS: Record<string, string> = {
  exact_match: "bg-neo-teal",
  minor_difference: "bg-neo-yellow",
  significant_difference: "bg-neo-orange",
  missing: "bg-neo-red",
  extra: "bg-neo-purple",
  needs_manual_review: "bg-gray-200",
};

export default function RunResultsPage() {
  const { runId } = useParams<{ runId: string }>();

  const { data: run } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => runsApi.get(runId!).then((r) => r.data),
    refetchInterval: (data) =>
      data && !["complete", "failed", "partially_failed"].includes((data as any).status)
        ? 3000
        : false,
    enabled: !!runId,
  });

  const { data: summary } = useQuery({
    queryKey: ["run-summary", runId],
    queryFn: () => runsApi.summary(runId!).then((r) => r.data),
    enabled: !!runId && run?.status === "complete",
  });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-black">Comparison Run Results</h1>
        <p className="text-xs text-gray-500 mt-1 font-mono font-semibold">{runId}</p>
        {run && (
          <div className="flex items-center gap-3 mt-3">
            <span
              className={`text-xs font-black px-3 py-1 rounded-full border-2 border-black shadow-neo-sm ${
                run.status === "complete"
                  ? "bg-neo-mint text-black"
                  : run.status === "failed"
                  ? "bg-red-200 text-black"
                  : "bg-neo-lavender text-black"
              }`}
            >
              {run.status}
            </span>
            {run.status === "processing" && (
              <span className="text-xs font-semibold text-gray-600">
                {run.processed_count} / {run.total_count} students ({Math.round(run.progress_pct)}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="flex flex-wrap gap-4 mb-8">
          {Object.entries(summary.by_verdict).map(([verdict, count]) => (
            <div
              key={verdict}
              className={`${VERDICT_PASTELS[verdict] ?? "bg-white"} border-2 border-black rounded-2xl px-5 py-4 min-w-[140px] shadow-neo hover:-translate-y-1 transition-transform`}
            >
              <p className={`text-xs font-black uppercase tracking-wide ${verdict === "minor_difference" || verdict === "needs_manual_review" ? "text-black" : "text-white"}`}>{verdict.replace(/_/g, " ")}</p>
              <p className={`text-3xl font-black text-black mt-1 ${verdict === "minor_difference" || verdict === "needs_manual_review" ? "text-black" : "text-white"}`}>{count as number}</p>
            </div>
          ))}
        </div>
      )}

      {runId && <ResultsTable runId={runId} />}
    </div>
  );
}
