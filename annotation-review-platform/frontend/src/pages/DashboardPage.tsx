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
import { BarChart as BarChartIcon } from "lucide-react";

const VERDICT_COLORS: Record<string, string> = {
  exact_match:            "#22c55e",
  minor_difference:       "#facc15",
  significant_difference: "#f97316",
  missing:                "#ef4444",
  extra:                  "#a855f7",
  needs_manual_review:    "#94a3b8",
};

// Pastel card backgrounds cycling for the verdict summary cards
const CARD_PASTELS = ["bg-neo-mint", "bg-neo-yellow", "bg-neo-peach", "bg-neo-lavender", "bg-neo-pink", "bg-white"];

export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: trend, isLoading: isLoadingTrend } = useQuery({
    queryKey: ["student-trend", projectId],
    queryFn: () => reportsApi.studentTrend(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: labelErrors, isLoading: isLoadingLabels } = useQuery({
    queryKey: ["label-errors", projectId],
    queryFn: () => reportsApi.labelErrorRates(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: reviewerActivity, isLoading: isLoadingActivity } = useQuery({
    queryKey: ["reviewer-activity", projectId],
    queryFn: () => reportsApi.reviewerActivity(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useQuery({
    queryKey: ["leaderboard", projectId],
    queryFn: () => studentsApi.leaderboard(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const isLoading = isLoadingTrend || isLoadingLabels || isLoadingActivity || isLoadingLeaderboard;

  // Build per-verdict aggregate from trend data for summary cards
  const verdictTotals: Record<string, number> = {};
  if (trend?.data) {
    for (const point of trend.data) {
      for (const [v, cnt] of Object.entries(point.verdict_counts ?? {})) {
        verdictTotals[v] = (verdictTotals[v] ?? 0) + (cnt as number);
      }
    }
  }

  const isEmpty = !isLoading && Object.keys(verdictTotals).length === 0;

  return (
    <div className="p-8 max-w-6xl space-y-8">
      <h1 className="text-3xl font-black text-black tracking-tight">Dashboard</h1>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-black border-t-transparent mb-4"></div>
          <p className="font-bold">Loading dashboard data...</p>
        </div>
      )}

      {isEmpty && (
        <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-12 text-center max-w-2xl mx-auto mt-12">
          <div className="w-16 h-16 bg-neo-yellow border-4 border-black rounded-full flex items-center justify-center mx-auto mb-4 shadow-neo-sm">
            <BarChartIcon className="w-8 h-8 text-black" />
          </div>
          <h2 className="text-2xl font-black text-black mb-2">No comparison runs yet</h2>
          <p className="text-gray-700 font-semibold text-sm mb-8 max-w-md mx-auto">
            The dashboard is empty because there are no completed comparison runs for this project.
            Upload a CVAT ZIP and trigger a comparison run to view metrics and student performance.
          </p>
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 bg-black hover:bg-gray-800 text-white font-black text-sm rounded-full px-6 py-3 transition-transform hover:-translate-y-1 shadow-neo"
          >
            Go to Project Details
          </Link>
        </div>
      )}

      {!isLoading && !isEmpty && (
        <>
          {/* Summary cards */}
          {Object.keys(verdictTotals).length > 0 && (
            <section>
              <h2 className="text-xs font-black text-black uppercase tracking-widest mb-4">
                Overall (latest run)
              </h2>
              <div className="flex flex-wrap gap-4">
                {Object.entries(verdictTotals).map(([v, cnt], i) => (
                  <div
                    key={v}
                    className={`${CARD_PASTELS[i % CARD_PASTELS.length]} border-4 border-black rounded-2xl shadow-neo px-6 py-5 min-w-[150px] hover:-translate-y-1 transition-transform`}
                  >
                    <p className="text-xs font-black text-black uppercase tracking-wide">{v.replace(/_/g, " ")}</p>
                    <p className="text-4xl font-black mt-2 text-black">{cnt}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Label error rates */}
          {labelErrors?.rates?.length > 0 && (
            <section>
              <h2 className="text-xs font-black text-black uppercase tracking-widest mb-4">
                Error Rate by Label
              </h2>
              <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-5">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={labelErrors.rates.slice(0, 20)}
                    layout="vertical"
                    margin={{ left: 120, right: 20, top: 4, bottom: 4 }}
                  >
                    <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fontSize: 11, fill: "#111" }} />
                    <YAxis type="category" dataKey="label_name" width={120}
                      tick={{ fontSize: 11, fill: "#111" }} />
                    <Tooltip
                      formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                      contentStyle={{ background: "#fff", border: "2px solid #000", fontSize: 12, fontWeight: 700 }}
                    />
                    <Bar dataKey="error_rate" radius={[0, 4, 4, 0]}>
                      {labelErrors.rates.slice(0, 20).map((entry: { error_rate: number }, i: number) => (
                        <Cell
                          key={i}
                          fill={entry.error_rate > 0.3 ? "#ef4444" : entry.error_rate > 0.15 ? "#f97316" : "#22c55e"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Reviewer activity */}
          {reviewerActivity?.activity?.length > 0 && (
            <section>
              <h2 className="text-xs font-black text-black uppercase tracking-widest mb-4">
                Reviewer Activity
              </h2>
              <div className="bg-white border-4 border-black rounded-2xl shadow-neo overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neo-peach border-b-4 border-black text-xs text-black uppercase font-black">
                    <tr>
                      <th className="px-4 py-3 text-left">Reviewer</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-black">
                    {reviewerActivity.activity.map((r: { reviewer_name: string; actions_count: number; reviewer_id: string }) => (
                      <tr key={r.reviewer_id} className="hover:bg-neo-bg transition-colors">
                        <td className="px-4 py-3 text-black font-semibold">{r.reviewer_name}</td>
                        <td className="px-4 py-3 text-right text-black font-black font-mono">
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
              <h2 className="text-xs font-black text-black uppercase tracking-widest mb-4">
                Student Leaderboard — Latest Run
              </h2>
              <div className="bg-white border-4 border-black rounded-2xl shadow-neo overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neo-mint border-b-4 border-black text-xs text-black uppercase font-black">
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
                  <tbody className="divide-y-2 divide-black">
                    {leaderboard!.entries.map((e: LeaderboardEntry) => (
                      <tr key={e.student.id} className="hover:bg-neo-bg transition-colors">
                        <td className="px-4 py-3 text-gray-500 font-black font-mono text-xs">{e.rank}</td>
                        <td className="px-4 py-3">
                          <p className="text-black font-black text-sm">
                            {e.student.display_name ?? e.student.username ?? "—"}
                          </p>
                          <p className="text-gray-500 font-mono text-xs">{e.student.username}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {e.latest_avg_score != null ? (
                            <span
                              className="font-mono font-black text-base"
                              style={{
                                color: e.latest_avg_score >= 80 ? "#16a34a"
                                  : e.latest_avg_score >= 60 ? "#d97706" : "#dc2626"
                              }}
                            >
                              {e.latest_avg_score.toFixed(1)}
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black font-mono text-black">
                          {e.exact_match_pct != null ? `${e.exact_match_pct}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black font-mono">
                          <span className={e.needs_rework_count > 0 ? "text-red-600" : "text-gray-400"}>
                            {e.needs_rework_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-mono text-black font-bold">
                          {e.total_images}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/students/${e.student.id}`}
                            className="text-xs font-black text-black underline decoration-2 underline-offset-2 hover:text-gray-600"
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
        </>
      )}
    </div>
  );
}
