/**
 * Image detail view — GT vs. student overlay, shape diffs, feedback/rework.
 * Uses real image dimensions from the overlay payload for correct scaling.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { imagesApi, feedbackApi, ReviewStatus } from "../api/client";
import OverlayCanvas from "../components/ImageDetailViewer/OverlayCanvas";
import { VerdictBadge } from "../components/ResultsTable/VerdictBadge";
import { ArrowLeft, MessageSquare, Flag } from "lucide-react";

// Display panel size — image scales to fit inside this box
const PANEL_W = 520;
const PANEL_H = 380;

/** Scale natural image dimensions to fit inside the display panel, preserving aspect ratio */
function fitToPanel(
  naturalW: number | undefined,
  naturalH: number | undefined,
  panelW: number,
  panelH: number
): { w: number; h: number } {
  const nw = naturalW || 800;
  const nh = naturalH || 600;
  const scale = Math.min(panelW / nw, panelH / nh, 1);
  return { w: Math.round(nw * scale), h: Math.round(nh * scale) };
}

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

  // Compute display sizes using real image dimensions when available
  const stuSize = overlay
    ? fitToPanel(overlay.student_image_width, overlay.student_image_height, PANEL_W, PANEL_H)
    : { w: PANEL_W, h: PANEL_H };
  const refSize = overlay
    ? fitToPanel(overlay.reference_image_width, overlay.reference_image_height, PANEL_W, PANEL_H)
    : { w: PANEL_W, h: PANEL_H };

  return (
    <div className="p-6 max-w-7xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-black font-bold hover:text-gray-600 text-sm mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to results
      </button>

      <h1 className="text-2xl font-black text-black mb-5">Image Detail View</h1>

      {isLoading && (
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-4 border-black border-t-transparent" />
          <p className="text-black font-bold text-sm">Loading overlay…</p>
        </div>
      )}

      {overlay && (
        <div className="space-y-6">
          {/* Tags */}
          {(overlay.ref_tags.length > 0 || overlay.student_tags.length > 0) && (
            <div className="flex gap-3 flex-wrap">
              {overlay.ref_tags.map((t) => (
                <span key={t} className="text-xs font-black px-3 py-1 rounded-full border-2 border-black bg-neo-blue text-white shadow-neo-sm">
                  REF: {t}
                </span>
              ))}
              {overlay.student_tags.map((t) => (
                <span key={t} className="text-xs font-black px-3 py-1 rounded-full border-2 border-black bg-neo-orange text-white shadow-neo-sm">
                  STUDENT: {t}
                </span>
              ))}
            </div>
          )}

          {/* Side-by-side overlays */}
          <div className="flex gap-6 flex-wrap">
            {/* Reference / GT */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block w-3 h-3 rounded-full bg-neo-blue border-2 border-black" />
                <p className="text-xs font-black text-black uppercase tracking-wider">Ground Truth (Reference)</p>
                {overlay.reference_image_width && (
                  <span className="text-xs font-mono text-gray-400">
                    {overlay.reference_image_width}×{overlay.reference_image_height}px
                  </span>
                )}
              </div>
              <div className="border-2 border-black rounded-2xl overflow-hidden shadow-neo">
                <OverlayCanvas
                  imageUrl={overlay.reference_image_id
                    ? `/api/images/${overlay.reference_image_id}/bytes`
                    : undefined}
                  shapes={overlay.reference_shapes}
                  source="reference"
                  shapeDiffs={overlay.shape_diffs}
                  width={refSize.w}
                  height={refSize.h}
                  naturalWidth={overlay.reference_image_width ?? 800}
                  naturalHeight={overlay.reference_image_height ?? 600}
                />
              </div>
            </div>

            {/* Student work */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block w-3 h-3 rounded-full bg-neo-orange border-2 border-black" />
                <p className="text-xs font-black text-black uppercase tracking-wider">Student Submission</p>
                {overlay.student_image_width && (
                  <span className="text-xs font-mono text-gray-400">
                    {overlay.student_image_width}×{overlay.student_image_height}px
                  </span>
                )}
              </div>
              <div className="border-2 border-black rounded-2xl overflow-hidden shadow-neo">
                <OverlayCanvas
                  imageUrl={`/api/images/${overlay.student_image_id}/bytes`}
                  shapes={overlay.student_shapes}
                  source="student"
                  shapeDiffs={overlay.shape_diffs}
                  width={stuSize.w}
                  height={stuSize.h}
                  naturalWidth={overlay.student_image_width ?? 800}
                  naturalHeight={overlay.student_image_height ?? 600}
                />
              </div>
            </div>
          </div>

          {/* Shape diff list */}
          {overlay.shape_diffs.length > 0 && (
            <div>
              <h2 className="text-sm font-black text-black mb-3 uppercase tracking-wider">
                Shape Differences ({overlay.shape_diffs.length})
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {overlay.shape_diffs.map((d) => (
                  <div key={d.id} className="bg-white border-2 border-black rounded-xl px-4 py-3 shadow-neo-sm">
                    <div className="flex items-center gap-3 mb-1">
                      <VerdictBadge verdict={d.verdict} />
                      {d.iou_score != null && (
                        <span className="text-xs font-bold text-gray-500 font-mono">
                          IoU: {d.iou_score.toFixed(3)}
                        </span>
                      )}
                    </div>
                    {d.attribute_diffs && d.attribute_diffs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {d.attribute_diffs.map((a) => (
                          <div key={a.name} className="flex items-center gap-2 text-xs font-semibold flex-wrap">
                            <span className="text-gray-500 font-mono font-black">{a.name}:</span>
                            <span className="bg-neo-blue/10 text-neo-blue font-black px-1.5 py-0.5 rounded">
                              GT: {a.ref_value ?? "—"}
                            </span>
                            <span className="text-gray-400">→</span>
                            <span className="bg-neo-orange/10 text-neo-orange font-black px-1.5 py-0.5 rounded">
                              Student: {a.student_value ?? "—"}
                            </span>
                            {a.edit_distance != null && (
                              <span className="text-gray-400 text-xs">(edit dist: {a.edit_distance})</span>
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

          {/* Feedback panel */}
          <div className="bg-white border-2 border-black rounded-2xl shadow-neo p-5 space-y-4">
            <h2 className="text-sm font-black text-black flex items-center gap-2 uppercase tracking-wider">
              <MessageSquare size={14} /> Reviewer Feedback
            </h2>

            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={reworkStatus}
                onChange={(e) => setReworkStatus(e.target.value as ReviewStatus)}
                className="bg-neo-bg border-2 border-black rounded-xl px-3 py-2 text-sm text-black font-semibold focus:outline-none"
              >
                <option value="approved">✅ Approve (false positive)</option>
                <option value="needs_rework">🔁 Needs Rework</option>
                <option value="in_review">👁 In Review</option>
                <option value="resolved">✔ Resolved</option>
              </select>
              <button
                onClick={() => statusMutation.mutate(reworkStatus)}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 bg-black hover:bg-gray-800 text-white text-sm font-black rounded-full px-4 py-2 disabled:opacity-50 transition-transform hover:-translate-y-0.5 shadow-neo-sm"
              >
                <Flag size={12} /> Set Status
              </button>
            </div>

            <div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a reviewer note for this image…"
                rows={3}
                className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:bg-white resize-none transition-colors"
              />
              <button
                onClick={() => feedbackMutation.mutate()}
                disabled={!note.trim() || feedbackMutation.isPending}
                className="mt-2 bg-neo-teal border-2 border-black text-white font-black text-sm rounded-full px-4 py-2 disabled:opacity-40 transition-transform hover:-translate-y-0.5 shadow-neo-sm"
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
