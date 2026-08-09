/**
 * Server-paginated, filterable, sortable results table — §13.7, §18.2.
 * Never loads the full result set client-side; every filter/sort is a server request.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
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

interface Props {
  runId: string;
}

export default function ResultsTable({ runId }: Props) {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [verdictFilter, setVerdictFilter] = useState<Verdict | "">("");
  const [sortBy, setSortBy] = useState("score");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ReviewStatus>("approved");
  const LIMIT = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["results", runId, offset, verdictFilter, sortBy, sortDir],
    queryFn: () =>
      runsApi
        .results(runId, {
          verdict: verdictFilter || undefined,
          sort_by: sortBy,
          sort_dir: sortDir,
          limit: LIMIT,
          offset,
        })
        .then((r) => r.data),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      feedbackApi.bulkStatus(
        [...selected][0],          // result_id param (ignored server-side for bulk)
        [...selected],
        bulkStatus
      ),
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
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={verdictFilter}
          onChange={(e) => { setVerdictFilter(e.target.value as Verdict | ""); setOffset(0); }}
          className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-300"
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
            setSortBy(col);
            setSortDir(dir);
            setOffset(0);
          }}
          className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-300"
        >
          <option value="score:asc">Score ↑ (worst first)</option>
          <option value="score:desc">Score ↓ (best first)</option>
          <option value="verdict:asc">Verdict A–Z</option>
        </select>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-slate-800 border border-slate-600 rounded px-4 py-2">
          <span className="text-xs text-slate-400">{selected.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as ReviewStatus)}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
          >
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded px-3 py-1"
          >
            <CheckSquare size={12} /> Apply
          </button>
        </div>
      )}

      {/* Table */}
      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
      {data && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === data.items.length && data.items.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Review Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.items.map((r: ComparisonResult) => (
                <tr key={r.id} className="hover:bg-slate-900/50 transition-colors">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs max-w-[180px] truncate">
                    {r.student_image_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {r.student_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <VerdictBadge verdict={r.verdict} />
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {r.score != null ? r.score.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {r.review_status.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/runs/${runId}/results/${r.id}`}
                      className="text-xs text-blue-400 hover:text-blue-300"
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

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
          <span>
            {offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="flex items-center gap-1 px-2 py-1 border border-slate-700 rounded disabled:opacity-30 hover:text-white"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <button
              disabled={!data.has_more}
              onClick={() => setOffset(offset + LIMIT)}
              className="flex items-center gap-1 px-2 py-1 border border-slate-700 rounded disabled:opacity-30 hover:text-white"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
