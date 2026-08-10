/**
 * Project detail page:
 *  1. Upload CVAT ZIP (chunked flow)
 *  2. Direct image upload
 *  3. Students list
 *  4. Runs — list past runs + trigger new run
 */
import { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  projectsApi, uploadsApi, directImagesApi, studentsApi,
  runsApi, referenceSetsApi,
  DirectUploadResult, Student, Upload, ReferenceSet, ComparisonRun,
} from "../api/client";
import {
  Upload as UploadIcon, Image as ImageIcon,
  Users, BarChart2, Play, ChevronRight, X, CheckCircle,
  RefreshCw, Clock, CheckCheck, AlertTriangle,
} from "lucide-react";

const CHUNK_SIZE = 5 * 1024 * 1024;

const TAB_COLORS: Record<string, string> = {
  upload:   "bg-neo-orange text-white",
  images:   "bg-neo-teal  text-white",
  students: "bg-neo-blue  text-white",
  runs:     "bg-neo-yellow text-black",
};
const TAB_INACTIVE = "bg-white text-gray-500 border-black hover:bg-neo-bg hover:text-black";

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<"upload" | "images" | "students" | "runs">("upload");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const tabs = [
    { key: "upload",   label: "ZIP Upload",   icon: <UploadIcon size={13} /> },
    { key: "images",   label: "Image Upload", icon: <ImageIcon size={13} /> },
    { key: "students", label: "Students",     icon: <Users size={13} /> },
    { key: "runs",     label: "Runs",         icon: <Play size={13} /> },
  ] as const;

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-black">{project?.name ?? "…"}</h1>
          <p className="text-xs font-semibold text-gray-500 mt-1 font-mono">
            {project?.project_type} · GT: {project?.gt_mode_default}
          </p>
        </div>
        <Link
          to={`/projects/${projectId}/dashboard`}
          className="flex items-center gap-2 bg-neo-blue hover:bg-blue-700 text-white font-black text-sm rounded-2xl px-5 py-2.5 border-2 border-black shadow-neo transition-transform hover:-translate-y-1"
        >
          <BarChart2 size={14} /> Dashboard
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-black border-2 rounded-2xl transition-all ${
              activeTab === t.key
                ? `${TAB_COLORS[t.key]} border-black shadow-neo-sm -translate-y-0.5`
                : TAB_INACTIVE
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === "upload"   && <ZipUploadPanel projectId={projectId!} />}
      {activeTab === "images"   && <DirectImagePanel projectId={projectId!} />}
      {activeTab === "students" && <StudentsPanel projectId={projectId!} />}
      {activeTab === "runs"     && <RunsPanel projectId={projectId!} />}
    </div>
  );
}

/* ── ZIP Upload Panel ─────────────────────────────────────────────────────── */

function ZipUploadPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Upload history
  const { data: uploadHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["uploads", projectId],
    queryFn: () => uploadsApi.list(projectId).then((r) => r.data),
  });

  const zipUploads = (uploadHistory?.items ?? []).filter((u: Upload) => !u.is_reference);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress("Initiating…");
    try {
      const init = await uploadsApi.initiate(projectId, {
        is_reference: false,
        chunk_count: Math.ceil(file.size / CHUNK_SIZE),
      });
      const uploadId = init.data.id;
      const total = Math.ceil(file.size / CHUNK_SIZE);
      for (let i = 0; i < total; i++) {
        await uploadsApi.uploadChunk(uploadId, i, file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
        setProgress(`Uploading ${i + 1}/${total} chunks…`);
      }
      setProgress("Finalising…");
      await uploadsApi.finalize(uploadId);
      setProgress("Accepted — ingestion running in background.");
      qc.invalidateQueries({ queryKey: ["uploads", projectId] });
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/progress/upload/${uploadId}`
      );
      ws.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        setProgress(`${d.status} — ${d.processed_count}/${d.total_count} images (${Math.round(d.progress_pct)}%)`);
        if (["ingested", "failed", "partially_failed"].includes(d.status)) {
          ws.close();
          qc.invalidateQueries({ queryKey: ["uploads", projectId] });
        }
      };
      ws.onerror = () => ws.close();
    } catch {
      setError("Upload failed. Check the file and try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const statusBadge = (u: Upload) => {
    const cfg: Record<string, { color: string; label: string }> = {
      ingested:         { color: "bg-neo-teal text-white",   label: "Ingested" },
      processing:       { color: "bg-neo-blue text-white",   label: "Processing" },
      pending:          { color: "bg-neo-yellow text-black", label: "Pending" },
      failed:           { color: "bg-neo-red text-white",    label: "Failed" },
      partially_failed: { color: "bg-neo-orange text-white", label: "Partial" },
    };
    const c = cfg[u.status] ?? { color: "bg-gray-200 text-black", label: u.status };
    return (
      <span className={`text-xs font-black px-2.5 py-0.5 rounded-full border-2 border-black ${c.color}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Upload widget */}
      <div className="bg-white border-2 border-black rounded-2xl shadow-neo p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neo-orange border-2 border-black flex items-center justify-center shadow-neo-sm">
            <UploadIcon size={16} className="text-white" />
          </div>
          <h2 className="text-sm font-black text-black uppercase tracking-widest">Upload CVAT Export ZIP</h2>
        </div>
        <p className="text-xs font-semibold text-gray-600">
          Export your CVAT project as a ZIP (project-level XML export) and upload it here.
          Ingestion runs in the background.
        </p>
        {error && <Alert type="error">{error}</Alert>}
        {progress && <Alert type="info">{progress}</Alert>}
        <label className="inline-flex items-center gap-2 bg-neo-orange hover:bg-orange-500 text-white font-black text-sm rounded-2xl px-5 py-2.5 border-2 border-black shadow-neo cursor-pointer transition-transform hover:-translate-y-1">
          <UploadIcon size={14} />
          {uploading ? "Uploading…" : "Select ZIP"}
          <input ref={fileRef} type="file" accept=".zip" className="hidden"
            onChange={handleUpload} disabled={uploading} />
        </label>
        <p className="text-xs font-semibold text-gray-400">Files are uploaded in 5 MB chunks automatically.</p>
      </div>

      {/* Upload history */}
      <div className="bg-white border-2 border-black rounded-2xl shadow-neo overflow-hidden">
        <div className="px-5 py-3 border-b-2 border-black bg-neo-orange flex items-center justify-between">
          <p className="text-xs font-black text-white uppercase tracking-wider">Upload History</p>
          <p className="text-xs text-orange-100 font-semibold">{zipUploads.length} upload{zipUploads.length !== 1 ? "s" : ""}</p>
        </div>
        {loadingHistory ? (
          <div className="flex items-center gap-3 p-5">
            <div className="animate-spin rounded-full h-4 w-4 border-4 border-black border-t-transparent" />
            <p className="text-xs font-semibold text-gray-500">Loading history…</p>
          </div>
        ) : zipUploads.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-bold text-gray-400">No uploads yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neo-bg border-b-2 border-black text-xs text-black uppercase font-black">
              <tr>
                <th className="px-4 py-2 text-left">Upload ID</th>
                <th className="px-4 py-2 text-left">Uploaded</th>
                <th className="px-4 py-2 text-right">Images</th>
                <th className="px-4 py-2 text-right">Progress</th>
                <th className="px-4 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zipUploads.map((u: Upload) => (
                <tr key={u.id} className="hover:bg-neo-bg transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-black font-black">{u.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-xs font-semibold text-gray-600">
                    <div>{new Date(u.created_at).toLocaleDateString()}</div>
                    <div className="text-gray-400">{new Date(u.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-black font-mono text-xs text-black">{u.total_count || "—"}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-gray-600">
                    {u.status === "processing" ? `${Math.round(u.progress_pct)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">{statusBadge(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Direct Image Upload Panel ────────────────────────────────────────────── */

function DirectImagePanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const dropRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<DirectUploadResult[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: existing } = useQuery({
    queryKey: ["project-images", projectId],
    queryFn: () => directImagesApi.list(projectId).then((r) => r.data),
  });

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setResults([]);
    setSkipped([]);
    try {
      const res = await directImagesApi.upload(projectId, files);
      setResults(res.data.uploaded);
      setSkipped(res.data.skipped);
      qc.invalidateQueries({ queryKey: ["project-images", projectId] });
    } catch {
      setError("Upload failed. Ensure files are JPG/PNG/WebP under 50 MB each.");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    uploadFiles(Array.from(e.target.files ?? []));
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border-2 border-black rounded-2xl shadow-neo p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neo-teal border-2 border-black flex items-center justify-center shadow-neo-sm">
            <ImageIcon size={16} className="text-white" />
          </div>
          <h2 className="text-sm font-black text-black uppercase tracking-widest">Upload Source Images</h2>
        </div>
        <p className="text-xs font-semibold text-gray-600">
          Drop image files here to make them available for overlay visualisation.
          Filename must match the CVAT annotation filenames. Supports JPG, PNG, WebP, BMP, TIFF. Up to 50 MB per file.
        </p>

        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
            dragging ? "border-black bg-neo-yellow shadow-neo" : "border-black hover:bg-neo-bg"
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon size={28} className="mx-auto mb-3 text-black" />
          <p className="text-sm font-black text-black">
            {uploading ? "Uploading…" : "Drag & drop images here, or click to browse"}
          </p>
          <p className="text-xs font-semibold text-gray-500 mt-1">JPG · PNG · WebP · BMP · TIFF</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileChange} />
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-black text-black uppercase tracking-wider mb-2">Upload Results</p>
            {results.map((r) => (
              <div key={r.content_hash}
                className="flex items-center justify-between bg-neo-teal/10 border-2 border-black rounded-xl px-3 py-2 text-xs shadow-neo-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-neo-teal shrink-0" />
                  <span className="text-black font-black font-mono">{r.filename}</span>
                  {r.already_existed && <span className="text-gray-500 font-semibold">(already stored)</span>}
                </div>
                <span className={`text-xs font-black px-2 py-0.5 rounded-full border-2 border-black ${
                  r.matched_image_count > 0 ? "bg-neo-teal text-white" : "bg-gray-100 text-gray-500"
                }`}>
                  {r.matched_image_count} linked
                </span>
              </div>
            ))}
            {skipped.map((s) => (
              <div key={s} className="flex items-center gap-2 bg-red-50 border-2 border-black rounded-xl px-3 py-2 text-xs shadow-neo-sm">
                <X size={12} className="text-neo-red shrink-0" />
                <span className="text-black font-black font-mono">{s}</span>
                <span className="text-neo-red font-black">skipped</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {existing && existing.length > 0 && (
        <div className="bg-white border-2 border-black rounded-2xl shadow-neo overflow-hidden">
          <div className="px-5 py-3 border-b-2 border-black bg-neo-teal flex items-center justify-between">
            <p className="text-xs font-black text-white uppercase tracking-wider">
              Image Upload History
            </p>
            <p className="text-xs text-teal-100 font-semibold">{existing.length} image{existing.length !== 1 ? "s" : ""} stored</p>
          </div>
          <div className="divide-y divide-gray-100">
            {existing.map((img, i) => (
              <div key={img.content_hash} className="flex items-center gap-4 px-4 py-3 hover:bg-neo-bg transition-colors">
                {/* Thumbnail */}
                <a href={img.url} target="_blank" rel="noreferrer" className="shrink-0">
                  <img
                    src={img.url}
                    alt={img.raw_filename}
                    className="w-12 h-12 object-cover rounded-xl border-2 border-black shadow-neo-sm"
                    loading="lazy"
                  />
                </a>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-black font-mono truncate">{img.raw_filename}</p>
                  <p className="text-xs font-semibold text-gray-400 font-mono truncate">{img.normalized_key}</p>
                </div>
                {/* Row number */}
                <span className="text-xs font-black text-gray-400 font-mono shrink-0">#{i + 1}</span>
                {/* Link */}
                <a
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-black text-neo-blue underline decoration-2 underline-offset-2 hover:text-blue-800 shrink-0"
                >
                  View
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Students Panel ───────────────────────────────────────────────────────── */

function StudentsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["students", projectId],
    queryFn: () => studentsApi.list(projectId, undefined, 100, 0).then((r) => r.data),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["leaderboard", projectId],
    queryFn: () => studentsApi.leaderboard(projectId).then((r) => r.data),
  });

  const scoreMap: Record<string, { score?: number; rank: number; exact_pct?: number }> = {};
  leaderboard?.entries.forEach((e) => {
    scoreMap[e.student.id] = { score: e.latest_avg_score, rank: e.rank, exact_pct: e.exact_match_pct };
  });

  if (isLoading) return (
    <div className="flex items-center gap-3">
      <div className="animate-spin rounded-full h-5 w-5 border-4 border-black border-t-transparent" />
      <p className="text-black font-bold text-sm">Loading students…</p>
    </div>
  );

  if (!data?.items.length) return (
    <div className="bg-white border-2 border-black rounded-2xl shadow-neo p-8 text-center">
      <p className="text-black font-black">No students yet.</p>
      <p className="text-sm font-semibold text-gray-600 mt-1">Upload a CVAT ZIP to populate them.</p>
    </div>
  );

  return (
    <div className="bg-white border-2 border-black rounded-2xl shadow-neo overflow-hidden">
      <div className="px-5 py-3 border-b-2 border-black bg-neo-blue flex items-center justify-between">
        <p className="text-xs font-black text-white uppercase tracking-wider">Students ({data.total})</p>
        <p className="text-xs font-bold text-blue-200">Scores from latest run</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neo-bg border-b-2 border-black text-xs text-black uppercase font-black">
          <tr>
            <th className="px-4 py-3 text-left w-8">#</th>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Username</th>
            <th className="px-4 py-3 text-right">Avg Score</th>
            <th className="px-4 py-3 text-right">Exact %</th>
            <th className="px-4 py-3 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {data.items.map((s: Student) => {
            const perf = scoreMap[s.id];
            return (
              <tr key={s.id} className="hover:bg-neo-bg transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs font-black font-mono">{perf?.rank ?? "—"}</td>
                <td className="px-4 py-3 text-black font-black">{s.display_name ?? "—"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs font-bold font-mono">{s.username ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {perf?.score != null ? (
                    <span className={`font-black ${perf.score >= 80 ? "text-neo-teal" : perf.score >= 60 ? "text-neo-yellow" : "text-neo-red"}`}>
                      {perf.score.toFixed(1)}
                    </span>
                  ) : <span className="text-gray-400 font-bold">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-xs font-black font-mono text-black">
                  {perf?.exact_pct != null ? `${perf.exact_pct}%` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/students/${s.id}`}
                    className="text-xs font-black text-neo-blue underline decoration-2 underline-offset-2 hover:text-blue-800">
                    Track →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Runs Panel ───────────────────────────────────────────────────────────── */

function RunsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  // ── state ──────────────────────────────────────────────────────────────────
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedUploadId, setSelectedUploadId] = useState("");
  const [triggeredRunId, setTriggeredRunId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // ── data queries ───────────────────────────────────────────────────────────
  const { data: students, isLoading: loadingStudents } = useQuery({
    queryKey: ["students", projectId],
    queryFn: () => studentsApi.list(projectId, undefined, 200, 0).then((r) => r.data),
  });

  // Try to load uploads — works after backend is deployed, graceful fallback otherwise
  const { data: uploads } = useQuery({
    queryKey: ["uploads", projectId],
    queryFn: () => uploadsApi.list(projectId).then((r) => r.data),
    retry: false,
  });

  const { data: refSets, refetch: refetchRefSets } = useQuery({
    queryKey: ["reference-sets", projectId],
    queryFn: () => referenceSetsApi.list(projectId).then((r) => r.data),
  });

  // ── derived ────────────────────────────────────────────────────────────────
  // All non-reference uploads that have been processed (any non-pending status)
  const availableUploads = (uploads?.items ?? []).filter(
    (u: Upload) => !u.is_reference && u.status !== "pending"
  );

  // If uploads API not available yet, derive unique upload IDs from students
  const studentUploadIds: string[] = students?.items
    ? [...new Set(students.items.map((s: Student) => s.id).filter(Boolean))]
    : [];

  // Selected student display name
  const selectedStudent = students?.items?.find((s: Student) => s.id === selectedStudentId);

  // ── trigger ────────────────────────────────────────────────────────────────
  async function handleTrigger() {
    setTriggerError(null);
    setTriggeredRunId(null);

    if (!selectedStudentId) {
      setTriggerError("Please select which student's data to use as Ground Truth.");
      return;
    }

    // Upload ID: from selector if available, else backend will auto-pick latest
    const uploadId = selectedUploadId || availableUploads[0]?.id || undefined;

    setIsBusy(true);
    try {
      // Auto-create reference set from selected student
      const refSetRes = await referenceSetsApi.create(projectId, {
        source_type: "student",
        reference_student_id: selectedStudentId,
      });
      await refetchRefSets();

      // Trigger run — pass upload_id only if user explicitly selected one,
      // otherwise backend auto-picks the latest ingested upload
      const uploadId = selectedUploadId || availableUploads[0]?.id || undefined;
      const runRes = await runsApi.trigger(refSetRes.data.id, uploadId);
      setTriggeredRunId(runRes.data.id);
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTriggerError(
        typeof detail === "string"
          ? detail
          : "Failed to trigger run. Please try again."
      );
    } finally {
      setIsBusy(false);
    }
  }

  const canTrigger = !!selectedStudentId && !isBusy;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="bg-white border-2 border-black rounded-2xl shadow-neo p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neo-yellow border-2 border-black flex items-center justify-center shadow-neo-sm">
            <Play size={16} className="text-black" />
          </div>
          <div>
            <h2 className="text-sm font-black text-black uppercase tracking-widest">Run Comparison</h2>
            <p className="text-xs font-semibold text-gray-500 mt-0.5">
              Pick one student as the ground truth. All other students in the same upload will be compared against them.
            </p>
          </div>
        </div>

        {triggerError && <Alert type="error">{triggerError}</Alert>}
        {triggeredRunId && (
          <Alert type="success">
            ✅ Run started!{" "}
            <Link to={`/runs/${triggeredRunId}/results`} className="underline font-black">
              View results →
            </Link>
          </Alert>
        )}

        {/* ── Step 1: Select GT student ──────────────────────────────── */}
        <div>
          <label className="block text-xs font-black text-black uppercase tracking-wider mb-2">
            Step 1 — Which student's data is the Ground Truth?
          </label>
          {loadingStudents ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-4 border-black border-t-transparent" />
              <p className="text-xs font-semibold text-gray-500">Loading students…</p>
            </div>
          ) : !students?.items?.length ? (
            <div className="border-2 border-black rounded-xl p-4 bg-neo-bg text-center">
              <p className="text-sm font-black text-black">No students yet</p>
              <p className="text-xs font-semibold text-gray-500 mt-1">
                Upload a CVAT ZIP in the ZIP Upload tab first. The system will automatically extract all students from it.
              </p>
            </div>
          ) : (
            <>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none"
              >
                <option value="">— Select the student to use as GT —</option>
                {students.items.map((s: Student) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name
                      ? `${s.display_name}${s.username ? ` (@${s.username})` : ""}`
                      : s.username ?? `Student ${s.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
              {selectedStudentId && (
                <div className="mt-2 flex items-center gap-2 bg-neo-blue/10 border-2 border-neo-blue rounded-xl px-3 py-2">
                  <span className="text-lg">👑</span>
                  <div>
                    <p className="text-xs font-black text-black">
                      {selectedStudent?.display_name ?? selectedStudent?.username ?? "Selected student"} will be the reference (GT)
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      All other students will be compared against their annotations
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Step 2: Pick upload (only shown if multiple uploads exist) ─ */}
        {availableUploads.length > 1 && (
          <div>
            <label className="block text-xs font-black text-black uppercase tracking-wider mb-2">
              Step 2 — Which upload to compare? (optional)
            </label>
            <select
              value={selectedUploadId}
              onChange={(e) => setSelectedUploadId(e.target.value)}
              className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none"
            >
              <option value="">— Latest upload (default) —</option>
              {availableUploads.map((u: Upload) => (
                <option key={u.id} value={u.id}>
                  {u.id.slice(0, 8)}… · {u.total_count} images · {new Date(u.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Trigger button ─────────────────────────────────────────── */}
        <button
          onClick={handleTrigger}
          disabled={!canTrigger}
          className="flex items-center gap-2 bg-neo-yellow hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-black text-base rounded-2xl px-8 py-3 border-2 border-black shadow-neo transition-transform hover:-translate-y-1 disabled:hover:translate-y-0"
        >
          {isBusy
            ? <><RefreshCw size={16} className="animate-spin" /> Setting up & running…</>
            : <><Play size={16} /> Run Comparison</>
          }
        </button>

        {students?.items?.length > 0 && (
          <p className="text-xs font-semibold text-gray-400">
            {students.items.length} student{students.items.length !== 1 ? "s" : ""} found in this project.
            {" "}The selected GT student will be excluded from the results — only the others will be compared.
          </p>
        )}
      </div>

      {/* ── Previous runs & dashboard link ───────────────────────────────── */}
      <div className="bg-neo-bg border-2 border-black rounded-2xl p-4 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-700">View results, charts and student leaderboard</p>
        <Link
          to={`/projects/${projectId}/dashboard`}
          className="flex items-center gap-2 bg-neo-blue text-white font-black text-sm rounded-2xl px-4 py-2 border-2 border-black shadow-neo-sm hover:-translate-y-0.5 transition-transform"
        >
          <BarChart2 size={14} /> Open Dashboard
        </Link>
      </div>
    </div>
  );
}

/* ── Alert helper ─────────────────────────────────────────────────────────── */

function Alert({ type, children }: { type: "error" | "info" | "success"; children: React.ReactNode }) {
  const styles = {
    error:   "border-black bg-red-50   text-black border-l-neo-red",
    info:    "border-black bg-blue-50  text-black border-l-neo-blue",
    success: "border-black bg-green-50 text-black border-l-neo-teal",
  };
  return (
    <div className={`border-2 border-l-4 rounded-xl px-3 py-2 text-xs font-bold ${styles[type]}`}>
      {children}
    </div>
  );
}
