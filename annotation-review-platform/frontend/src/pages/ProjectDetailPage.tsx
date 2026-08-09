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

const TAB_COLORS: Record<string, string> = {
  upload: "bg-neo-peach",
  images: "bg-neo-mint",
  students: "bg-neo-lavender",
  runs: "bg-neo-yellow",
};

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"upload" | "images" | "students" | "runs">("upload");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId!).then((r) => r.data),
    enabled: !!projectId,
  });

  const tabs = [
    { key: "upload",   label: "ZIP Upload",    icon: <UploadIcon size={13} /> },
    { key: "images",   label: "Image Upload",  icon: <ImageIcon size={13} /> },
    { key: "students", label: "Students",      icon: <Users size={13} /> },
    { key: "runs",     label: "Runs",          icon: <Play size={13} /> },
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
          className="flex items-center gap-2 bg-black hover:bg-gray-800 text-white font-black text-sm rounded-full px-5 py-2.5 transition-transform hover:-translate-y-1 shadow-neo"
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
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-black border-2 border-black rounded-full transition-all ${
              activeTab === t.key
                ? `${TAB_COLORS[t.key]} shadow-neo-sm -translate-y-0.5`
                : "bg-white text-gray-500 hover:bg-neo-bg hover:text-black"
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
    <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-6 space-y-5">
      <h2 className="text-sm font-black text-black uppercase tracking-widest">
        Upload CVAT Export ZIP
      </h2>
      <p className="text-xs font-semibold text-gray-600">
        Export your CVAT project as a ZIP (project-level XML export) and upload it here.
        Ingestion runs in the background — you'll see progress below.
      </p>
      {error && <Alert type="error">{error}</Alert>}
      {progress && <Alert type="info">{progress}</Alert>}
      <label className="inline-flex items-center gap-2 bg-black hover:bg-gray-800 text-white font-black text-sm rounded-full px-5 py-2.5 cursor-pointer transition-transform hover:-translate-y-1 shadow-neo">
        <UploadIcon size={14} />
        {uploading ? "Uploading…" : "Select ZIP"}
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={handleUpload} disabled={uploading} />
      </label>
      <p className="text-xs font-semibold text-gray-400">Files are uploaded in 5 MB chunks automatically.</p>
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
      <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-6 space-y-5">
        <h2 className="text-sm font-black text-black uppercase tracking-widest">
          Upload Source Images Directly
        </h2>
        <p className="text-xs font-semibold text-gray-600">
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
          className={`border-4 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
            dragging
              ? "border-black bg-neo-yellow shadow-neo"
              : "border-black hover:bg-neo-bg"
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon size={28} className="mx-auto mb-3 text-black" />
          <p className="text-sm font-black text-black">
            {uploading ? "Uploading…" : "Drag & drop images here, or click to browse"}
          </p>
          <p className="text-xs font-semibold text-gray-500 mt-1">JPG · PNG · WebP · BMP · TIFF</p>
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
          <div className="space-y-2">
            <p className="text-xs font-black text-black uppercase tracking-wider mb-2">
              Upload Results
            </p>
            {results.map((r) => (
              <div key={r.content_hash}
                className="flex items-center justify-between bg-neo-mint border-2 border-black rounded-xl px-3 py-2 text-xs shadow-neo-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-black shrink-0" />
                  <span className="text-black font-black font-mono">{r.filename}</span>
                  {r.already_existed && (
                    <span className="text-gray-500 font-semibold">(already stored)</span>
                  )}
                </div>
                <span className={`text-xs font-black px-2 py-0.5 rounded-full border-2 border-black ${
                  r.matched_image_count > 0
                    ? "bg-neo-mint text-black"
                    : "bg-gray-100 text-gray-500"
                }`}>
                  {r.matched_image_count} annotation{r.matched_image_count !== 1 ? "s" : ""} linked
                </span>
              </div>
            ))}
            {skipped.map((s) => (
              <div key={s}
                className="flex items-center gap-2 bg-red-100 border-2 border-black rounded-xl px-3 py-2 text-xs shadow-neo-sm">
                <X size={12} className="text-black shrink-0" />
                <span className="text-black font-black font-mono">{s}</span>
                <span className="text-red-700 font-black">skipped</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Already-uploaded images */}
      {existing && existing.length > 0 && (
        <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-5">
          <p className="text-xs font-black text-black uppercase tracking-wider mb-4">
            Stored Images ({existing.length})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto">
            {existing.map((img) => (
              <a
                key={img.content_hash}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="group block border-2 border-black rounded-xl overflow-hidden hover:-translate-y-1 transition-transform shadow-neo-sm"
              >
                <img
                  src={img.url}
                  alt={img.raw_filename}
                  className="w-full h-20 object-cover bg-neo-bg"
                  loading="lazy"
                />
                <p className="text-xs font-black text-gray-600 px-2 py-1 truncate group-hover:text-black">
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

  const scoreMap: Record<string, { score?: number; rank: number; exact_pct?: number }> = {};
  leaderboard?.entries.forEach((e) => {
    scoreMap[e.student.id] = {
      score: e.latest_avg_score,
      rank: e.rank,
      exact_pct: e.exact_match_pct,
    };
  });

  if (isLoading) return (
    <div className="flex items-center gap-3">
      <div className="animate-spin rounded-full h-5 w-5 border-4 border-black border-t-transparent" />
      <p className="text-black font-bold text-sm">Loading students…</p>
    </div>
  );

  if (!data?.items.length) return (
    <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-8 text-center">
      <p className="text-black font-black">No students yet.</p>
      <p className="text-sm font-semibold text-gray-600 mt-1">Upload a CVAT ZIP to populate them.</p>
    </div>
  );

  return (
    <div className="bg-white border-4 border-black rounded-2xl shadow-neo overflow-hidden">
      <div className="px-5 py-3 border-b-4 border-black bg-neo-lavender flex items-center justify-between">
        <p className="text-xs font-black text-black uppercase tracking-wider">
          Students ({data.total})
        </p>
        <p className="text-xs font-bold text-gray-600">Scores from latest run</p>
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
        <tbody className="divide-y-2 divide-black">
          {data.items.map((s: Student) => {
            const perf = scoreMap[s.id];
            return (
              <tr key={s.id} className="hover:bg-neo-bg transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs font-black font-mono">{perf?.rank ?? "—"}</td>
                <td className="px-4 py-3 text-black font-black">
                  {s.display_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs font-bold font-mono">
                  {s.username ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {perf?.score != null ? (
                    <span className={`font-black ${
                      perf.score >= 80 ? "text-green-600"
                      : perf.score >= 60 ? "text-yellow-600"
                      : "text-red-600"
                    }`}>
                      {perf.score.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-gray-400 font-bold">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs font-black font-mono text-black">
                  {perf?.exact_pct != null ? `${perf.exact_pct}%` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/students/${s.id}`}
                    className="text-xs font-black text-black underline decoration-2 underline-offset-2 hover:text-gray-600"
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
    <div className="bg-white border-4 border-black rounded-2xl shadow-neo p-6 space-y-4">
      <h2 className="text-sm font-black text-black uppercase tracking-widest">
        Comparison Runs
      </h2>
      <p className="text-xs font-semibold text-gray-600">
        Runs are created from the Reference Sets page. After uploading a CVAT ZIP and selecting
        a reference (GT upload or promoted student), trigger a run from the API or dashboard.
      </p>
      <Link
        to={`/projects/${projectId}/dashboard`}
        className="inline-flex items-center gap-2 bg-neo-yellow border-4 border-black text-black font-black text-sm rounded-full px-5 py-2.5 hover:-translate-y-1 transition-transform shadow-neo"
      >
        <BarChart2 size={14} /> Open Dashboard
      </Link>
    </div>
  );
}

/* ── Alert helper ─────────────────────────────────────────────────────────── */

function Alert({ type, children }: { type: "error" | "info" | "success"; children: React.ReactNode }) {
  const styles = {
    error:   "border-black bg-red-100 text-black border-l-red-500",
    info:    "border-black bg-neo-lavender text-black border-l-black",
    success: "border-black bg-neo-mint text-black border-l-green-600",
  };
  return (
    <div className={`border-2 border-l-4 rounded-xl px-3 py-2 text-xs font-bold ${styles[type]}`}>
      {children}
    </div>
  );
}
