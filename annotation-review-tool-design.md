# Supervisor Annotation-Review & Quality-Control Platform — Technical Specification

**Document status:** Implementation-ready specification (Single Source of Truth)
**Audience:** Backend engineers, frontend engineers, AI coding agents, QA
**Scope:** Full system design — no application code included, per request.

> This document supersedes the earlier draft. It is grounded in the two real CVAT exports
> provided (`CAR-Parts.zip`, `ML-Model.zip`) and is written to be scale-first: assume hundreds
> of students and hundreds of thousands of images from day one, not an afterthought.

---

## Table of Contents

1. Problem Statement & Context
2. Goals & Non-Goals
3. Terminology
4. System Lifecycle (End-to-End)
5. Source Data Deep-Dive (CVAT XML)
6. Functional Requirements
7. Architecture Overview
8. Processing Pipeline & Background Jobs
9. Comparison Engine — Detailed Design
10. Data Model / Database Schema
11. API Specification
12. Storage Strategy
13. Scalability & Large-Dataset Handling
14. Failure Recovery & Resumability
15. Error Handling & Validation
16. Security & Access Control
17. Logging & Auditability
18. Dashboard & Reporting Requirements
19. Supervisor Review & Rework Workflow
20. Acceptance Criteria
21. Open Questions & Assumptions
22. Deployment — Self-Contained Single VM
23. Appendix

---

## 1. Problem Statement & Context

Two annotation training/production pipelines currently rely on **two human reviewers** to manually
inspect every student/annotator's work, image by image, to find errors and give feedback. As the
number of students and images grows, manual review does not scale: reviewers spend most of their
time re-checking annotations that are already correct, instead of focusing on the images that
actually need attention.

There are two annotation projects today, and they differ in one important way:

| Project | Task type | Ground Truth available? |
|---|---|---|
| **ML-Model** | Vehicle detection, license plate detection, license plate OCR | **No.** One student's work is consistently high quality and can be manually promoted to serve as the reference. |
| **Car-Parts Annotation** | Car body-part polygon segmentation | **Yes.** An official Ground Truth dataset already exists and should be uploaded and used directly. |

Both projects export their annotation data from **CVAT** as a project-level XML file (see §5), where
all students' work is present in a single `annotations.xml`, differentiated internally by a
`task_id` that maps to a `<task>` entry (one task per student).

The system to be built must:
- Ingest these exports without requiring any manual pre-splitting by the supervisor.
- Automatically identify which annotations belong to which student.
- Compare every student's annotations against the correct reference (uploaded GT, or a promoted
  student), per project type.
- Surface differences at the image level, classified by severity, so reviewers spend their limited
  time only on images that need it.
- Let a supervisor visually verify any flagged image (reference vs. student, overlaid) before
  deciding on feedback or rework.
- Scale to many more students, many more images, and multiple projects running concurrently,
  without needing an architectural rewrite later.

This is a **quality-control platform**, not a one-off comparison script. It must be built assuming
it will be operated continuously, by multiple reviewers, on growing datasets.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- G1 — Ingest a supervisor-uploaded ZIP (CVAT project export) and automatically split it into
  per-student annotation sets, with zero manual file separation.
- G2 — Support two Ground Truth modes per project: **uploaded official GT** and **promoted student
  reference**, using the same downstream comparison engine for both.
- G3 — Compare every student's annotations against the reference at the image level and shape
  level, covering bounding boxes (ML-Model) and polygons (Car-Parts), including their attributes
  (`Position`, `vehicle_type`, `plate_text`, etc.).
- G4 — Classify every comparison result into a well-defined severity scale (§9.6), instead of a
  binary pass/fail, so reviewers can triage.
- G5 — Store images and annotations so that supervisors can visually inspect GT vs. student
  overlays for any flagged image.
- G6 — Provide a review dashboard supporting filtering, sorting, drill-down, and feedback/rework
  tracking per student and per image.
- G7 — Process large uploads (thousands–hundreds of thousands of images) using background jobs,
  batching, and streaming — never loading a full ZIP/XML/image set into memory at once.
- G8 — Be resumable and auditable: a failed or interrupted upload/comparison job must be safely
  retryable without data corruption or duplicate processing.
- G9 — Support multiple projects and multiple concurrent uploads without one large job starving
  others.

### 2.2 Non-Goals (explicitly out of scope for this spec)

- NG1 — This system does not train or run any ML model itself. It compares *existing* human
  annotations against a reference; it does not auto-generate annotations for images that have none.
- NG2 — This system is not a replacement for CVAT as an annotation tool. Students continue to
  annotate in CVAT (or whatever tool they currently use); this system consumes CVAT's export
  format.
- NG3 — Real-time/live annotation comparison (as a student types) is out of scope. Comparison runs
  are batch, triggered by an upload.
- NG4 — Automatic grading/scoring tied to compensation or academic credit is out of scope; this
  system produces quality signals for human reviewers, not final grades.
- NG5 — Support for annotation formats other than CVAT XML (e.g. COCO JSON, YOLO txt) is out of
  scope for v1, but the ingestion layer should be designed so a new parser can be added without
  redesigning the rest of the pipeline (see §6.3.5).

---

## 3. Terminology

| Term | Meaning |
|---|---|
| **Project** | A top-level annotation effort (e.g. "ML-Model", "Car-Parts"). Has its own label schema and GT mode. |
| **Upload / Batch** | One supervisor-submitted ZIP export, tied to a project, processed as one ingestion + comparison unit. |
| **Student / Annotator** | A person who produced annotations. Identified via CVAT `<task>` → student mapping (§5.2), not filename. |
| **Task** | A CVAT concept: one `<task>` in the export XML, owned by one student, containing a fixed set of images. |
| **Reference / GT** | The annotation set every student is compared against. Either an uploaded official Ground Truth, or one student's task promoted to "reference" status. |
| **Shape** | A single annotated object instance: a `<box>` or `<polygon>`, with a label and optional attributes. |
| **Attribute** | A key/value annotation on a shape, e.g. `Position=Right`, `plate_text=AD22767`, `vehicle_type=car`. |
| **Group ID** | An attribute (e.g. `vehicle_id`) that links related shapes in the same image, e.g. a license plate to its parent vehicle. |
| **Comparison Run** | One execution of the comparison engine over an upload, against a chosen reference. Produces `ComparisonResult` rows. |
| **Verdict** | The classification assigned to a shape or image after comparison (§9.6): Exact Match, Minor Difference, Significant Difference, Missing, Extra, Needs Manual Review. |
| **Rework** | A supervisor action flagging a specific image/shape as requiring the student to redo it. |
| **Normalized Image Key** | The identity used to match "the same source photo" across different students' submissions (§6.3.3). |

---

## 4. System Lifecycle (End-to-End)

```
 ┌───────────────┐
 │ 1. Project      │  Supervisor creates/selects a project, defines label schema
 │    Creation     │  and GT mode (uploaded_gt | student_reference).
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 2. Upload       │  Supervisor uploads a CVAT project-export ZIP.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 3. Ingestion    │  Streamed unzip → validate → enqueue parse job.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 4. Parsing      │  Incremental XML parse (SAX/iterparse) → students,
 │                 │  images, shapes, attributes extracted in batches.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 5. Student ID / │  task_id → student map built once; every image/shape
 │    Organization │  tagged with its owning student. No manual splitting.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 6. GT/Reference │  Supervisor uploads GT (Car-Parts) OR promotes a
 │    Selection    │  student (ML-Model). Stored as a ReferenceSet.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 7. Comparison   │  Background workers: image matching → shape matching
 │    Processing   │  → attribute comparison → verdict + score, per image,
 │                 │  batched and parallelized across students/images.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 8. Result        │  ComparisonResult rows persisted; run marked complete;
 │    Generation    │  aggregate student/project summaries computed.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 9. Supervisor    │  Dashboard: results table, filters, drill-down image
 │    Review        │  viewer with GT/student overlay.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 10. Feedback /   │  Supervisor leaves notes, marks images "needs rework."
 │     Rework       │  Status tracked per image/shape.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 11. Re-validation│  Student resubmits (new upload, or corrected task in
 │                  │  CVAT) → new upload processed, linked to prior run for
 │                  │  before/after comparison.
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 12. Reporting    │  Aggregate dashboards: per-student trend, per-project
 │                  │  quality over time, reviewer workload.
 └───────────────┘
```

Every stage after (2) is asynchronous and job-driven (§8) — the supervisor is never blocked waiting
on a synchronous request for anything beyond initial upload acceptance and validation.

---

## 5. Source Data Deep-Dive (CVAT XML)

This section is grounded directly in the two real files provided and must inform the parser design
literally, not just conceptually.

### 5.1 File structure

```xml
<annotations>
  <version>1.1</version>
  <meta>
    <project>
      <id>39</id>
      <name>HSBC_NeuroAI_2.0_IgnitAI_Internship_FlexiBatch</name>
      <created>...</created>
      <updated>...</updated>
      <tasks>
        <task>
          <id>783</id>
          <name>Ankita Jha</name>
          <size>10</size>
          <start_frame>0</start_frame>
          <stop_frame>9</stop_frame>
          <owner><username>Harika</username><email>...</email></owner>
          <assignee><username>Ankita-9845236993</username><email>...</email></assignee>
        </task>
        <!-- one <task> per student, repeated 15-16 times in the sample data -->
      </tasks>
      <labels>
        <label>
          <name>Front Bumper</name>
          <attributes>
            <attribute><name>Position</name> ... </attribute>
          </attributes>
        </label>
        <!-- full label schema for the whole project -->
      </labels>
    </project>
  </meta>
  <image id="0" name="FLEXI_BATCH_IgnitAI/images/Coupe_000015.jpg"
         subset="default" task_id="783" width="1450" height="622">
    <polygon label="Front Bumper" source="manual" occluded="0"
             points="884.80,346.50;906.91,361.36;..." z_order="0">
      <attribute name="Position">Front</attribute>
    </polygon>
    <!-- ML-Model uses <box xtl=".." ytl=".." xbr=".." ybr=".."> instead of <polygon> -->
  </image>
  <!-- one <image> per (student, photo) pair -->
</annotations>
```

