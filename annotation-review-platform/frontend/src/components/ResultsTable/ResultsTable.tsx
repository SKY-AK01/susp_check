/**
 * Server-paginated, filterable, sortable results table — §13.7, §18.2.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { runsApi, feedbackApi, ComparisonResult, Verdict, ReviewStatus } from "../../api/client";
import { VerdictBadge } from "./VerdictBadge";
import { ChevronLeft, ChevronRight, CheckSquare } from "lucide-react";

const VERDICTS: Verdict[] = [
  "exact_match", "minor_difference", "significant_difference",
  "missing", "extra", "needs_manual_review",
];
const REVIEW_STATUSES: ReviewStatus[] = [
  "open", "in_review", "needs_rework", "approved", "resolved",
];

const SCORE_BG: Record<string, string> = {
  exact_match:            "bg-neo-teal/10",
  minor_difference:       "bg-neo-yellow/20",
  significant_difference: "bg-neo-orange/10",
  missing:                "bg-neo-red/10",
  extra:                  "bg-neo-purple/10",
  needs_manual_review:    "bg-gray-100",
};

interface Props {
  runId: string;
  // Optional: pre-filter to one student (passed in from StudentPerformancePage)
  fixedStudentId?: string;
}

export default function ResultsTable({ runId, fixedStudentId }: Props) {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Honour ?student_id= from URL (e.g. deep-link from StudentPerformancePage)
  const urlStudentId = searchParams.get("student_id") ?? undefined;
  const effectiveStudentId = fixedStudentId ?? urlStudentId;

  const [offset, setOffset] = useState(0);
  const [verdictFilter, setVerdictFilter] = useState<Verdict | "">("");
  const [sortBy, setSortBy] = useState("score");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ReviewStatus>("approved");
  const LIMIT = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["results", runId, offset, verdictFilter, sortBy, sortDir, effectiveStudentId],
    queryFn: () =>
      runsApi.results(runId, {
        student_id: effectiveStudentId,
        verdict: verdictFilter || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: LIMIT,
        offset,
      }).then((r) => r.data),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      feedbackApi.bulkStatus([...selected][0], [...selected], bulkStatus),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["results", runId] });
    },
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!data) return;
    const allIds = new Set(data.items.map((r: ComparisonResult) => r.id));
    if (selected.size === allIds.size) setSelected(new Set());
    else setSelected(allIds);
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        {effectiveStudentId && (
          <span className="text-xs font-black bg-neo-blue text-white px-3 py-1.5 rounded-full border-2 border-black">
            Filtered: 1 student
          </span>
        )}
        <select
          value={verdictFilter}
          onChange={(e) => { setVerdictFilter(e.target.value as Verdict | ""); setOffset(0); }}
          className="bg-neo-bg border-2 border-black rounded-xl px-3 py-2 text-sm text-black font-bold focus:outline-none"
        >
          <option value="">All verdicts</option>
          {VERDICTS.map((v) => (
            <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
          ))}
        </select>

        <select
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [col, dir] = e.target.value.split(":");
            setSortBy(col); setSortDir(dir); setOffset(0);
          }}
          className="bg-neo-bg border-2 border-black rounded-xl px-3 py-2 text-sm text-black font-bold focus:outline-none"
        >
          <option value="score:asc">Score ↑ (worst first)</option>
          <option value="score:desc">Score ↓ (best first)</option>
          <option value="verdict:asc">Verdict A–Z</option>
        </select>

        {data && (
          <span className="text-xs font-semibold text-gray-500 ml-auto">{data.total} results</span>
        )}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-neo-yellow border-2 border-black rounded-xl px-4 py-2 shadow-neo-sm">
          <span className="text-xs font-black text-black">{selected.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as ReviewStatus)}
            className="bg-white border-2 border-black rounded-lg px-2 py-1 text-xs text-black font-bold focus:outline-none"
          >
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
            className="flex items-center gap-1 bg-black hover:bg-gray-800 text-white text-xs font-black rounded-full px-3 py-1.5 transition-transform hover:-translate-y-0.5"
          >
            <CheckSquare size={12} /> Apply
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-3 py-8">
          <div className="animate-spin rounded-full h-5 w-5 border-4 border-black border-t-transparent" />
          <p className="text-black font-bold text-sm">Loading…</p>
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="overflow-x-auto rounded-2xl border-2 border-black shadow-neo">
          <table className="w-full text-sm text-left">
            <thead className="bg-neo-orange border-b-2 border-black text-xs text-white uppercase font-black">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === data.items.length && data.items.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-2 border-black"
                  />
                </th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((r: ComparisonResult) => (
                <tr key={r.id} className={`hover:bg-neo-bg transition-colors ${SCORE_BG[r.verdict] ?? ""}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="rounded border-2 border-black"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-black font-black text-xs">
                      {r.student_display_name ?? r.student_id.slice(0, 8)}
                    </p>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-black font-semibold text-xs font-mono truncate">
                      {r.image_filename ?? r.student_image_id.slice(0, 8) + "…"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <VerdictBadge verdict={r.verdict} />
                  </td>
                  <td className="px-4 py-3">
                    {r.score != null ? (
                      <span
                        className="font-black font-mono text-sm"
                        style={{
                          color: r.score >= 80 ? "#16a34a" : r.score >= 60 ? "#d97706" : "#dc2626"
                        }}
                      >
                        {r.score.toFixed(1)}
                      </span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-gray-600">
                    {r.review_status.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/runs/${runId}/results/${r.id}`}
                      className="text-xs font-black text-neo-blue underline decoration-2 underline-offset-2 hover:text-blue-800"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.items.length === 0 && !isLoading && (
        <div className="py-12 text-center border-2 border-black rounded-2xl bg-white">
          <p className="text-black font-black">No results match the current filters.</p>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-between mt-5 text-xs text-black font-bold">
          <span>{offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="flex items-center gap-1 px-3 py-1.5 border-2 border-black rounded-full font-black disabled:opacity-30 hover:bg-black hover:text-white transition-colors"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <button
              disabled={!data.has_more}
              onClick={() => setOffset(offset + LIMIT)}
              className="flex items-center gap-1 px-3 py-1.5 border-2 border-black rounded-full font-black disabled:opacity-30 hover:bg-black hover:text-white transition-colors"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
