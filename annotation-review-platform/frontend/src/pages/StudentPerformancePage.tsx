/**
 * Per-student performance tracker.
 * Shows: score trend across runs, verdict breakdown, image list with results.
 */
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { studentsApi, runsApi, VerdictBreakdown, RunPerformancePoint } from "../api/client";
import { VerdictBadge } from "../components/ResultsTable/VerdictBadge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import { ArrowLeft, TrendingUp, Image as ImageIcon, Target } from "lucide-react";

const VERDICT_COLORS: Record<string, string> = {
  exact_match:            "#22c55e",
  minor_difference:       "#facc15",
  significant_difference: "#f97316",
  missing:                "#ef4444",
  extra:                  "#a855f7",
  needs_manual_review:    "#94a3b8",
};

export default function StudentPerformancePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const { data: perf, isLoading } = useQuery({
    queryKey: ["student-performance", studentId],
    queryFn: () => studentsApi.performance(studentId!).then((r) => r.data),
    enabled: !!studentId,
  });

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-slate-400 text-sm">Loading performance data…</p>
      </div>
    );
  }

  if (!perf) {
    return (
      <div className="p-8">
        <p className="text-slate-500 text-sm">Student not found.</p>
      </div>
    );
  }

  const { student, run_history, latest_verdicts, latest_avg_score, total_runs, total_images_reviewed } = perf;

  // Build chart data from run history
  const chartData = run_history.map((r, i) => ({
    name: `Run ${i + 1}`,
    score: r.avg_score ?? 0,
    exact: r.verdicts.exact_match,
    significant: r.verdicts.significant_difference,
    missing: r.verdicts.missing,
    run_id: r.run_id,
    completed_at: r.run_completed_at
      ? new Date(r.run_completed_at).toLocaleDateString()
      : `Run ${i + 1}`,
  }));

  const scoreColor =
    (latest_avg_score ?? 0) >= 80 ? "#22c55e"
    : (latest_avg_score ?? 0) >= 60 ? "#FFB300"
    : "#ef4444";

  return (
    <div className="p-8 max-w-5xl space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            {student.display_name ?? student.username ?? "Unknown Student"}
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            {student.username ?? ""} · Task ID {student.cvat_task_id}
          </p>
        </div>
        {latest_avg_score != null && (
          <div className="text-right">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-0.5">Latest Score</p>
            <p className="text-5xl font-black font-mono" style={{ color: scoreColor }}>
              {latest_avg_score.toFixed(1)}
            </p>
            <p className="text-xs text-slate-600 font-mono">/ 100</p>
          </div>
        )}
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Runs" value={total_runs} icon={<TrendingUp size={14} />} />
        <StatCard label="Images Reviewed" value={total_images_reviewed} icon={<ImageIcon size={14} />} />
        <StatCard
          label="Exact Matches"
          value={latest_verdicts.exact_match}
          icon={<Target size={14} />}
          color="text-green-400"
        />
        <StatCard
          label="Needs Rework"
          value={latest_verdicts.missing + latest_verdicts.significant_difference}
          icon={<Target size={14} />}
          color="text-red-400"
        />
      </div>

      {/* Score trend chart */}
      {chartData.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
            Score Trend Across Runs
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="completed_at" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", fontSize: 12 }}
                formatter={(v: number) => v.toFixed(1)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="score"
                name="Avg Score"
                stroke="#FFB300"
                strokeWidth={2.5}
                dot={{ fill: "#FFB300", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Latest verdict breakdown */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
          Latest Run — Verdict Breakdown
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(Object.entries(latest_verdicts) as [string, number][]).map(([v, cnt]) => (
            <div
              key={v}
              className="flex items-center justify-between border border-slate-700 rounded px-4 py-3 bg-slate-800"
            >
              <VerdictBadge verdict={v as any} />
              <span className="font-mono text-lg font-bold" style={{ color: VERDICT_COLORS[v] ?? "#fff" }}>
                {cnt}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-run history table */}
      {run_history.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Run History
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Run</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Images</th>
                <th className="px-4 py-3 text-right">Avg Score</th>
                <th className="px-4 py-3 text-right">Exact</th>
                <th className="px-4 py-3 text-right">Issues</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {run_history.map((r: RunPerformancePoint, i: number) => {
                const issues = r.verdicts.missing + r.verdicts.significant_difference +
                               r.verdicts.extra + r.verdicts.needs_manual_review;
                return (
                  <tr key={r.run_id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      Run {i + 1}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {r.run_completed_at
                        ? new Date(r.run_completed_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
                      {r.total_images}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.avg_score != null ? (
                        <span
                          className="font-mono font-bold text-sm"
                          style={{ color: r.avg_score >= 80 ? "#22c55e" : r.avg_score >= 60 ? "#FFB300" : "#ef4444" }}
                        >
                          {r.avg_score.toFixed(1)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-green-400">
                      {r.verdicts.exact_match}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-red-400">
                      {issues}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/runs/${r.run_id}/results?student_id=${studentId}`}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {run_history.length === 0 && (
        <div className="border border-slate-700 rounded-lg p-10 text-center">
          <p className="text-slate-500 text-sm">
            No comparison runs yet. Upload a CVAT ZIP and trigger a run to see performance data.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon, color = "text-slate-100",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-2">
        {icon}
        <span className="uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-3xl font-black font-mono ${color}`}>{value}</p>
    </div>
  );
}
