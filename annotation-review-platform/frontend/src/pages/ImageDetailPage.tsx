/**
 * Image detail view — GT vs. student overlay, shape diffs, feedback/rework — §6.8, §19.
 * Loads all data from a single /overlay API call (§11.6).
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { imagesApi, feedbackApi, ReviewStatus } from "../api/client";
import OverlayCanvas from "../components/ImageDetailViewer/OverlayCanvas";
import { VerdictBadge } from "../components/ResultsTable/VerdictBadge";
import { ArrowLeft, MessageSquare, Flag } from "lucide-react";

const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 360;

export default function ImageDetailPage() {
  const { runId, resultId } = useParams<{ runId: string; resultId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [reworkStatus, setReworkStatus] = useState<ReviewStatus>("needs_rework");

  const { data: overlay, isLoading } = useQuery({
    queryKey: ["overlay", resultId],
    queryFn: () => imagesApi.overlay(resultId!).then((r) => r.data),
    enabled: !!resultId,
  });

  const feedbackMutation = useMutation({
    mutationFn: () => feedbackApi.add(resultId!, note),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["overlay", resultId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: ReviewStatus) => feedbackApi.updateStatus(resultId!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["results", runId] });
      qc.invalidateQueries({ queryKey: ["overlay", resultId] });
    },
  });

  return (
    <div className="p-6 max-w-7xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to results
      </button>

      <h1 className="text-xl font-semibold text-slate-100 mb-5">Image Detail View</h1>

      {isLoading && <p className="text-slate-400 text-sm">Loading overlay…</p>}

      {overlay && (
        <div className="space-y-6">
          {/* Tags */}
          {(overlay.ref_tags.length > 0 || overlay.student_tags.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {overlay.ref_tags.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded border border-blue-600 text-blue-300">
                  REF: {t}
                </span>
              ))}
              {overlay.student_tags.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded border border-orange-600 text-orange-300">
                  STUDENT: {t}
                </span>
              ))}
            </div>
          )}

          {/* Side-by-side overlays */}
          <div className="flex gap-4 flex-wrap">
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-500" />
                Reference
              </p>
              <OverlayCanvas
                imageUrl={overlay.reference_image_url
                  ? `/api/images/${overlay.reference_image_id}/bytes`
                  : undefined}
                shapes={overlay.reference_shapes}
                source="reference"
                shapeDiffs={overlay.shape_diffs}
                width={PANEL_WIDTH}
                height={PANEL_HEIGHT}
                naturalWidth={800}
                naturalHeight={600}
              />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full bg-orange-500" />
                Student
              </p>
              <OverlayCanvas
                imageUrl={overlay.student_image_url
                  ? `/api/images/${overlay.student_image_id}/bytes`
                  : undefined}
                shapes={overlay.student_shapes}
                source="student"
                shapeDiffs={overlay.shape_diffs}
                width={PANEL_WIDTH}
                height={PANEL_HEIGHT}
                naturalWidth={800}
                naturalHeight={600}
              />
            </div>
          </div>

          {/* Shape diff list */}
          {overlay.shape_diffs.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-slate-300 mb-2">Shape Differences</h2>
              <div className="space-y-2">
                {overlay.shape_diffs.map((d) => (
                  <div
                    key={d.id}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <VerdictBadge verdict={d.verdict} />
                      {d.iou_score != null && (
                        <span className="text-xs text-slate-400">IoU: {d.iou_score.toFixed(3)}</span>
                      )}
                    </div>
                    {d.attribute_diffs && d.attribute_diffs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {d.attribute_diffs.map((a) => (
                          <div key={a.name} className="flex items-center gap-2 text-xs">
                            <span className="text-slate-400 font-mono">{a.name}:</span>
                            <span className="text-blue-300">{a.ref_value ?? "—"}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-orange-300">{a.student_value ?? "—"}</span>
                            {a.edit_distance != null && (
                              <span className="text-slate-500">(edit dist: {a.edit_distance})</span>
                            )}
                            <VerdictBadge verdict={a.verdict} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feedback panel — §19 */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <MessageSquare size={14} /> Reviewer Feedback
            </h2>

            {/* Status update */}
            <div className="flex items-center gap-3">
              <select
                value={reworkStatus}
                onChange={(e) => setReworkStatus(e.target.value as ReviewStatus)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-300"
              >
                <option value="approved">Approve (false positive)</option>
                <option value="needs_rework">Needs Rework</option>
                <option value="in_review">In Review</option>
                <option value="resolved">Resolved</option>
              </select>
              <button
                onClick={() => statusMutation.mutate(reworkStatus)}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded px-3 py-1.5 disabled:opacity-50"
              >
                <Flag size={12} /> Set Status
              </button>
            </div>

            {/* Note */}
            <div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note for this image…"
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={() => feedbackMutation.mutate()}
                disabled={!note.trim() || feedbackMutation.isPending}
                className="mt-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded px-3 py-1.5 disabled:opacity-40 transition-colors"
              >
                {feedbackMutation.isPending ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
