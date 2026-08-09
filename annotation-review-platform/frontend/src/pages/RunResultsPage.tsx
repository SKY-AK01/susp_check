import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { runsApi } from "../api/client";
import ResultsTable from "../components/ResultsTable/ResultsTable";

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
        <h1 className="text-2xl font-semibold text-slate-100">Comparison Run Results</h1>
        <p className="text-xs text-slate-500 mt-1 font-mono">{runId}</p>
        {run && (
          <div className="flex items-center gap-4 mt-2">
            <span
              className={`text-xs px-2 py-0.5 rounded border ${
                run.status === "complete"
                  ? "bg-green-900/40 text-green-300 border-green-700"
                  : run.status === "failed"
                  ? "bg-red-900/40 text-red-300 border-red-700"
                  : "bg-blue-900/40 text-blue-300 border-blue-700"
              }`}
            >
              {run.status}
            </span>
            {run.status === "processing" && (
              <span className="text-xs text-slate-400">
                {run.processed_count} / {run.total_count} students ({Math.round(run.progress_pct)}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="flex flex-wrap gap-3 mb-6">
          {Object.entries(summary.by_verdict).map(([verdict, count]) => (
            <div
              key={verdict}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 min-w-[130px]"
            >
              <p className="text-xs text-slate-400">{verdict.replace(/_/g, " ")}</p>
              <p className="text-2xl font-semibold text-slate-100 mt-0.5">{count as number}</p>
            </div>
          ))}
        </div>
      )}

      {runId && <ResultsTable runId={runId} />}
    </div>
  );
}
