import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, Project } from "../api/client";
import { Plus, ChevronRight } from "lucide-react";

const CARD_PASTELS = [
  "bg-neo-peach", "bg-neo-mint", "bg-neo-lavender",
  "bg-neo-yellow", "bg-neo-pink", "bg-white",
];

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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-black text-black">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-black hover:bg-gray-800 text-white font-black text-sm rounded-full px-5 py-2.5 transition-transform hover:-translate-y-1 shadow-neo"
        >
          <Plus size={14} /> New Project
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 text-black font-bold">
          <div className="animate-spin rounded-full h-5 w-5 border-4 border-black border-t-transparent" />
          Loading…
        </div>
      )}

      {data && (
        <>
          <div className="space-y-3">
            {data.items.map((p: Project, i: number) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className={`flex items-center justify-between ${CARD_PASTELS[i % CARD_PASTELS.length]} border-4 border-black rounded-2xl px-5 py-4 shadow-neo hover:-translate-y-1 transition-transform group`}
              >
                <div>
                  <p className="text-base font-black text-black">{p.name}</p>
                  <p className="text-xs font-semibold text-gray-600 mt-0.5">
                    {p.project_type} · GT mode: {p.gt_mode_default}
                  </p>
                </div>
                <ChevronRight size={18} className="text-black group-hover:translate-x-1 transition-transform" />
              </Link>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex gap-3 mt-6">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="text-sm font-black text-black disabled:opacity-30 px-4 py-2 border-2 border-black rounded-full hover:bg-black hover:text-white transition-colors"
            >
              ← Previous
            </button>
            <button
              disabled={!data.has_more}
              onClick={() => setOffset(offset + LIMIT)}
              className="text-sm font-black text-black disabled:opacity-30 px-4 py-2 border-2 border-black rounded-full hover:bg-black hover:text-white transition-colors"
            >
              Next →
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-white border-4 border-black rounded-2xl shadow-neo p-6 w-full max-w-md space-y-5"
      >
        <h2 className="text-2xl font-black text-black">New Project</h2>

        <div>
          <label className="block text-sm font-black text-black mb-2">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none focus:bg-white transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-black text-black mb-2">Project type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none"
          >
            <option value="car-parts">Car Parts</option>
            <option value="ml-model">ML Model</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-black text-black mb-2">Ground Truth mode</label>
          <select
            value={gtMode}
            onChange={(e) => setGtMode(e.target.value)}
            className="w-full bg-neo-bg border-2 border-black rounded-xl px-4 py-3 text-sm text-black font-semibold focus:outline-none"
          >
            <option value="uploaded_gt">Uploaded GT</option>
            <option value="student_reference">Student Reference</option>
          </select>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border-2 border-black text-black font-black text-sm rounded-full px-4 py-2.5 hover:bg-neo-bg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-black hover:bg-gray-800 disabled:opacity-60 text-white font-black text-sm rounded-full px-4 py-2.5 transition-transform hover:-translate-y-0.5 shadow-neo-sm"
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