### 5.2 Student identification — authoritative rule

**A student is identified by `task_id`, never by filename, folder, or free-text parsing of any
kind.** The parser must:

1. Parse `<meta><project><tasks>` once, building an in-memory (or first-pass DB-persisted) map:
   `task_id → {task_name, owner_username, assignee_username, assignee_email, size, start_frame, stop_frame}`.
2. For every `<image task_id="X">` encountered later in the file, look up student identity from
   that map. `assignee` is the actual student; `owner` is typically the reviewer/supervisor who
   created the task and must not be confused with the student.
3. Persist a `Student` row per unique `(project_id, task_id)` the first time it's seen (idempotent
   upsert — re-processing the same upload must not create duplicates; see §14).

### 5.3 Image identity across students

Confirmed by the project owner: **image filenames are expected to remain identical across
students** for the same source photo (e.g. every student who annotated a given car photo has an
`<image name="...Coupe_000015.jpg">` entry with that exact name). Matching is therefore a direct
string match on the normalized filename (§6.3.3).

However, the two sample files provided **do** exhibit CVAT's default per-task suffixing behavior
(`Coupe_000015.jpg`, `Coupe_000015_1.jpg`, `Coupe_000015_2.jpg`, ... one increment per task that
shares the same source image). The parser must therefore:
- Primarily match on the normalized filename (strip path + extension + lowercase).
- Treat a trailing `_<integer>` before the extension as **optional noise to strip** during
  normalization, so that both the "no suffix" (expected/confirmed) and "suffixed" (observed in
  sample data) cases resolve to the same key without configuration changes.
- Log (not silently ignore) any image that fails to find a corresponding reference-side match after
  normalization, surfaced to the supervisor as an ingestion warning (§15).

### 5.4 Annotation shape types, observed per project

| Project | Shape element | Geometry fields | Attributes observed |
|---|---|---|---|
| ML-Model | `<box>` | `xtl, ytl, xbr, ybr` | `vehicle_type` (on `vehicle` label), `plate_text` (on `licence_plate` label), `vehicle_id` (linking attribute on both) |
| Car-Parts | `<polygon>` | `points="x1,y1;x2,y2;..."` | `Position` (e.g. Front, Rear, Left, Right, Front-Right, Rear-Left, Left Side) |

Both element types share: `label`, `source` (`manual`), `occluded` (`0`/`1`), `z_order`, and zero or
more nested `<attribute name="...">value</attribute>` elements. The parser's internal `Shape` model
must be **geometry-type-agnostic at the schema level** (store `type: "box"|"polygon"` +
type-appropriate geometry payload + a generic attributes map), so the same downstream code
(storage, API, dashboard) works for both without project-specific branching outside the comparison
engine itself.

### 5.5 Image-level (frame-level) tags

The label schema in the ML-Model export also defines project-level tags without geometry —
`Mirror-Image`, `Rotated`, `No Plates`, `Unreadable_Plate` — which in CVAT can be applied as
whole-image tags rather than shapes. The parser must support ingesting `<tag>` elements (CVAT's
element for frame-level, non-geometric labels) in addition to `<box>`/`<polygon>`, since these
directly affect comparison logic (§9.7 — e.g. an image tagged `Unreadable_Plate` by the reference
should not penalize a student for a missing/uncertain OCR read).

### 5.6 Scale observed vs. scale to design for

The two sample files contain ~15–16 students and ~10 images per student (~150–160 images total per
project). This is a **development/pilot-scale sample**. The system must be architected for the
stated production target — hundreds of students and up to hundreds of thousands of images — even
though the sample data is small; see §13.

---

## 6. Functional Requirements

### 6.1 Project Creation & Configuration

- FR-1.1 A supervisor can create a project with: name, project type identifier, label schema
  (imported from a sample XML or defined manually), and GT mode (`uploaded_gt` |
  `student_reference`).
- FR-1.2 GT mode is a project-level default but must be overridable per upload/run — a supervisor
  may want to re-run ML-Model comparisons against a *different* promoted student later without
  changing the project's historical configuration.
- FR-1.3 Label schema per project includes, per label: geometry type expected (`box` | `polygon`),
  allowed attribute keys, and for each attribute whether it is categorical (with an allowed value
  set) or free-text (e.g. OCR fields).
- FR-1.4 Comparison thresholds (IoU cutoffs, OCR edit-distance tolerance, etc., §9.5) are
  configurable per project, with sensible defaults, not hardcoded in the engine.

### 6.2 Upload Workflow

- FR-2.1 Supervisor uploads a ZIP file via the UI (chunked upload for large files, §13.1).
- FR-2.2 Upload is accepted immediately and returns an `Upload` record with `status=pending`; all
  further processing happens asynchronously. The UI must poll or subscribe (WebSocket/SSE) for
  status updates rather than blocking.
- FR-2.3 Basic validation happens synchronously before accepting the job: file is a valid ZIP,
  contains at least one `.xml` file, and the ZIP is under a configurable max size (reject
  early with a clear error otherwise, not after a long background failure).
- FR-2.4 An upload can optionally include an `images/` directory (if the CVAT export included
  "save images"); if absent, the system must support pulling images by a separate mechanism
  (§6.3.6 / open question).

### 6.3 Ingestion & Parsing Pipeline

- FR-3.1 The ZIP is extracted using a **streaming** approach — entries are read and processed one
  at a time from the archive; the full ZIP is never fully decompressed into a single in-memory
  buffer (§13.2).
- FR-3.2 The XML is parsed using an **incremental/event-driven parser** (e.g. SAX-style
  `iterparse`), never a full DOM load of the entire file into memory, since a production XML could
  contain hundreds of thousands of `<image>` elements.
- FR-3.3 Parsing proceeds in two passes:
  - **Pass 1 (meta):** parse `<meta><project>` fully (tasks, labels) — this section is small and
    safe to hold in memory.
  - **Pass 2 (images):** stream `<image>` elements one at a time; for each, extract its shapes/tags,
    attach the student via the task map from Pass 1, and emit a batch of records (e.g. every 500
    images) to be written to the database, rather than accumulating all images before writing.
- FR-3.4 Parsing errors on an individual `<image>` element (malformed geometry, unknown label, etc.)
  must not abort the entire job — the offending element is logged as a `ParseWarning` linked to the
  upload, and parsing continues (§15.2).
- FR-3.5 XML file identification/validation:
  - Must locate `annotations.xml` (or the correctly-named export file) inside the ZIP even if
    nested in subdirectories.
  - Must reject/flag a ZIP that contains multiple top-level annotation XML files unless the project
    is explicitly configured to expect multiple.
- FR-3.6 The parsing layer must be pluggable: a `AnnotationFormatParser` interface with a CVAT-XML
  implementation now, so a COCO/YOLO parser can be added later without touching ingestion
  orchestration, storage, or comparison code (addresses NG5).

### 6.4 Student Identification & Organization

- FR-4.1 Students are identified strictly via the `task_id → task/assignee` mapping (§5.2); no
  filename or folder-based inference.
- FR-4.2 A student record is upserted (create-if-absent, else match existing) keyed by
  `(project_id, cvat_task_id)`, so re-uploads of the same project reuse the same student identity
  rather than duplicating it.
- FR-4.3 The system must handle a student appearing across multiple uploads (e.g. resubmission
  after rework) and preserve their history rather than overwriting it — each upload creates new
  `Image`/`Shape` rows tied to that upload, never mutating a prior upload's data.
- FR-4.4 If the same `task_id` maps to a different `assignee` across two uploads of the same
  project (e.g. task reassigned), this must be flagged as a warning, not silently accepted as
  "the same student," since it could indicate a task-reassignment mid-review-cycle.

### 6.5 Ground Truth / Reference Selection Workflow

- FR-5.1 **Uploaded GT mode** (Car-Parts-style): supervisor uploads a GT export (same CVAT-XML
  format) through the same ingestion pipeline, flagged `is_reference=true`. It is stored and
  organized identically to a student's submission — this keeps the comparison engine uniform
  (§6.6) — but excluded from "students to review" listings.
- FR-5.2 **Promoted-student mode** (ML-Model-style): supervisor selects one existing, already-
  ingested student (by `task_id`) from a given upload to serve as the reference for that
  `ComparisonRun`. No re-upload needed.
- FR-5.3 A `ReferenceSet` is created per comparison run, capturing exactly which images/shapes were
  used as reference, so historical runs remain reproducible even if a "better" student is promoted
  later.
- FR-5.4 The UI must clearly show, for any given comparison run, which mode was used and which
  student/GT source was the reference, on every results screen (avoids ambiguity when multiple runs
  exist over time).
- FR-5.5 Changing the reference (promoting a different student, or uploading a revised GT) must
  trigger a new `ComparisonRun`, not mutate results from a prior run in place.

### 6.6 Annotation Comparison Logic (summary — full detail in §9)

- FR-6.1 A single comparison engine services both project types; the only difference is where
  reference shapes originate (§6.5), and per-project geometry type (box vs. polygon, §9.3).
- FR-6.2 Comparison operates in this order: image matching → (optional) shape grouping → shape
  matching → attribute comparison → per-shape verdict → per-image verdict/score → per-student
  summary → per-project summary.
- FR-6.3 All thresholds used in the above are read from project configuration (§6.1), not
  hardcoded.

### 6.7 Image & Annotation Storage / Retrieval

- FR-7.1 Every ingested image (reference and student) is stored durably in object storage, keyed so
  that duplicate bytes (the same source photo appearing under multiple students, or reused across
  uploads) are **not stored multiple times** — see content-hash dedup, §12.3.
