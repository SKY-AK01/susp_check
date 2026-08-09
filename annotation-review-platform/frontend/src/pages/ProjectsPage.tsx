import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, Project } from "../api/client";
import { Plus, ChevronRight } from "lucide-react";

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["projects", offset],
    queryFn: () => projectsApi.list(LIMIT, offset).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => projectsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setShowCreate(false);
    },
  });

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-2 transition-colors"
        >
          <Plus size={14} /> New Project
        </button>
      </div>

      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}

      {data && (
        <>
          <div className="space-y-2">
            {data.items.map((p: Project) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-5 py-4 hover:border-blue-500 transition-colors group"
              >
                <div>
                  <p className="text-sm font-medium text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {p.project_type} · GT mode: {p.gt_mode_default}
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-500 group-hover:text-slate-300" />
              </Link>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex gap-3 mt-6">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="text-xs text-slate-400 hover:text-white disabled:opacity-30 px-3 py-1 border border-slate-700 rounded"
            >
              Previous
            </button>
            <button
              disabled={!data.has_more}
              onClick={() => setOffset(offset + LIMIT)}
              className="text-xs text-slate-400 hover:text-white disabled:opacity-30 px-3 py-1 border border-slate-700 rounded"
            >
              Next
            </button>
          </div>
        </>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onSubmit={(body) => createMutation.mutate(body)}
          loading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateProjectModal({
  onClose,
  onSubmit,
  loading,
}: {
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("car-parts");
  const [gtMode, setGtMode] = useState("uploaded_gt");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name, project_type: type, gt_mode_default: gtMode, labels: [] });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-md space-y-4"
      >
        <h2 className="text-lg font-semibold text-slate-100">New Project</h2>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Project type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="car-parts">Car Parts</option>
            <option value="ml-model">ML Model</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Ground Truth mode</label>
          <select
            value={gtMode}
            onChange={(e) => setGtMode(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="uploaded_gt">Uploaded GT</option>
            <option value="student_reference">Student Reference</option>
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-slate-600 text-slate-400 hover:text-white text-sm rounded px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded px-4 py-2 transition-colors"
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
