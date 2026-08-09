/**
 * Project dashboard — §18.1–18.5.
 * Summary cards, student trend chart, label error rates, reviewer activity.
 */
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, studentsApi, LeaderboardEntry } from "../api/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const VERDICT_COLORS: Record<string, string> = {
  exact_match:            "#22c55e",
  minor_difference:       "#facc15",
  significant_difference: "#f97316",
  missing:                "#ef4444",
  extra:                  "#a855f7",
  needs_manual_review:    "#94a3b8",
};

export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: trend } = useQuery({
    queryKey: ["student-trend", projectId],
    queryFn: () => reportsApi.studentTrend(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: labelErrors } = useQuery({
    queryKey: ["label-errors", projectId],
    queryFn: () => reportsApi.labelErrorRates(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: reviewerActivity } = useQuery({
    queryKey: ["reviewer-activity", projectId],
    queryFn: () => reportsApi.reviewerActivity(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["leaderboard", projectId],
    queryFn: () => studentsApi.leaderboard(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  // Build per-verdict aggregate from trend data for summary cards
  const verdictTotals: Record<string, number> = {};
  if (trend?.data) {
    for (const point of trend.data) {
      for (const [v, cnt] of Object.entries(point.verdict_counts ?? {})) {
        verdictTotals[v] = (verdictTotals[v] ?? 0) + (cnt as number);
      }
    }
  }

  return (
    <div className="p-8 max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>

      {/* Summary cards */}
      {Object.keys(verdictTotals).length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Overall (latest run)
          </h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(verdictTotals).map(([v, cnt]) => (
              <div
                key={v}
                className="bg-slate-900 border border-slate-700 rounded-lg px-5 py-4 min-w-[140px]"
              >
                <p className="text-xs text-slate-400">{v.replace(/_/g, " ")}</p>
                <p className="text-3xl font-bold mt-1" style={{ color: VERDICT_COLORS[v] ?? "#fff" }}>
                  {cnt}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Label error rates — §18.4 */}
      {labelErrors?.rates?.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Error Rate by Label
          </h2>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={labelErrors.rates.slice(0, 20)}
                layout="vertical"
                margin={{ left: 120, right: 20, top: 4, bottom: 4 }}
              >
                <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="label_name" width={120}
                  tick={{ fontSize: 11, fill: "#cbd5e1" }} />
                <Tooltip
                  formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                  contentStyle={{ background: "#1e293b", border: "1px solid #334155", fontSize: 12 }}
                />
                <Bar dataKey="error_rate" radius={[0, 3, 3, 0]}>
                  {labelErrors.rates.slice(0, 20).map((entry: { error_rate: number }, i: number) => (
                    <Cell
                      key={i}
                      fill={entry.error_rate > 0.3 ? "#ef4444" : entry.error_rate > 0.15 ? "#f97316" : "#3b82f6"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Reviewer activity — §18.5 */}
      {reviewerActivity?.activity?.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Reviewer Activity
          </h2>
          <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Reviewer</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {reviewerActivity.activity.map((r: { reviewer_name: string; actions_count: number; reviewer_id: string }) => (
                  <tr key={r.reviewer_id} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-200">{r.reviewer_name}</td>
                    <td className="px-4 py-3 text-right text-slate-300 font-mono">
                      {r.actions_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Student leaderboard */}
      {leaderboard?.entries != null && leaderboard.entries.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Student Leaderboard — Latest Run
          </h2>
          <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left w-8">#</th>
                  <th className="px-4 py-3 text-left">Student</th>
                  <th className="px-4 py-3 text-right">Avg Score</th>
                  <th className="px-4 py-3 text-right">Exact %</th>
                  <th className="px-4 py-3 text-right">Needs Rework</th>
                  <th className="px-4 py-3 text-right">Images</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {leaderboard!.entries.map((e: LeaderboardEntry) => (
                  <tr key={e.student.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{e.rank}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-200 font-medium text-sm">
                        {e.student.display_name ?? e.student.username ?? "—"}
                      </p>
                      <p className="text-slate-600 font-mono text-xs">{e.student.username}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {e.latest_avg_score != null ? (
                        <span
                          className="font-mono font-bold text-base"
                          style={{
                            color: e.latest_avg_score >= 80 ? "#22c55e"
                              : e.latest_avg_score >= 60 ? "#FFB300" : "#ef4444"
                          }}
                        >
                          {e.latest_avg_score.toFixed(1)}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-slate-300">
                      {e.exact_match_pct != null ? `${e.exact_match_pct}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono">
                      <span className={e.needs_rework_count > 0 ? "text-red-400" : "text-slate-600"}>
                        {e.needs_rework_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-slate-400">
                      {e.total_images}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/students/${e.student.id}`}
                        className="text-xs text-amber-400 hover:text-amber-300 font-medium"
                      >
                        Track →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