- FR-7.2 Every shape and attribute is stored relationally, queryable independently of any specific
  comparison run (so ad hoc queries like "every polygon labeled `Bonnet` with `Position=Left`
  across all students" are possible without re-parsing XML).
- FR-7.3 Retrieval APIs support pagination and filtering (§11) — the dashboard must never request
  "all images for a project" in one unbounded call.

### 6.8 Display: GT vs. Student Visualization

- FR-8.1 For any `(reference_image, student_image)` pair, the UI can render both images with their
  respective shapes overlaid (distinct colors per source), plus a diff overlay highlighting missed
  (red), extra (orange), boundary-off (yellow), and mislabeled (purple) shapes.
- FR-8.2 Overlay rendering is driven by vector shape data already in the DB (§10), not by
  re-parsing XML or re-rendering server-side images per request — this keeps the viewer fast at
  scale.
- FR-8.3 Attribute mismatches (e.g. wrong `Position`, wrong `plate_text`) are shown as inline
  badges/labels on the relevant shape, not just as a separate text list, so the visual and textual
  diff stay connected.

### 6.9 Supervisor Review Workflow

- FR-9.1 Results table: one row per `(student, image)` per run, filterable by verdict, student,
  score range, and label; sortable by score.
- FR-9.2 Drill-down from any row into the image detail view (§6.8).
- FR-9.3 Bulk actions: mark multiple images as "reviewed"/"reworked" without opening each
  individually, for cases where a batch of flags are false positives (e.g. a systematic reference
  error).
- FR-9.4 Two (or more) reviewers can work on the same project concurrently without conflicting —
  review actions are attributed to the acting reviewer and do not lock records exclusively (see
  §16 for access control, §17 for audit trail).

### 6.10 Feedback / Rework Workflow

- FR-10.1 A reviewer can attach a free-text note to any `ComparisonResult` (image-level) or
  individual `Shape` diff.
- FR-10.2 A reviewer can set a status on a `ComparisonResult`: `open → in_review → needs_rework |
  approved → resolved`.
- FR-10.3 When a student resubmits corrected work (new upload), the system should allow linking the
  new `ComparisonResult` back to the original one it's meant to resolve, so before/after can be
  shown (§6.11).
- FR-10.4 Feedback/rework state changes are exportable (CSV/JSON) so they can be communicated back
  to students through whatever channel is already used (e.g. manually, or pushed into CVAT as task
  comments in a future iteration — out of scope for v1 beyond export).

### 6.11 Re-validation

- FR-11.1 A resubmission is just a new `Upload` for the same project; the system does not require
  any special "resubmission mode," but the UI should let a reviewer view a student's history of
  runs side by side (verdict/score trend over time per image or per student).

---

## 7. Architecture Overview

```
                         ┌─────────────────────────┐
                         │        Frontend (SPA)      │
                         │  Upload UI · Dashboard      │
                         │  Results table · Image view  │
                         └─────────────┬─────────────┘
                                       │ REST/GraphQL + WebSocket (progress)
                         ┌─────────────▼─────────────┐
                         │        API Gateway /         │
                         │        Backend Service        │
                         │  (FastAPI or similar)          │
                         │  - Auth/RBAC                    │
                         │  - Upload intake + validation    │
                         │  - Read APIs (paginated)          │
                         │  - Job status APIs                 │
                         └───────┬─────────────┬────────┘
                                 │ enqueue          │ query
                    ┌────────────▼──────┐    ┌──────▼──────────┐
                    │   Job Queue          │    │   Relational DB   │
                    │  (Redis/RabbitMQ +   │    │   (PostgreSQL)      │
                    │   Celery/RQ workers)  │    │   projects, students,│
                    └────────────┬──────┘    │   images, shapes,      │
                                 │            │   comparison results,   │
              ┌──────────────────┼─────────┐  │   feedback, jobs, audit │
              ▼                  ▼         ▼  └────────────────────┘
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │ Ingestion       │  │ Comparison     │  │ Cleanup/       │
     │ Workers          │  │ Workers         │  │ Retention      │
     │ - unzip stream   │  │ - image match    │  │ Workers         │
     │ - XML parse       │  │ - shape match     │  │ - expire old    │
     │ - batch DB writes │  │ - attribute diff   │  │   temp files    │
     └──────┬───────┘  └──────┬───────┘  └──────────────┘
            │                    │
            ▼                    ▼
     ┌────────────────────────────────┐
     │        Object Storage (S3-compatible) │
     │  raw ZIPs · extracted images ·         │
     │  content-hash-deduped image blobs      │
     └────────────────────────────────┘
```

### 7.1 Backend responsibilities
- Auth/session management and RBAC (§16).
- Upload intake, validation, chunked-upload assembly.
- Enqueue and track background jobs (ingestion, comparison, cleanup).
- All read/query APIs — paginated, filtered, indexed.
- Serve pre-computed vector shape data for overlay rendering (not image re-processing).
- Emit progress events (job % complete) via WebSocket/SSE or pollable status endpoint.

### 7.2 Frontend responsibilities
- Upload UI with progress indication for large files (chunked upload progress, then background
  job progress after upload completes).
- Results table with server-side pagination/filtering/sorting (never client-side loading of an
  entire project's results).
- Image detail viewer: renders reference + student shape overlays from vector data via
  SVG/Canvas.
- Feedback/rework interactions.
- Dashboard/reporting views, also server-paginated/aggregated.

### 7.3 Worker responsibilities
- **Ingestion workers:** stream-unzip, incrementally parse XML, batch-write to DB, upload images
  to object storage (content-hash deduped), emit progress checkpoints.
- **Comparison workers:** consume a `ComparisonRun` job, process student-by-student (or
  image-batch-by-image-batch) in parallel across multiple workers, write `ComparisonResult` rows,
  update run status/progress.
- **Cleanup/retention workers:** scheduled jobs enforcing retention policy (§12.5) and removing
  orphaned temp files from failed/aborted uploads.

### 7.4 Why background jobs, not synchronous processing

Given the explicit requirement to support "thousands to hundreds of thousands of images" and
"multiple projects processed at the same time," **no ingestion or comparison step may run inline
within an HTTP request**. Every such operation is queued and processed by a pool of workers whose
concurrency is independently scalable from the API tier, and whose failures are isolated per-job
(one bad upload cannot take down the API or block other projects' jobs) — detailed in §13.

---

## 8. Processing Pipeline & Background Jobs

### 8.1 Job types

| Job type | Trigger | Typical unit of work | Idempotent? |
|---|---|---|---|
| `ingest_upload` | Upload accepted | One ZIP → many sub-tasks (see 8.2) | Yes — re-running on the same `upload_id` must not duplicate data (upsert semantics, §14.2) |
| `parse_xml_batch` | Sub-task of ingestion | A chunk of N `<image>` elements (e.g. 500) | Yes — batch has a checkpoint offset |
| `store_image_batch` | Sub-task of ingestion | A chunk of N images to upload to object storage | Yes — content-hash means re-upload is a no-op |
| `run_comparison` | Reference selected + "Run Comparison" triggered | One `ComparisonRun`, fanned out per student | Yes — reruns create a new run, don't mutate old one |
| `compare_student_images` | Sub-task of `run_comparison` | One student's full image set vs. reference | Yes — safe to retry |
| `cleanup_retention` | Scheduled (e.g. hourly/daily) | Expire old temp artifacts per policy | Yes, naturally |

### 8.2 Ingestion job breakdown (detail)

```
ingest_upload(upload_id)
  1. Stream-extract ZIP entries one at a time from object storage (never full extraction to a
     single directory of unbounded size without limits; enforce per-entry and total size caps).
  2. Locate and stream-parse annotations.xml, Pass 1 (meta: tasks + labels) → persist Students,
     Labels immediately (small, safe to do eagerly).
  3. Stream-parse Pass 2 (images): for every N images accumulated (configurable batch size, e.g.
     500), enqueue parse_xml_batch as a sub-job so a single giant XML doesn't block one worker for
     the entire duration and so partial progress is checkpointed.
  4. For images shipped in the ZIP's images/ folder (if present): stream each file directly to
     object storage, computing a content hash for dedup, in batches (store_image_batch),
     independent of the XML parse (can run concurrently).
  5. Update Upload.status and Upload.progress_pct as batches complete; on the final batch, mark
     status=ingested.
  6. Any per-element parse failures are recorded as ParseWarning rows, not job failures — the
     overall job fails only on fatal errors (corrupt ZIP, unreadable XML root, no images at all).
```

### 8.3 Comparison job breakdown (detail)

```
run_comparison(run_id)
  1. Resolve ReferenceSet (uploaded GT images/shapes, or promoted student's images/shapes).
  2. Build the normalized-image-key index for the reference set once (§6.3.3 equivalent → §9.2).
  3. Fan out one compare_student_images sub-job per student in the upload, so students are
     processed in parallel across the worker pool — a project with 500 students does not serialize
     into one long-running job.
  4. Each compare_student_images sub-job:
     a. Match this student's images to reference images by normalized key.
     b. For each matched image pair: shape grouping (if applicable) → shape matching (IoU) →
        attribute comparison → per-shape verdict.
     c. Roll up to per-image verdict/score; write ComparisonResult rows in batches.
     d. Update run progress counters atomically (e.g. via DB counter increment or a job-progress
        table) so overall run progress is queryable without scanning all results.
  5. When all student sub-jobs complete, compute per-student and per-project summary aggregates
     and mark ComparisonRun.status=complete.
  6. If a sub-job fails (e.g. a corrupt shape), it retries with backoff (§14.3) up to a configured
     limit, then marks that student's sub-result as failed while allowing the rest of the run to
     complete — a single bad student's data must not block the entire run.
```

### 8.4 Concurrency & isolation across projects

- Jobs are queued with a `project_id` and/or `upload_id` as routing/priority metadata. Worker pools
  can be configured with per-project or global concurrency limits so one very large upload cannot
  monopolize all workers and starve smaller/other projects' jobs (fair-share or priority queueing).
- Recommend separate queues (or priority lanes) for `ingest_upload` vs. `run_comparison` vs.
  `cleanup_retention`, since these have different resource profiles (I/O-heavy vs. CPU-heavy vs.
  low-priority background).

### 8.5 Progress tracking

- `Upload` and `ComparisonRun` each expose: `status` (`pending|processing|complete|failed|
  partially_failed`), `progress_pct`, `processed_count`, `total_count`, `started_at`,
  `completed_at`, and a rolling `last_heartbeat_at` from the active worker (used to detect stalled
  jobs, §14.4).
- Progress is updated incrementally per batch (§8.2/8.3), not only at job completion, so the UI can
  show real progress (e.g. "12,400 / 87,000 images parsed") for large uploads rather than a spinner.

---

## 9. Comparison Engine — Detailed Design

### 9.1 Design principle

The engine must **never silently assume a difference means the student is wrong**. Every automated
verdict is a *triage signal* for a human reviewer, not a final judgment. Ambiguous cases are
explicitly routed to a `Needs Manual Review` verdict rather than forced into Match/Mismatch (§9.6).

### 9.2 Stage 1 — Image matching

- Match student images to reference images using the normalized-key rule from §5.3: strip path,
  strip extension, lowercase, and (as a compatibility fallback) strip a trailing `_<integer>`.
- Build this as a hash index (`normalized_key → reference_image_id`) once per run, so matching is
  O(1) per student image rather than a scan per lookup — essential at scale (§13.5).
- **Unmatched cases:**
  - Reference has an image the student's set doesn't contain → verdict `Missing` at the image
    level (student didn't submit/annotate this image at all).
  - Student has an image the reference set doesn't contain → verdict `Extra` at the image level,
    flagged for review (could mean a duplicate/misnamed file, or a legitimately extra image — do
    not auto-discard).

### 9.3 Stage 2 — Shape grouping (project-config-driven)

- If the project's label schema defines a "grouping attribute" (e.g. `vehicle_id` in ML-Model,
  linking a `licence_plate` box to its parent `vehicle` box), shapes sharing the same group value
  within an image are clustered before matching, so a plate is only compared against the plate
  belonging to the *same* vehicle instance, not any vehicle in the frame.
- Car-Parts has no grouping attribute in the current schema — this stage is a no-op there, but the
  engine must treat it as configuration, not a hardcoded per-project branch, so a future project
  can opt in.
- When group linkage disagrees between reference and student (e.g. student assigned `vehicle_id=1`
  to a plate that visually belongs to the vehicle GT calls `vehicle_id=0`), this is not silently
  "corrected" — it is compared using geometric proximity/containment as a fallback and flagged for
  manual review if group and geometry disagree (§9.7 edge case table).

### 9.4 Stage 3 — Shape matching (geometry)

For each reference shape in a matched image, find its best-corresponding student shape of the same
label:

- **Geometry metric by type:**
  - `box` (ML-Model): standard rectangle IoU = intersection area / union area.
  - `polygon` (Car-Parts): polygon IoU using a computational-geometry library (e.g. Shapely) —
    handles self-consistent, non-self-intersecting polygons; malformed/self-intersecting polygons
    are caught and flagged (§15.3), not passed into geometry math that could throw or misbehave.
- **Assignment:** matching reference shapes to student shapes of the same label is a **bipartite
  assignment problem**, solved via the Hungarian algorithm (optimal) for label groups above a small
  size, or greedy descending-IoU matching for very small groups (typical case: 1–3 shapes per label
  per image) where the two approaches produce identical results but greedy is cheaper. This
  guarantees each reference shape claims at most one student shape and vice versa, correctly
  handling images with multiple instances of the same label (e.g. two "Grille" polygons, two
  "vehicle" boxes).
- **Cross-label geometry check:** after same-label matching, any *unmatched* student shape is also
  checked for high geometric overlap against unmatched reference shapes of *different* labels — if
  found, this is flagged as a **mislabeled** case (right place, wrong label) rather than being
  reported as one unrelated "missing" + one unrelated "extra," which would obscure the real error.

### 9.5 Stage 4 — Attribute comparison (on matched shape pairs only)

| Attribute type | Examples | Comparison method |
|---|---|---|
| Categorical, fixed value set | `Position` (Front/Rear/Left/.../Front-Right), `vehicle_type` | Exact match required. Mismatch = attribute-error verdict on that shape. |
| Free text / OCR | `plate_text` | Exact match preferred; edit-distance (Levenshtein) computed as a secondary signal. Distance 0 = match; distance ≤ configurable threshold (default 1) = "minor difference" (e.g. 0/O, 1/I confusions); above threshold = "significant difference." |
| Linking / grouping | `vehicle_id` | Not compared for equality of the raw value (arbitrary per-annotator numbering) — compared only via whether the *grouping structure* it implies matches (§9.3). |
| Frame-level tags | `Mirror-Image`, `Rotated`, `No Plates`, `Unreadable_Plate` | Set-comparison per image: tags present on reference vs. student; a tag on the reference (e.g. `Unreadable_Plate`) suppresses/downgrades OCR-mismatch penalties for that image (§9.7). |

All thresholds in this table (edit-distance cutoff, etc.) are project-configurable, per FR-6.3 —
this table documents defaults, not fixed constants.

### 9.6 Verdict taxonomy

This replaces the earlier three-tier scale with the full six-state taxonomy requested:

| Verdict | Applies to | Meaning | Example |
|---|---|---|---|
| **Exact Match** | Shape or image | Geometry and all attributes match within configured tight tolerance (near-1.0 IoU / identical text) | Polygon overlaps reference at IoU ≥ 0.9, `Position` identical |
| **Minor Difference** | Shape or image | Small boundary/text deviation, unlikely to represent a real error | IoU 0.6–0.9 (polygon) / 0.75–0.9 (box); OCR edit-distance 1 |
| **Significant Difference** | Shape or image | Meaningful deviation likely representing an actual annotation error | IoU below minor-difference floor but shape still matched; attribute categorically wrong; OCR edit-distance above threshold |
| **Missing** | Shape or image | Present in reference, absent in student | Reference has a `Bonnet` polygon; student has none in that image; or student didn't submit the image at all |
| **Extra** | Shape or image | Present in student, absent in reference | Student annotated a part/object the reference doesn't have; or an image not present in the reference set at all |
| **Needs Manual Review** | Shape or image | Automated signals are ambiguous/conflicting and should not be auto-classified | Group-linkage disagreement (§9.3); malformed geometry that partially parsed (§15.3); reference itself tagged `Unreadable_Plate`/`Mirror-Image` making comparison unreliable; IoU falls exactly at a configured boundary with low confidence margin |

Every shape-level verdict rolls up into one image-level verdict using **worst-case-wins** ordering:
`Missing/Extra/Significant Difference/Needs Manual Review` > `Minor Difference` > `Exact Match`. An
image with even one shape in a serious category is not reported as an overall match — but the
per-shape breakdown remains visible in the drill-down view so the reviewer sees *why*.

### 9.7 Explicit edge-case handling

| Case | Handling |
|---|---|
| Reference image has zero annotations (deliberately empty image) | Student's zero-annotation submission on that image = `Exact Match`; any annotation the student adds = `Extra`, flagged for review rather than assumed wrong (could be a legitimately missed object in the reference itself). |
| Student image entirely missing from their submission | Image-level `Missing`, distinct from "image present but empty," since these indicate different problems (didn't do the task vs. correctly found nothing). |
| Multiple objects of the same label in one image | Handled by the assignment/matching step (§9.4) — not a special case, but explicitly tested since both sample projects exhibit it (multiple `Grille` polygons; multiple vehicles/plates). |
| Reference itself tagged `Unreadable_Plate` or blurred/low-confidence | OCR mismatches on that image are downgraded to `Needs Manual Review` rather than `Significant Difference` — the system should not penalize a student for disagreeing with an inherently ambiguous reference. |
| Reference tagged `Mirror-Image` or `Rotated` | Flagged for manual review before geometric comparison runs at all — orientation metadata affects whether direct pixel/geometry comparison is even meaningful; do not blindly IoU-compare without accounting for this. |
| Malformed/self-intersecting polygon geometry | Caught during parsing/pre-processing (§15.3); shape is stored but flagged `geometry_invalid=true` and excluded from automated IoU scoring, rolled up as `Needs Manual Review` for that shape. |
| Group-ID (`vehicle_id`) mismatch between reference and student | Not auto-corrected; matched via geometric fallback and flagged `Needs Manual Review` if the fallback match's confidence is low (§9.3). |
| Duplicate annotation (two shapes drawn on the same object by the same student) | Detected via very-high mutual IoU between two student shapes of the same label; flagged as a data-quality warning on the student's submission, not folded silently into the reference comparison. |
| Wrong project/format uploaded (e.g. an ML-Model export uploaded to the Car-Parts project) | Detected at ingestion via label-schema mismatch (§15.1) — job fails fast with a clear error rather than producing nonsense comparison results. |

### 9.8 Scoring

In addition to categorical verdicts, a numeric score (0–100) is computed per image as a weighted
combination of: mean shape-level IoU across matched shapes, penalty for each `Missing`/`Extra`
shape, and penalty for each attribute mismatch — weights configurable per project. This numeric
score exists purely for **sorting/prioritization** in the dashboard (worst-first review queues); it
is never used as the sole basis for a verdict, since verdicts are driven by the explicit rules in
§9.6, not by thresholding the composite score.

---

## 10. Data Model / Database Schema

Relational (PostgreSQL recommended). Indexes called out explicitly since query performance at scale
is a stated requirement, not an afterthought.

```
Project
  id (PK)
  name
  project_type            -- free text/enum, extensible
  gt_mode_default          -- "uploaded_gt" | "student_reference"
  label_schema_id (FK)
  created_at, updated_at

LabelSchema
  id (PK)
  project_id (FK)
  version                  -- schema can evolve; keep history

Label
  id (PK)
  label_schema_id (FK)
  name
  geometry_type            -- "box" | "polygon"
  INDEX (label_schema_id, name)

LabelAttribute
  id (PK)
  label_id (FK)
  name
  value_type                -- "categorical" | "free_text" | "linking"
  allowed_values             -- JSON array, nullable (categorical only)

Upload
  id (PK)
  project_id (FK)
  uploaded_by (FK -> User)
  source_zip_ref              -- object storage key
  status                       -- pending|processing|ingested|failed|partially_failed
  progress_pct, processed_count, total_count
  is_reference                 -- true if this upload is an uploaded-GT submission
  started_at, completed_at, last_heartbeat_at
  INDEX (project_id, status)

Student
  id (PK)
  project_id (FK)
  cvat_task_id                  -- unique per project
  display_name, username, email
  UNIQUE (project_id, cvat_task_id)
  INDEX (project_id)

Image
  id (PK)
  project_id (FK)
  upload_id (FK)
  student_id (FK, nullable if this Image belongs to an uploaded-GT Upload)
  raw_filename
  normalized_key                -- see §9.2
  width, height
  content_hash                   -- for dedup, see §12.3
  storage_ref
  INDEX (project_id, normalized_key)
  INDEX (upload_id, student_id)
  INDEX (content_hash)

Shape
  id (PK)
  image_id (FK)
  label_id (FK)
  type                            -- "box" | "polygon"
  geometry                        -- JSONB: {xtl,ytl,xbr,ybr} or {points:[[x,y],...]}
  group_value                      -- nullable, raw linking-attribute value (e.g. vehicle_id)
  geometry_invalid                  -- bool, see §9.7
  INDEX (image_id)
  INDEX (image_id, label_id)

ShapeAttribute
  id (PK)
  shape_id (FK)
  name, value
  INDEX (shape_id)

Tag  (image-level, non-geometric — §5.5)
  id (PK)
  image_id (FK)
  name
  INDEX (image_id)

ReferenceSet
  id (PK)
  project_id (FK)
  source_type                       -- "uploaded_gt" | "student"
  reference_upload_id (FK, nullable) -- set if uploaded_gt
  reference_student_id (FK, nullable) -- set if student
  created_at

ComparisonRun
  id (PK)
  project_id (FK)
  reference_set_id (FK)
  upload_id (FK)                     -- the student-submissions upload being evaluated
  status                              -- pending|processing|complete|failed|partially_failed
  progress_pct, processed_count, total_count
  started_at, completed_at, last_heartbeat_at
  INDEX (project_id, status)
  INDEX (upload_id)

ComparisonResult   -- one row per (run, student, image)
  id (PK)
  run_id (FK)
  student_id (FK)
  student_image_id (FK)
  reference_image_id (FK, nullable)   -- null if student image had no reference match (Extra)
  verdict                              -- enum, §9.6
  score                                 -- 0-100
  review_status                         -- open|in_review|needs_rework|approved|resolved
  INDEX (run_id, student_id)
  INDEX (run_id, verdict)
  INDEX (run_id, score)

ShapeDiff   -- one row per matched/unmatched shape pair within a ComparisonResult
  id (PK)
  comparison_result_id (FK)
  reference_shape_id (FK, nullable)
  student_shape_id (FK, nullable)
  verdict                                -- shape-level, §9.6
  iou_score                               -- nullable
  attribute_diffs                          -- JSONB: [{name, ref_value, student_value, verdict}]
  INDEX (comparison_result_id)

Feedback
  id (PK)
  comparison_result_id (FK, nullable)
  shape_diff_id (FK, nullable)
  reviewer_id (FK -> User)
  note
  created_at

ParseWarning
  id (PK)
  upload_id (FK)
  image_id (FK, nullable)
  severity                                 -- warning|error
  message
  created_at

JobRun    -- generic background-job audit/status table
  id (PK)
  job_type, related_entity_type, related_entity_id
  status, attempt_count, max_attempts
  started_at, completed_at, last_heartbeat_at, error_message

AuditLog
  id (PK)
  actor_id (FK -> User)
  action, entity_type, entity_id
  metadata (JSONB)
  created_at
  INDEX (entity_type, entity_id)
  INDEX (actor_id, created_at)

User
  id (PK), email, name, role   -- see §16
```

### 10.1 Indexing rationale (called out explicitly per requirement)

- `Image(project_id, normalized_key)` — the hot path for image matching in every comparison run;
  must be indexed, not scanned.
- `ComparisonResult(run_id, verdict)` and `(run_id, score)` — the dashboard's primary filter/sort
  paths; without these, the results table degrades badly past a few thousand rows.
- `Shape(image_id, label_id)` — needed for per-label shape lookups during matching and for
  dashboard aggregate queries like "error rate for label X."
- `Student(project_id, cvat_task_id)` unique constraint — enforces the idempotent-upsert guarantee
  from FR-4.2.
- `Image(content_hash)` — supports the storage-dedup lookup (§12.3) without a full table scan.

### 10.2 Partitioning consideration (scale)

If a single project grows into the hundreds-of-thousands-of-images range, `Image`, `Shape`, and
`ComparisonResult` should be considered for partitioning by `project_id` (or `upload_id`/`run_id`
range) so that queries and maintenance (vacuum, index rebuilds) on one large project don't degrade
performance for others. This is a scale-out option to design the schema to *allow*, not something
required at pilot scale (~150 images/project as observed today).

---

## 11. API Specification

REST, JSON. All list endpoints are paginated (`limit`/`offset` or cursor-based — cursor-based
preferred at scale to avoid deep-offset performance cliffs) and support filtering.

### 11.1 Projects
```
POST   /api/projects                          create project
GET    /api/projects                          list projects (paginated)
GET    /api/projects/{project_id}              get project + label schema
PATCH  /api/projects/{project_id}               update config (thresholds, gt_mode_default)
```

### 11.2 Uploads
```
POST   /api/projects/{project_id}/uploads         initiate upload (returns upload_id + chunked-upload target)
PUT    /api/uploads/{upload_id}/chunks/{n}          upload a chunk (chunked upload, §13.1)
POST   /api/uploads/{upload_id}/complete             finalize chunked upload, enqueue ingest_upload job
GET    /api/uploads/{upload_id}                       status + progress
GET    /api/uploads/{upload_id}/warnings                paginated ParseWarning list
DELETE /api/uploads/{upload_id}                         cancel/delete (subject to retention rules, §12.5)
```

### 11.3 Students
```
GET    /api/projects/{project_id}/students             paginated, filterable by upload_id
GET    /api/students/{student_id}                        student detail + summary stats
GET    /api/students/{student_id}/images                  paginated images for that student
```

### 11.4 Reference / GT
```
POST   /api/projects/{project_id}/reference-sets           create (uploaded_gt: pass upload_id;
                                                              student_reference: pass student_id)
GET    /api/projects/{project_id}/reference-sets            list, with source_type/history
```

### 11.5 Comparison runs
```
POST   /api/reference-sets/{ref_set_id}/runs                 trigger a ComparisonRun against a
                                                                 target upload_id
GET    /api/runs/{run_id}                                      status + progress
GET    /api/runs/{run_id}/results                                paginated ComparisonResult list;
                                                                   filters: student_id, verdict,
                                                                   score range, label
GET    /api/runs/{run_id}/results/{result_id}                     single result detail incl. all
                                                                     ShapeDiffs
GET    /api/runs/{run_id}/summary                                   aggregate: per-student and
                                                                       per-verdict counts
```

### 11.6 Image/shape data for visualization
```
GET    /api/images/{image_id}                            image metadata + storage URL (signed)
GET    /api/images/{image_id}/shapes                       vector shape list for overlay rendering
GET    /api/comparison-results/{result_id}/overlay          combined payload: reference image +
                                                               shapes, student image + shapes,
                                                               shape diffs — single call for the
                                                               detail view to avoid N+1 requests
```

### 11.7 Feedback / rework
```
POST   /api/comparison-results/{result_id}/feedback            add note
PATCH  /api/comparison-results/{result_id}                       update review_status
POST   /api/comparison-results/{result_id}/bulk-status             bulk status update (FR-9.3),
                                                                      accepts a list of result_ids
```

### 11.8 Reporting
```
GET    /api/projects/{project_id}/reports/student-trend           per-student score/verdict over
                                                                      time across runs
GET    /api/projects/{project_id}/reports/label-error-rates          error rate broken down by
                                                                        label (e.g. "Rear Quarter
                                                                        Panel is wrong 30% of the
                                                                        time across students")
GET    /api/projects/{project_id}/reports/reviewer-activity            audit-derived reviewer
                                                                          throughput
```

### 11.9 API design constraints

- Every list endpoint must default to a bounded page size (e.g. 50) and cap the maximum (e.g. 500)
  — no "return everything" mode, to prevent accidental unbounded queries at scale.
- Endpoints returning image/shape data for visualization must be **read-optimized denormalized
  payloads** (§11.6, the `/overlay` endpoint) rather than requiring the frontend to stitch together
  multiple calls per image, since the detail view is the most latency-sensitive screen for
  reviewers doing rapid image-by-image triage.
- All mutating endpoints require authentication and are subject to RBAC (§16) and are recorded in
  `AuditLog` (§17).

---

## 12. Storage Strategy

### 12.1 Raw upload artifacts
- Original ZIP files stored in object storage under a key namespace like
  `raw-uploads/{project_id}/{upload_id}/source.zip`, retained per policy (§12.5) for audit/
  re-processing.

### 12.2 Extracted images
- Stored under `images/{project_id}/{content_hash[0:2]}/{content_hash}.{ext}` — content-addressed
  path, independent of which student/upload it came from.
- `Image.storage_ref` in the DB points to this content-addressed path; multiple `Image` rows
  (different students, different uploads) can point at the **same** underlying blob.

### 12.3 Deduplication
- On ingesting any image file, compute a content hash (e.g. SHA-256) before writing to object
  storage. If a blob with that hash already exists, skip the upload and simply reference it —
  this directly satisfies "avoid duplicate image storage," which matters a lot here since the
  observed data pattern is literally the *same source photo* re-appearing under every student's
  task (just under different or suffixed filenames per §5.3). At production scale (many students ×
  same source image set), this dedup step can be the difference between storing N× the image data
  and storing it once.

### 12.4 XML artifacts
- The parsed `annotations.xml` is retained (compressed) alongside the ZIP for the same audit/
  re-processing reasons — re-running ingestion after a parser bugfix should be possible without
  asking the supervisor to re-upload.

### 12.5 Retention & cleanup
- Given the daily-upload / "always browsable history" requirement, the default policy is **keep
  everything indefinitely** — raw ZIPs, images, and XML archives are not auto-deleted. See §22.5
  for how this is enforced under the chosen single-VM/disk deployment.
- The only thing the scheduled `cleanup_retention` job removes is genuinely orphaned temp artifacts
  from failed/aborted uploads (§14.3) — never a completed upload's data.
- If disk space eventually becomes a real constraint, an explicit archive-and-compress step for old
  raw ZIPs (not images/annotations, which stay live for the dashboard) can be added later — this is
  a future option, not part of the default v1 behavior.

### 12.6 Image retrieval
- Given the deployment choice in §22 (single VM, disk storage, no object storage service), image
  bytes are served directly from `/data/images/` — either by the API behind an authenticated route,
  or via an nginx `location` alias for faster static serving — rather than via signed object-storage
  URLs. See §22.2 and §22.6 for the concrete path layout and serving approach.

---

## 13. Scalability & Large-Dataset Handling

This section consolidates the scale requirements referenced throughout the document into one
place, as explicit design rules.

### 13.1 Chunked upload
- Large ZIPs are uploaded in chunks (e.g. 5–10MB each) from the client, reassembled server-side (or
  directly via object-storage multipart upload) — never a single unbounded HTTP request body for a
  multi-GB file.

### 13.2 Streaming ZIP extraction
- Use a streaming ZIP reader that iterates entries without extracting the entire archive to disk/
  memory up front. Enforce a max total extracted size and max per-file size as guardrails against
  zip-bomb-style failure modes.

### 13.3 Incremental XML parsing
- Use an event-driven/incremental parser (SAX-style `iterparse`), processing `<image>` elements as
  a stream and discarding each element from memory once processed, rather than building a full DOM
  tree of a file that could contain hundreds of thousands of elements.

### 13.4 Batch database writes
- Parsed images/shapes/attributes are written in batches (e.g. 500 rows per `INSERT`), not one row
  per element — reduces round-trips and transaction overhead dramatically at scale.

### 13.5 Indexing & query design
- All hot-path queries (image matching, results filtering) are backed by explicit indexes (§10.1);
  no comparison-time full table scans.

### 13.6 Parallel processing
- Ingestion: image-storage and XML-parsing sub-jobs run concurrently (independent of each other).
- Comparison: fanned out per-student (§8.3), so total wall-clock time for a run scales with
  `students / worker_count`, not `students` serially.
- Worker pool size is independently horizontally scalable from the API tier (standard queue-worker
  architecture) — more workers can be added under load without touching API capacity.

### 13.7 Pagination & lazy loading
- No endpoint returns unbounded result sets (§11.9). The frontend results table, image lists, and
  dashboards all use server-side pagination and only fetch what's currently visible/needed.

### 13.8 Caching
- Read-heavy, rarely-changing data (label schemas, project config, completed `ComparisonRun`
  summaries) are cacheable (e.g. Redis) with explicit invalidation on config changes or new runs —
  reduces repeated DB load for dashboard views that many reviewers may open concurrently.

### 13.9 Resource limits & backpressure
- Per-job memory/time limits are enforced by the worker framework (e.g. Celery task time limits) so
  one pathological input (e.g. a corrupt or adversarially large file) can't exhaust a worker
  indefinitely.
- Queue depth is monitored; if ingestion backlog grows beyond a threshold, new upload acceptance
  can be rate-limited or queued with clear "position in queue" feedback to the supervisor rather
  than silently degrading.

### 13.10 Multi-project fairness
- As stated in §8.4, queue routing/priority ensures one large project's processing does not starve
  others. This should be validated with a load test scenario: one project with 100k images ingesting
  concurrently with a second, smaller project — the smaller project's jobs must still complete in
  reasonable time.

### 13.11 GPU/CPU considerations
- All comparison math described in this spec (IoU, edit distance) is CPU-bound and lightweight per
  shape; **no GPU is required** for v1. If a future version adds ML-assisted comparison (e.g.
  perceptual image matching instead of filename-based image matching, or learned OCR-similarity
  scoring beyond edit distance), that would introduce GPU-worthy workloads and should be isolated
  into its own worker pool/queue so it doesn't compete with the lightweight CPU jobs described here.

### 13.12 Behavior at specific scale points (illustrative)

| Scale | Expectation |
|---|---|
| 15 students, ~150 images (observed sample) | Ingestion + comparison complete in well under a minute; single worker sufficient. |
| 50–100 students, ~5,000–20,000 images | Batch parsing/writing (§8.2/13.4) and per-student parallel comparison (§8.3) keep total run time roughly proportional to `images / worker_count` rather than degrading superlinearly; dashboard pagination (§13.7) keeps the UI responsive regardless of totals. |
| 100+ students, 100,000+ images | Streaming ingestion (§13.2–13.3) keeps memory flat regardless of file size; DB indexing (§10.1) and partitioning readiness (§10.2) keep query latency stable; multi-project fairness (§13.10) ensures this project doesn't block others running concurrently. |

---

## 14. Failure Recovery & Resumability

### 14.1 Job-level retry
- Every job type (§8.1) is retried automatically on transient failure (e.g. object storage timeout,
  DB connection blip) with exponential backoff, up to a configured `max_attempts` (default e.g. 3).
- After exhausting retries, the job is marked `failed` on the relevant entity (`Upload` or
  `ComparisonRun`), with the error captured in `JobRun.error_message`, and surfaced to the
  supervisor in the UI — not silently swallowed.

### 14.2 Idempotent processing (resumability)
- Ingestion batches (§8.2) are checkpointed: each `parse_xml_batch`/`store_image_batch` records
  which offset/range it covered. If `ingest_upload` is retried (whether due to failure or an
  explicit "reprocess" action), already-completed batches are skipped rather than reprocessed,
  using the `(project_id, cvat_task_id)` and content-hash uniqueness constraints (§10) as the
  idempotency guarantee — re-running ingestion twice on the same upload must not create duplicate
  Students, Images, or Shapes.
- Comparison sub-jobs (§8.3) are similarly safe to re-run per student without duplicating
  `ComparisonResult` rows (upsert on `(run_id, student_id, student_image_id)`).

### 14.3 Partial failure isolation
- A failure in one student's comparison sub-job, or one malformed `<image>` element during parsing,
  must not fail the entire upload/run. The overall entity status becomes `partially_failed` (not
  `failed`) when some sub-units succeeded and others didn't, and the UI must clearly show which
  specific students/images failed and why, so the supervisor can retry just those rather than the
  whole job.

### 14.4 Stalled-job detection
- `last_heartbeat_at` on `Upload`/`ComparisonRun` (and `JobRun`) is updated periodically by the
  active worker. A scheduled monitor job flags any entity whose heartbeat is stale beyond a
  threshold (e.g. worker crashed mid-job without a clean failure) as `failed`, making it eligible
  for retry rather than remaining stuck in `processing` indefinitely.

### 14.5 Data consistency on failure
- All DB writes within a single batch happen in a transaction; a batch either fully commits or
  fully rolls back — never a half-written batch of Images/Shapes.
- Object storage writes (images, ZIPs) are content-addressed (§12.2), so a retried write of the
  same content is naturally idempotent (same hash → same key → overwrite-or-skip, no duplicate
  blobs).

### 14.6 Manual reprocessing
- A supervisor/admin can trigger a manual "reprocess" on a failed or partially-failed `Upload` or
  `ComparisonRun` from the UI, which re-enqueues only the failed sub-units where possible (per
  §14.3), not the entire job, to avoid redundant work on large uploads.

---

## 15. Error Handling & Validation

### 15.1 Upload-time validation (synchronous, fast-fail)
- File is a valid ZIP archive.
- ZIP contains at least one recognizable annotation XML file (§6.3.5).
- ZIP total size and per-file size are within configured limits.
- If the project has an established label schema from a prior upload, the new upload's label set is
  checked for compatibility (same or superset of expected labels) — a gross mismatch (e.g.
  ML-Model-shaped data uploaded to the Car-Parts project) is rejected immediately with a clear
  message, rather than producing a nonsensical comparison run later (§9.7 last row).

### 15.2 Parse-time validation (asynchronous, non-fatal where possible)
- Missing/malformed `task_id` on an `<image>` → `ParseWarning(severity=error)`, image skipped
  (cannot attribute it to a student, so it cannot be safely processed), job continues.
- Unknown label not present in the project's label schema → `ParseWarning(severity=warning)`,
  shape still stored (for audit) but excluded from comparison until a supervisor resolves the
  schema mismatch (e.g. approves a label-schema update).
- Shape with incomplete geometry (e.g. a `<box>` missing `ybr`) → `ParseWarning(severity=error)`,
  shape skipped.
- Duplicate `task_id` across two `<task>` entries in the same upload's meta → `ParseWarning
  (severity=error)`, ingestion halts for that upload pending manual review (this indicates a
  corrupted or unexpected export, not a case to guess through).

### 15.3 Geometry validation
- Polygons are checked for validity (non-self-intersecting, minimum 3 distinct points) before being
  used in IoU computation; invalid geometry is flagged `geometry_invalid=true` on the `Shape` row
  and excluded from automated scoring, rolled up as `Needs Manual Review` (§9.7).
- Boxes are checked for `xtl < xbr` and `ytl < ybr`; a degenerate/zero-area box is flagged the same
  way.

### 15.4 Comparison-time validation
- If a `ReferenceSet` has zero usable images (e.g. an uploaded GT that failed to parse any images),
  the `run_comparison` job fails fast with a clear error rather than producing a run full of
  meaningless "Missing" verdicts.
- If a student's upload contains zero images (e.g. empty task), that student's summary is clearly
  marked "no submission" rather than blended into aggregate stats as if they scored zero.

### 15.5 User-facing error surfacing
- Every validation failure (upload-time, parse-time, comparison-time) is surfaced in the UI with:
  what failed, why, which entity (image/student/shape) it relates to, and — where applicable — a
  suggested next action (e.g. "update label schema," "re-upload with corrected task assignment").
- Raw stack traces/internal error details are never shown to end users; they are captured in
  `JobRun.error_message` / server logs for engineering triage (§17).

---

## 16. Security & Access Control

### 16.1 Roles (RBAC)

| Role | Permissions |
|---|---|
| **Admin** | Full access: manage projects, users, retention policy, reprocess failed jobs, view audit logs. |
| **Supervisor/Reviewer** | Create uploads, select/promote GT, trigger comparison runs, review results, leave feedback, mark rework — the primary persona described in the original requirements (two reviewers). |
| **Viewer** (optional, e.g. for stakeholders) | Read-only access to dashboards/reports, no ability to trigger jobs or write feedback. |
| **Student/Annotator** (future scope) | Not in v1 UI scope per NG4, but the data model does not preclude adding a restricted "view my own results" role later. |

### 16.2 Authentication
- Standard session/token-based auth (e.g. JWT or session cookies via the existing organizational
  identity provider if one exists — SSO integration is an open question, §21).

### 16.3 Authorization enforcement
- Every API endpoint checks the caller's role against the required permission for that action;
  enforcement lives server-side (never trust client-side role checks alone).
- Project-level scoping: a Supervisor can be scoped to specific projects if the organization runs
  many concurrent projects and access should be limited accordingly (configurable; not required if
  all reviewers see all projects).

### 16.4 Data protection
- Image routes (§12.6) require an authenticated session, same as any other API endpoint — no
  publicly guessable/unauthenticated file paths, even though files live on local VM disk rather
  than object storage.
- PII exposure is limited: student `email`/`username` fields are visible to Supervisor/Admin roles
  only, not to any future Viewer/public-facing surface.

### 16.5 Upload safety
- ZIP extraction guards against zip-bomb and path-traversal attacks (validate extracted entry paths
  stay within the intended extraction namespace; enforce size caps per §13.2).
- Uploaded files are scanned/validated for expected structure before any processing begins (§15.1).

---

## 17. Logging & Auditability

- **`AuditLog`** (§10) captures every meaningful state-changing action: upload created, GT/reference
  selected, comparison run triggered, review status changed, feedback added, label schema modified,
  retention/cleanup deletions, manual reprocessing triggered — who did it, when, and what changed.
- **`ParseWarning`** provides a durable, queryable record of every ingestion-time data-quality issue
  (§15.2), so a supervisor can review "everything that went wrong with this upload" after the fact,
  not just at the moment of upload.
- **`JobRun`** provides operational/engineering-facing logs of background job execution (attempts,
  timing, errors) — separate from the user-facing `AuditLog`, since these serve different audiences
  (engineers debugging vs. supervisors auditing review activity).
- Structured application logs (e.g. JSON logs to stdout, collected by whatever log aggregation the
  deployment environment uses) for all services, correlated by `upload_id`/`run_id`/`request_id` so
  a single upload's full processing trail can be reconstructed across ingestion and comparison
  workers.
- Audit data is retained independently of the retention policy applied to raw artifacts (§12.5) —
  audit history should outlive the underlying ZIP/image cleanup, since "who reviewed what and when"
  remains relevant long after the source files are archived/deleted.

---

## 18. Dashboard & Reporting Requirements

### 18.1 Project-level dashboard
- Summary cards: total students, total images, % Exact Match / Minor / Significant / Missing /
  Extra / Needs Manual Review across the latest run.
- Trend chart: aggregate quality score over time across multiple `ComparisonRun`s (useful once
  students resubmit after rework).

### 18.2 Results table (per run)
- Columns: Student, Image, Verdict, Score, Review Status — matching the example table in the
  original requirements, extended with score and review status.
- Server-side filter by student, verdict, score range, label; server-side sort by any column;
  paginated (§13.7).
- Bulk-select + bulk-status-update (FR-9.3).

### 18.3 Student summary view
- Per-student: image counts by verdict, most frequent error labels (e.g. "this student most often
  gets `Rear Door` vs `Rear Quarter Panel` boundaries wrong"), score trend across their upload
  history.

### 18.4 Label-level error report
- Per-label aggregate error rate across all students in a run (e.g. "`Number Plate` OCR mismatches
  occur in 18% of images"), helping identify whether a *label* is systematically hard/ambiguous
  rather than any one student being at fault — directly supports the "don't blindly assume the
  student is wrong" principle (§9.1) at the aggregate level too.

### 18.5 Reviewer activity report
- Derived from `AuditLog`: feedback given, images reviewed, rework flagged, per reviewer per time
  period — supports workload visibility across the two (or more) reviewers.

### 18.6 Export
- Results table and summary reports are exportable as CSV/JSON for offline use or integration with
  other tools, per FR-10.4.

---

## 19. Supervisor Review & Rework Workflow (detailed)

```
 ComparisonRun completes
        │
        ▼
 Results table populated, default sorted worst-first (lowest score / most severe verdicts)
        │
        ▼
 Reviewer opens a flagged image (Significant Difference / Missing / Extra / Needs Manual Review)
        │
        ▼
 Image detail view: reference + student overlay, per-shape diff list with verdicts
        │
        ├─── Reviewer determines the flag was a false positive (e.g. reference itself was wrong,
        │    or an acceptable stylistic variation) → mark review_status = "approved", optionally
        │    leave a note explaining why (feeds back into future threshold calibration, §21.2)
        │
        └─── Reviewer confirms a real error → mark review_status = "needs_rework", leave feedback
             note describing what to fix
        │
        ▼
 Rework-flagged items are visible in a dedicated "Needs Rework" filtered view, exportable per
 FR-10.4, communicated to the student through the existing channel
        │
        ▼
 Student resubmits (new Upload) → new ComparisonRun → new ComparisonResult rows, optionally linked
 to the original result being resolved (FR-10.3) so before/after is visible
        │
        ▼
 Reviewer checks the resolved image; if fixed, marks "resolved"; if not, repeats the rework cycle
```

- **Minor Difference** and **Exact Match** items do not require reviewer action by default — the
  whole point of automated triage is that reviewers spend their time on the flagged categories, not
  re-confirming things the system already classified confidently. The dashboard should default to
  hiding/collapsing these, with an explicit toggle to inspect them if a reviewer wants to spot-check.
- **Needs Manual Review** items are explicitly reviewer-required — the system has deliberately
  declined to auto-classify these (§9.1, §9.6), so they should never be silently treated as "fine."

---

## 20. Acceptance Criteria

The system is considered to meet this specification when all of the following hold:

**Ingestion**
- AC-1: Uploading a CVAT project-export ZIP with N students automatically produces N `Student`
  records with zero manual file separation, correctly attributed via `task_id` (FR-4.1–4.2).
- AC-2: Ingesting the same ZIP twice does not create duplicate students, images, or shapes
  (idempotency, §14.2).
- AC-3: A ZIP with a corrupt/unparseable image element fails only that element (logged as a
  `ParseWarning`), not the whole ingestion job (§15.2).
- AC-4: A 100,000-image XML can be ingested without the ingestion worker's memory usage growing
  unbounded with input size (§13.3).

**GT/Reference**
- AC-5: A Car-Parts-style project can have an official GT uploaded and used as reference without
  requiring any student's work to be selected (§6.5, FR-5.1).
- AC-6: An ML-Model-style project can have any existing student promoted as reference without a
  re-upload (§6.5, FR-5.2).
- AC-7: Two different `ComparisonRun`s against two different promoted students both remain
  independently viewable in history (§6.5, FR-5.5).

**Comparison**
- AC-8: A student's box-based submission (ML-Model) and a student's polygon-based submission
  (Car-Parts) are both correctly compared using their respective geometry-appropriate IoU logic
  (§9.4).
- AC-9: An image with multiple instances of the same label (e.g. two `Grille` polygons, two
  `vehicle` boxes) produces correct one-to-one matching, not a many-to-many or first-match-wins
  result (§9.4).
- AC-10: A `licence_plate`/`vehicle` pair linked by `vehicle_id` is compared against the correct
  corresponding pair in a multi-vehicle image, not cross-matched to an unrelated vehicle (§9.3).
- AC-11: An OCR (`plate_text`) off-by-one-character mismatch is classified as Minor Difference, not
  Significant Difference, under default thresholds (§9.5).
- AC-12: An image where the reference is tagged `Unreadable_Plate` does not produce a Significant
  Difference verdict purely from an OCR mismatch on that image (§9.7).
- AC-13: All comparison thresholds (IoU cutoffs, OCR edit-distance) are changeable via project
  configuration without a code change (FR-6.3).

**Scale & resilience**
- AC-14: A comparison run across 100+ students completes with per-student sub-jobs processed in
  parallel, not serially (§8.3, §13.6).
- AC-15: Killing a worker mid-job results in that job being detected as stalled and retried, not
  stuck indefinitely (§14.4).
- AC-16: A large project's ingestion/comparison jobs running concurrently with a second, smaller
  project's jobs do not prevent the smaller project's jobs from completing in reasonable time
  (§13.10).
- AC-17: The same source image appearing under 15+ different students' submissions is stored once
  in object storage, not 15+ times (§12.3).

**Review & UI**
- AC-18: The results table can filter and sort by verdict/score/student against at least 50,000
  `ComparisonResult` rows within acceptable UI response time, without loading the full result set
  client-side (§13.7, §18.2).
- AC-19: The image detail view renders reference and student overlays from a single API call
  (§11.6), not a cascade of per-shape requests.
- AC-20: A reviewer can mark rework, leave feedback, and see that status reflected immediately in
  the results table (FR-9.1–9.2, FR-10.1–10.2).

**Auditability**
- AC-21: Every review-status change and feedback note is attributed to a specific reviewer with a
  timestamp, queryable via `AuditLog` (§17).
- AC-22: A supervisor can reconstruct, after the fact, exactly what warnings/errors occurred during
  a given upload's ingestion (§15.2, §17).

---

## 21. Open Questions & Assumptions

These should be resolved before/during implementation; each carries a working default assumption so
development is not blocked, but confirmation is needed.

1. **Do image pixels ship inside the ZIP, or only the XML?** Both sample exports contained only
   `annotations.xml`, no `images/` folder. *Working assumption:* a separate image source (CVAT API
   pull by task ID, or a parallel image upload) will be needed for the visualization feature
   (§6.8) unless the production export pipeline includes "save images." **Needs confirmation.**
2. **IoU / OCR thresholds** — defaults proposed in §9.5/§9.6 are starting points, not calibrated
   against real reviewed examples yet. *Assumption:* thresholds will be tuned iteratively once
   real comparison runs are reviewed by the two supervisors; the config-driven design (FR-6.3)
   supports this without code changes.
3. **Label spelling/synonym consistency** — do students ever produce near-miss label names (typos,
   abbreviations)? *Assumption:* label matching is exact against the project's `LabelSchema`;
   unknown labels are flagged (§15.2) rather than fuzzy-matched, to avoid silently merging
   genuinely different labels. **Needs confirmation** whether a synonym/alias table is actually
   needed.
4. **Multiple reviewers — shared or separate feedback threads?** *Assumption:* a single shared
   `Feedback` log per `ComparisonResult`/`ShapeDiff`, visible to all reviewers (matches the "two
   reviewers" framing in the original requirements as collaborative, not siloed). **Needs
   confirmation.**
5. **SSO/identity provider** — is there an existing auth system (e.g. Google Workspace, Okta) this
   should integrate with, or is standalone auth acceptable for v1? *Assumption:* standalone auth
   for v1, SSO integration deferred. **Needs confirmation.**
6. **Format for pushing rework feedback to students** — is CVAT itself the right place to surface
   rework requests (e.g. via task comments/CVAT API), or is export + manual communication
   sufficient for v1? *Assumption:* export-only for v1 (FR-10.4), per NG-scoped decision; direct
   CVAT integration noted as a natural v2 candidate.
7. **Retention durations** — no specific numbers were given for how long raw ZIPs/images should be
   kept. *Assumption:* defaults proposed in §12.5 (e.g. 90 days for raw ZIPs), configurable.
   **Needs confirmation** of actual organizational policy.
8. **Project-level access scoping** — do all reviewers need visibility into all projects, or should
   access be scoped per project as more projects are added? *Assumption:* open visibility across
   projects for v1 given only two projects and two reviewers exist today; RBAC model (§16) supports
   adding scoping later without a redesign.
9. **What counts as "the same student" across projects?** If the same person annotates in both
   ML-Model and Car-Parts, should they be treated as one identity across projects for reporting?
   *Assumption:* `Student` is scoped per-project (matches the current data, where identity comes
   from `task_id` which is project-specific); cross-project identity linking (e.g. by email) is a
   possible future enhancement, not required for v1.

---

## 22. Deployment — Self-Contained Single VM

Everything runs on **one Azure VM**, as Docker containers, nothing external. No Blob Storage, no
Key Vault, no ACR, no managed Postgres beyond what's already decided. This section replaces the
earlier multi-service Azure discussion with the simplified approach actually chosen.

### 22.1 What runs on the VM

```
Azure VM (Ubuntu), Docker Compose
├── nginx / caddy       — reverse proxy, HTTPS termination
├── backend-api          — FastAPI/Node service (§7.1)
├── worker (x1-2)         — ingestion + comparison background jobs (§8)
├── redis                  — job queue broker for Celery/RQ
└── postgres                — database (containerized; see §22.3)
```

One `docker-compose.yml` defines all services. One `.env` file (not committed to git) holds every
secret/config value: `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, any signing keys for image
URLs, upload size limits, etc. Compose reads `.env` automatically and injects values into each
container — no external secrets service required.

### 22.2 File storage — VM disk

- Attach a **Managed Disk** to the VM sized for expected growth (start generously — image data is
  the bulk of the volume; resize the disk later if needed, standard Azure VM operation).
- Mount it at a fixed path, e.g. `/data`, and bind-mount into the relevant containers:
  ```
  /data/raw-zips/{project_id}/{upload_id}/source.zip
  /data/images/{content_hash[0:2]}/{content_hash}.{ext}     -- content-addressed, dedup per §12.3
  /data/xml-archive/{project_id}/{upload_id}/annotations.xml.gz
  ```
- `Image.storage_ref` in the DB stores this relative path; the backend serves image bytes to the
  frontend directly from disk (via the API or nginx `location /images/ { alias /data/images/; }`
  for a fast static-file path — either works at this scale).
- **This `/data/images/` path is where you manually upload images** (per your stated workflow),
  using the same content-hash naming so ingestion/comparison find them without extra mapping.

### 22.3 Database — containerized Postgres

- `postgres` runs as a container in the same Compose file, with its data directory on a **separate
  bind-mounted volume** (e.g. `/data/postgres`) so a container restart/rebuild never touches the
  actual data.
- **Backups are now your responsibility** (this is the real trade-off vs. a managed DB): add a
  small scheduled job — either a cron entry on the VM host or a lightweight `backup` container
  running `pg_dump` on a timer — writing dated dumps to `/data/backups/`. Since everything is on
  one disk, also consider periodic **Azure Disk snapshots** of the whole VM disk as a second,
  coarser safety net (a few clicks in the Azure portal, no extra service to run).
- If you'd rather keep using your existing separately-hosted Azure database instead of
  containerizing Postgres, that's a one-line change — just point `DATABASE_URL` in `.env` at it
  and drop the `postgres` service from Compose. Either works with the rest of this spec unchanged.

### 22.4 Deploy / redeploy flow

```
1. git pull (or scp code) onto the VM
2. docker compose build
3. docker compose up -d
```
Rollback: `git checkout <previous commit>` → rebuild → `up -d`. No registry, no CI pipeline
required to get started — can be added later without changing the application itself.

### 22.5 Daily upload / history requirement

- Since uploads happen daily and supervisors need to browse **all previous results**, nothing here
  auto-deletes. The retention/cleanup job from §12.5 and §8.1 should default to **keep everything**
  on this VM's disk — only remove clearly-failed/orphaned temp files from aborted uploads (§14
  cleanup case), never a completed upload's data. Disk usage should just be monitored (simple `df`
  check/alert) so the Managed Disk can be resized proactively before it fills, rather than deleting
  history to make room.
- Every `Upload` and `ComparisonRun` stays queryable indefinitely via the existing paginated APIs
  (§11.2, §11.5) — "go back and see previous results" is already satisfied by the data model in
  §10, this section just confirms nothing in the deployment plan deletes that data by default.

### 22.6 GT vs. student visualization — confirmed against this deployment

No change to §6.8/§11.6 — the overlay viewer reads vector shape data from Postgres and image bytes
from `/data/images/` (served by nginx or the API). Since everything is local to one VM, there's no
signed-URL/expiry complexity to worry about (that was only needed for Blob Storage); a simple
authenticated route serving the file is sufficient.

### 22.7 What was deliberately left out (and why it's fine at this scale)

| Not used | Why it's okay to skip for now |
|---|---|
| Azure Blob Storage | VM disk is simpler and sufficient for manually-uploaded images at current volume; revisit if disk growth becomes hard to manage or redundancy becomes a hard requirement. |
| Azure Key Vault | `.env` on the VM is adequate given a single small operating team; revisit if more people/services need scoped access to secrets. |
| Azure Container Registry | Building directly on the VM avoids extra infra; revisit once multiple environments (staging/prod) or CI/CD make a registry worth the overhead. |
| Managed Azure Database (if containerizing Postgres) | Self-managed backups are more manual, but keeps everything on one box as requested; revisit if data-loss risk tolerance is low or the team wants to stop owning backup ops. |
| VM Scale Sets / Kubernetes | Not needed until traffic/processing load genuinely requires horizontal scaling beyond one VM's capacity — the worker pool can already scale by adding more `worker` containers to the same Compose file first. |

---

## 23. Appendix

### 23.1 Example results table (illustrative, matches original requirement's example)

| Student | Image | Verdict | Score | Review Status |
|---|---|---|---|---|
| Student B | image_001 | Exact Match | 98 | — |
| Student B | image_002 | Significant Difference | 61 | open |
| Student B | image_003 | Missing | 0 | needs_rework |
| Student C | image_001 | Minor Difference | 87 | approved |
| Student C | image_004 | Needs Manual Review | — | in_review |

### 23.2 Example ShapeDiff payload (illustrative, not a code spec)

```json
{
  "reference_shape_id": "shp_ref_001",
  "student_shape_id": "shp_stu_014",
  "label": "licence_plate",
  "verdict": "minor_difference",
  "iou_score": 0.83,
  "attribute_diffs": [
    {
      "name": "plate_text",
      "ref_value": "AD22767",
      "student_value": "AD22787",
      "edit_distance": 1,
      "verdict": "minor_difference"
    }
  ]
}
```

### 23.3 Real label examples observed (for schema-seeding reference)

- **Car-Parts labels:** Front Bumper, Rear Bumper, Trunk Lid, Bonnet, Front Fender, Front Door,
  Rear Door, Rear Quarter Panel, Wheel, Wheel Cap, Headlamp, Taillight, Grille, ORVM, ...
  (attribute: `Position` — Front, Rear, Left, Right, Front-Left, Front-Right, Rear-Left,
  Rear-Right, Left Side, ...)
- **ML-Model labels:** `vehicle` (attributes: `vehicle_type`, `vehicle_id`), `licence_plate`
  (attributes: `plate_text`, `vehicle_id`), `painted_plate_number` (attributes: `plate_text`,
  `vehicle_id`); frame-level tags: `Mirror-Image`, `Rotated`, `No Plates`, `Unreadable_Plate`.

### 23.4 Glossary cross-reference
See §3 for full terminology table.

---

*End of specification.*
