/**
 * Project detail page — three panels:
 *  1. Upload CVAT ZIP (existing chunked flow)
 *  2. Direct image upload (new — supervisor uploads raw .jpg/.png files)
 *  3. Students list with quick-link to performance tracker
 *  4. Runs list with trigger
 */
import { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  projectsApi, uploadsApi, directImagesApi, studentsApi,
  runsApi, DirectUploadResult, Student, Upload,
} from "../api/client";
import {
  Upload as UploadIcon, Image as ImageIcon,
  Users, BarChart2, Play, ChevronRight, X, CheckCircle,
} from "lucide-react";

const CHUNK_SIZE = 5 * 1024 * 1024;

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"upload" | "images" | "students" | "runs">("upload");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{project?.name ?? "…"}</h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            {project?.project_type} · GT: {project?.gt_mode_default}
          </p>
        </div>
        <Link
          to={`/projects/${projectId}/dashboard`}
          className="flex items-center gap-2 border border-slate-600 text-slate-300 hover:text-white text-sm rounded px-4 py-2 transition-colors"
        >
          <BarChart2 size={14} /> Dashboard
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-700 mb-6">
        {(
          [
            { key: "upload", label: "ZIP Upload", icon: <UploadIcon size={13} /> },
            { key: "images", label: "Image Upload", icon: <ImageIcon size={13} /> },
            { key: "students", label: "Students", icon: <Users size={13} /> },
            { key: "runs", label: "Runs", icon: <Play size={13} /> },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === "upload" && <ZipUploadPanel projectId={projectId!} />}
      {activeTab === "images" && <DirectImagePanel projectId={projectId!} />}
      {activeTab === "students" && <StudentsPanel projectId={projectId!} />}
      {activeTab === "runs" && <RunsPanel projectId={projectId!} />}
    </div>
  );
}

/* ── ZIP Upload Panel ─────────────────────────────────────────────────────── */

