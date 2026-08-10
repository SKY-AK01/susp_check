/**
 * Typed API client — wraps axios, injects auth token, handles pagination.
 * All list endpoints are server-paginated; no client-side "load all" (§11.9, §13.7).
 */
import axios, { AxiosInstance } from "axios";

const BASE_URL = "/api";

export function createApiClient(): AxiosInstance {
  const client = axios.create({ baseURL: BASE_URL });
  client.interceptors.request.use((config) => {
    const token = localStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  return client;
}

export const api = createApiClient();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export type Verdict =
  | "exact_match"
  | "minor_difference"
  | "significant_difference"
  | "missing"
  | "extra"
  | "needs_manual_review";

export type ReviewStatus =
  | "open"
  | "in_review"
  | "needs_rework"
  | "approved"
  | "resolved";

export interface Project {
  id: string;
  name: string;
  project_type: string;
  gt_mode_default: string;
  created_at: string;
  updated_at: string;
}

export interface Upload {
  id: string;
  project_id: string;
  status: string;
  is_reference: boolean;
  progress_pct: number;
  processed_count: number;
  total_count: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface Student {
  id: string;
  project_id: string;
  cvat_task_id: number;
  display_name?: string;
  username?: string;
  email?: string;
  created_at: string;
}

export interface ComparisonRun {
  id: string;
  project_id: string;
  reference_set_id: string;
  upload_id: string;
  status: string;
  progress_pct: number;
  processed_count: number;
  total_count: number;
  started_at?: string;
  completed_at?: string;
}

export interface AttributeDiff {
  name: string;
  ref_value?: string;
  student_value?: string;
  edit_distance?: number;
  verdict: Verdict;
}

export interface ShapeDiff {
  id: string;
  reference_shape_id?: string;
  student_shape_id?: string;
  verdict: Verdict;
  iou_score?: number;
  attribute_diffs?: AttributeDiff[];
}

export interface ComparisonResult {
  id: string;
  run_id: string;
  student_id: string;
  student_image_id: string;
  reference_image_id?: string;
  verdict: Verdict;
  score?: number;
  review_status: ReviewStatus;
  created_at: string;
  shape_diffs: ShapeDiff[];
}

export interface ShapeData {
  id: string;
  label_name?: string;
  type: "box" | "polygon";
  geometry: Record<string, unknown>;
  attributes: Record<string, string>;
  geometry_invalid: boolean;
}

export interface OverlayPayload {
  reference_image_url?: string;
  reference_image_id?: string;
  student_image_url?: string;
  student_image_id: string;
  reference_shapes: ShapeData[];
  student_shapes: ShapeData[];
  shape_diffs: ShapeDiff[];
  ref_tags: string[];
  student_tags: string[];
}

// ── API functions ─────────────────────────────────────────────────────────────

export const projectsApi = {
  list: (limit = 50, offset = 0) =>
    api.get<Page<Project>>("/projects", { params: { limit, offset } }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (body: Record<string, unknown>) => api.post<Project>("/projects", body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<Project>(`/projects/${id}`, body),
};

export const uploadsApi = {
  initiate: (projectId: string, body: Record<string, unknown>) =>
    api.post<Upload>(`/projects/${projectId}/uploads`, body),
  uploadChunk: (uploadId: string, chunkN: number, chunk: Blob) => {
    const form = new FormData();
    form.append("file", chunk);
    return api.put(`/uploads/${uploadId}/chunks/${chunkN}`, form);
  },
  finalize: (uploadId: string) =>
    api.post<Upload>(`/uploads/${uploadId}/complete`),
  get: (uploadId: string) => api.get<Upload>(`/uploads/${uploadId}`),
  list: (projectId: string, limit = 50, offset = 0) =>
    api.get<Page<Upload>>(`/projects/${projectId}/uploads`, { params: { limit, offset } }),
  warnings: (uploadId: string, limit = 50, offset = 0) =>
    api.get(`/uploads/${uploadId}/warnings`, { params: { limit, offset } }),
};

export const runsApi = {
  trigger: (refSetId: string, uploadId: string) =>
    api.post<ComparisonRun>(`/reference-sets/${refSetId}/runs`, { upload_id: uploadId }),
  get: (runId: string) => api.get<ComparisonRun>(`/runs/${runId}`),
  results: (
    runId: string,
    params: {
      student_id?: string;
      verdict?: Verdict;
      score_min?: number;
      score_max?: number;
      sort_by?: string;
      sort_dir?: string;
      limit?: number;
      offset?: number;
    }
  ) => api.get<Page<ComparisonResult>>(`/runs/${runId}/results`, { params }),
  result: (runId: string, resultId: string) =>
    api.get<ComparisonResult>(`/runs/${runId}/results/${resultId}`),
  summary: (runId: string) => api.get(`/runs/${runId}/summary`),
};

// ── Reference Sets ────────────────────────────────────────────────────────────

export type ReferenceSourceType = "uploaded_gt" | "student";

export interface ReferenceSet {
  id: string;
  project_id: string;
  source_type: ReferenceSourceType;
  reference_upload_id?: string;
  reference_student_id?: string;
  created_at: string;
}

export const referenceSetsApi = {
  list: (projectId: string, limit = 50, offset = 0) =>
    api.get<Page<ReferenceSet>>(`/projects/${projectId}/reference-sets`, {
      params: { limit, offset },
    }),
  create: (projectId: string, body: {
    source_type: ReferenceSourceType;
    reference_upload_id?: string;
    reference_student_id?: string;
  }) => api.post<ReferenceSet>(`/projects/${projectId}/reference-sets`, body),
};

export const imagesApi = {
  overlay: (resultId: string) =>
    api.get<OverlayPayload>(`/comparison-results/${resultId}/overlay`),
};

export const feedbackApi = {
  add: (resultId: string, note: string, shapeDiffId?: string) =>
    api.post(`/comparison-results/${resultId}/feedback`, { note, shape_diff_id: shapeDiffId }),
  updateStatus: (resultId: string, review_status: ReviewStatus) =>
    api.patch(`/comparison-results/${resultId}`, { review_status }),
  bulkStatus: (resultId: string, result_ids: string[], review_status: ReviewStatus) =>
    api.post(`/comparison-results/${resultId}/bulk-status`, { result_ids, review_status }),
};

export const reportsApi = {
  studentTrend: (projectId: string) =>
    api.get(`/projects/${projectId}/reports/student-trend`),
  labelErrorRates: (projectId: string) =>
    api.get(`/projects/${projectId}/reports/label-error-rates`),
  reviewerActivity: (projectId: string) =>
    api.get(`/projects/${projectId}/reports/reviewer-activity`),
};

// ── Direct image upload ───────────────────────────────────────────────────────

export interface DirectUploadResult {
  filename: string;
  content_hash: string;
  storage_ref: string;
  matched_image_count: number;
  already_existed: boolean;
}

export interface DirectUploadResponse {
  project_id: string;
  uploaded: DirectUploadResult[];
  skipped: string[];
}

export interface ProjectImageFile {
  content_hash: string;
  raw_filename: string;
  normalized_key: string;
  url: string;
}

export const directImagesApi = {
  upload: (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return api.post<DirectUploadResponse>(
      `/projects/${projectId}/images/direct`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
  list: (projectId: string) =>
    api.get<ProjectImageFile[]>(`/projects/${projectId}/images/direct`),
};

// ── Student performance ───────────────────────────────────────────────────────

export interface VerdictBreakdown {
  exact_match: number;
  minor_difference: number;
  significant_difference: number;
  missing: number;
  extra: number;
  needs_manual_review: number;
}

export interface RunPerformancePoint {
  run_id: string;
  run_completed_at?: string;
  avg_score?: number;
  total_images: number;
  verdicts: VerdictBreakdown;
}

export interface StudentPerformance {
  student: Student;
  latest_avg_score?: number;
  latest_run_id?: string;
  total_runs: number;
  total_images_reviewed: number;
  latest_verdicts: VerdictBreakdown;
  run_history: RunPerformancePoint[];
}

export interface LeaderboardEntry {
  rank: number;
  student: Student;
  latest_avg_score?: number;
  total_images: number;
  exact_match_pct?: number;
  needs_rework_count: number;
}

export interface StudentLeaderboard {
  project_id: string;
  run_id?: string;
  entries: LeaderboardEntry[];
}

export const studentsApi = {
  list: (projectId: string, uploadId?: string, limit = 50, offset = 0) =>
    api.get<Page<Student>>(`/projects/${projectId}/students`, {
      params: { upload_id: uploadId, limit, offset },
    }),
  get: (studentId: string) => api.get<Student>(`/students/${studentId}`),
  images: (studentId: string, limit = 50, offset = 0) =>
    api.get(`/students/${studentId}/images`, { params: { limit, offset } }),
  performance: (studentId: string) =>
    api.get<StudentPerformance>(`/students/${studentId}/performance`),
  leaderboard: (projectId: string) =>
    api.get<StudentLeaderboard>(`/projects/${projectId}/students/leaderboard`),
};
