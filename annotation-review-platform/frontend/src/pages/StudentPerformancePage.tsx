/**
 * Per-student performance tracker.
 * Shows: score trend across runs, verdict breakdown, image list with results.
 */
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { studentsApi, RunPerformancePoint } from "../api/client";
import { VerdictBadge } from "../components/ResultsTable/VerdictBadge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import { ArrowLeft, TrendingUp, Image as ImageIcon, Target } from "lucide-react";

const VERDICT_COLORS: Record<string, string> = {
  exact_match:            "#16a34a",
  minor_difference:       "#d97706",
  significant_difference: "#ea580c",
  missing:                "#dc2626",
  extra:                  "#7c3aed",
  needs_manual_review:    "#6b7280",
};

const STAT_PASTELS = ["bg-neo-orange", "bg-neo-teal", "bg-neo-blue", "bg-neo-yellow"];

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
      <div className="p-8 flex items-center gap-3">
        <div className="animate-spin rounded-full h-6 w-6 border-4 border-black border-t-transparent" />
        <p className="text-black font-bold">Loading performance data…</p>
      </div>
    );
  }

  if (!perf) {
    return (
      <div className="p-8">
        <p className="text-gray-500 font-semibold">Student not found.</p>
      </div>
    );
  }

  const { student, run_history, latest_verdicts, latest_avg_score, total_runs, total_images_reviewed } = perf;

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
    (latest_avg_score ?? 0) >= 80 ? "#16a34a"
    : (latest_avg_score ?? 0) >= 60 ? "#d97706"
    : "#dc2626";

  return (
    <div className="p-8 max-w-5xl space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-black font-bold hover:text-gray-600 text-sm transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-black">
            {student.display_name ?? student.username ?? "Unknown Student"}
          </h1>
          <p className="text-xs font-semibold text-gray-500 mt-1 font-mono">
            {student.username ?? ""} · Task ID {student.cvat_task_id}
          </p>
        </div>
        {latest_avg_score != null && (
          <div className="bg-white border-4 border-black rounded-2xl shadow-neo px-6 py-4 text-right shrink-0">
            <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-1">Latest Score</p>
            <p className="text-5xl font-black font-mono" style={{ color: scoreColor }}>
              {latest_avg_score.toFixed(1)}
            </p>
            <p className="text-xs text-gray-400 font-mono">/ 100</p>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Runs" value={total_runs} icon={<TrendingUp size={14} />} bg={STAT_PASTELS[0]} valueColor="white" />
        <StatCard label="Images Reviewed" value={total_images_reviewed} icon={<ImageIcon size={14} />} bg={STAT_PASTELS[1]} valueColor="white" />
        <StatCard
          label="Exact Matches"
          value={latest_verdicts.exact_match}
          icon={<Target size={14} />}
          bg={STAT_PASTELS[2]}
          valueColor="white"
        />
        <StatCard
          label="Needs Rework"
          value={latest_verdicts.missing + latest_verdicts.significant_difference}
          icon={<Target size={14} />}
          bg={STAT_PASTELS[3]}
          valueColor="black"
        />
      </div>

      {/* Score trend chart */}
      {chartData.length > 0 && (
        <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-5">
          <p className="text-xs font-black text-black uppercase tracking-widest mb-4">
            Score Trend Across Runs
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
              <XAxis dataKey="completed_at" tick={{ fontSize: 10, fill: "#374151", fontWeight: 700 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#374151", fontWeight: 700 }} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "2px solid #000", fontSize: 12, fontWeight: 700 }}
                formatter={(v: number) => v.toFixed(1)}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
              <Line
                type="monotone"
                dataKey="score"
                name="Avg Score"
                stroke="#000"
                strokeWidth={3}
                dot={{ fill: "#000", r: 5 }}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Latest verdict breakdown */}
      <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-5">
        <p className="text-xs font-black text-black uppercase tracking-widest mb-4">
          Latest Run — Verdict Breakdown
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(Object.entries(latest_verdicts) as [string, number][]).map(([v, cnt]) => (
            <div
              key={v}
              className="flex items-center justify-between border-2 border-black rounded-xl px-4 py-3 bg-neo-bg hover:-translate-y-0.5 transition-transform"
            >
              <VerdictBadge verdict={v as any} />
              <span className="font-mono text-lg font-black" style={{ color: VERDICT_COLORS[v] ?? "#111" }}>
                {cnt}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-run history table */}
      {run_history.length > 0 && (
        <div className="bg-white border-4 border-black rounded-2xl shadow-neo overflow-hidden">
          <div className="px-5 py-3 border-b-4 border-black bg-neo-orange">
            <p className="text-xs font-black text-white uppercase tracking-wider">
              Run History
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neo-bg border-b-2 border-black text-xs text-black uppercase font-black">
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
            <tbody className="divide-y-2 divide-black">
              {run_history.map((r: RunPerformancePoint, i: number) => {
                const issues = r.verdicts.missing + r.verdicts.significant_difference +
                               r.verdicts.extra + r.verdicts.needs_manual_review;
                return (
                  <tr key={r.run_id} className="hover:bg-neo-bg transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-black font-mono text-xs">Run {i + 1}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs font-semibold">
                      {r.run_completed_at
                        ? new Date(r.run_completed_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-black font-mono text-xs text-black">
                      {r.total_images}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.avg_score != null ? (
                        <span
                          className="font-mono font-black text-sm"
                          style={{ color: r.avg_score >= 80 ? "#16a34a" : r.avg_score >= 60 ? "#d97706" : "#dc2626" }}
                        >
                          {r.avg_score.toFixed(1)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-black font-mono text-green-600">
                      {r.verdicts.exact_match}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-black font-mono text-red-600">
                      {issues}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/runs/${r.run_id}/results?student_id=${studentId}`}
                        className="text-xs font-black text-black underline decoration-2 underline-offset-2 hover:text-gray-600"
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
        <div className="border-4 border-black rounded-2xl p-10 text-center bg-white shadow-neo">
          <p className="text-black font-bold text-sm">
            No comparison runs yet. Upload a CVAT ZIP and trigger a run to see performance data.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon, bg = "bg-white", valueColor = "black",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg?: string;
  valueColor?: string;
}) {
  const isLight = valueColor === "black";
  return (
    <div className={`${bg} border-2 border-black rounded-2xl px-4 py-4 shadow-neo`}>
      <div className={`flex items-center gap-2 text-xs font-black mb-2 uppercase tracking-wider ${isLight ? "text-black" : "text-white/80"}`}>
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-3xl font-black font-mono ${isLight ? "text-black" : "text-white"}`}>{value}</p>
    </div>
  );
}