function ZipUploadPanel({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/progress/upload/${uploadId}`
      );
      ws.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        setProgress(`${d.status} — ${d.processed_count}/${d.total_count} images (${Math.round(d.progress_pct)}%)`);
        if (["ingested", "failed", "partially_failed"].includes(d.status)) ws.close();
      };
      ws.onerror = () => ws.close();
    } catch {
      setError("Upload failed. Check the file and try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
        Upload CVAT Export ZIP
      </h2>
      <p className="text-xs text-slate-500">
        Export your CVAT project as a ZIP (project-level XML export) and upload it here.
        Ingestion runs in the background — you'll see progress below.
      </p>
      {error && <Alert type="error">{error}</Alert>}
      {progress && <Alert type="info">{progress}</Alert>}
      <label className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold text-sm rounded px-5 py-2 cursor-pointer transition-colors shadow-[2px_2px_0px_#1a1a1a]">
        <UploadIcon size={14} />
        {uploading ? "Uploading…" : "Select ZIP"}
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={handleUpload} disabled={uploading} />
      </label>
      <p className="text-xs text-slate-600">Files are uploaded in 5 MB chunks automatically.</p>
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
    const files = Array.from(e.dataTransfer.files);
    uploadFiles(files);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    uploadFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
          Upload Source Images Directly
        </h2>
        <p className="text-xs text-slate-500">
          Drop image files here to make them available for overlay visualisation.
          Files are matched to annotations by filename — use the same names as in CVAT.
          Supports JPG, PNG, WebP, BMP, TIFF. Up to 50 MB per file.
        </p>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${
            dragging
              ? "border-amber-400 bg-amber-400/10"
              : "border-slate-600 hover:border-slate-400"
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon size={28} className="mx-auto mb-3 text-slate-500" />
          <p className="text-sm text-slate-400">
            {uploading ? "Uploading…" : "Drag & drop images here, or click to browse"}
          </p>
          <p className="text-xs text-slate-600 mt-1">JPG · PNG · WebP · BMP · TIFF</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {/* Upload results */}
        {results.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Upload Results
            </p>
            {results.map((r) => (
              <div key={r.content_hash}
                className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-green-400 shrink-0" />
                  <span className="text-slate-200 font-mono">{r.filename}</span>
                  {r.already_existed && (
                    <span className="text-slate-500">(already stored)</span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  r.matched_image_count > 0
                    ? "border-green-700 text-green-400 bg-green-900/20"
                    : "border-slate-600 text-slate-500"
                }`}>
                  {r.matched_image_count} annotation{r.matched_image_count !== 1 ? "s" : ""} linked
                </span>
              </div>
            ))}
            {skipped.map((s) => (
              <div key={s}
                className="flex items-center gap-2 bg-slate-800 border border-red-900 rounded px-3 py-2 text-xs">
                <X size={12} className="text-red-400 shrink-0" />
                <span className="text-slate-400 font-mono">{s}</span>
                <span className="text-red-400">skipped</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Already-uploaded images */}
      {existing && existing.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Stored Images ({existing.length})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto">
            {existing.map((img) => (
              <a
                key={img.content_hash}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="group block border border-slate-700 rounded overflow-hidden hover:border-amber-400 transition-colors"
              >
                <img
                  src={img.url}
                  alt={img.raw_filename}
                  className="w-full h-20 object-cover bg-slate-800"
                  loading="lazy"
                />
                <p className="text-xs text-slate-500 font-mono px-2 py-1 truncate group-hover:text-slate-200">
                  {img.normalized_key}
                </p>
              </a>
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

  // Build score map from leaderboard
  const scoreMap: Record<string, { score?: number; rank: number; exact_pct?: number }> = {};
  leaderboard?.entries.forEach((e) => {
    scoreMap[e.student.id] = {
      score: e.latest_avg_score,
      rank: e.rank,
      exact_pct: e.exact_match_pct,
    };
  });

  if (isLoading) return <p className="text-slate-400 text-sm">Loading students…</p>;
  if (!data?.items.length) return <p className="text-slate-500 text-sm">No students yet. Upload a CVAT ZIP to populate them.</p>;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Students ({data.total})
        </p>
        <p className="text-xs text-slate-600">Scores from latest run</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
          <tr>
            <th className="px-4 py-3 text-left w-8">#</th>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Username</th>
            <th className="px-4 py-3 text-right">Avg Score</th>
            <th className="px-4 py-3 text-right">Exact %</th>
            <th className="px-4 py-3 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data.items.map((s: Student) => {
            const perf = scoreMap[s.id];
            return (
              <tr key={s.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 text-slate-600 text-xs font-mono">{perf?.rank ?? "—"}</td>
                <td className="px-4 py-3 text-slate-200 font-medium">
                  {s.display_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                  {s.username ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {perf?.score != null ? (
                    <span className={`font-bold ${
                      perf.score >= 80 ? "text-green-400"
                      : perf.score >= 60 ? "text-amber-400"
                      : "text-red-400"
                    }`}>
                      {perf.score.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs font-mono text-slate-400">
                  {perf?.exact_pct != null ? `${perf.exact_pct}%` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/students/${s.id}`}
                    className="text-xs text-amber-400 hover:text-amber-300 font-medium"
                  >
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
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-3">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
        Comparison Runs
      </h2>
      <p className="text-xs text-slate-500">
        Runs are created from the Reference Sets page. After uploading a CVAT ZIP and selecting
        a reference (GT upload or promoted student), trigger a run from the API or dashboard.
      </p>
      <Link
        to={`/projects/${projectId}/dashboard`}
        className="inline-flex items-center gap-2 border border-amber-400 text-amber-400 hover:bg-amber-400 hover:text-slate-900 text-sm font-semibold rounded px-4 py-2 transition-colors"
      >
        <BarChart2 size={14} /> Open Dashboard
      </Link>
    </div>
  );
}

/* ── Alert helper ─────────────────────────────────────────────────────────── */

function Alert({ type, children }: { type: "error" | "info" | "success"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-700 bg-red-900/20 text-red-300 border-l-red-500",
    info:  "border-slate-600 bg-slate-800/60 text-slate-300 border-l-amber-400",
    success: "border-green-700 bg-green-900/20 text-green-300 border-l-green-500",
  };
  return (
    <div className={`border border-l-4 rounded px-3 py-2 text-xs ${styles[type]}`}>
      {children}
    </div>
  );
}
