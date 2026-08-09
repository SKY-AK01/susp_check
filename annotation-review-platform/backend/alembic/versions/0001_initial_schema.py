"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-09
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ──────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("admin", "supervisor", "viewer", name="userrole"), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # ── projects ───────────────────────────────────────────────────────────────
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("project_type", sa.String(100), nullable=False),
        sa.Column("gt_mode_default", sa.Enum("uploaded_gt", "student_reference", name="gtmode"), nullable=False),
        sa.Column("box_iou_exact", sa.Float(), nullable=True),
        sa.Column("box_iou_minor", sa.Float(), nullable=True),
        sa.Column("polygon_iou_exact", sa.Float(), nullable=True),
        sa.Column("polygon_iou_minor", sa.Float(), nullable=True),
        sa.Column("ocr_edit_distance_minor", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    # ── label_schemas ──────────────────────────────────────────────────────────
    op.create_table(
        "label_schemas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("version", sa.Integer(), default=1),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # ── labels ─────────────────────────────────────────────────────────────────
    op.create_table(
        "labels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label_schema_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("label_schemas.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("geometry_type", sa.Enum("box", "polygon", name="geometrytype"), nullable=False),
    )
    op.create_index("ix_labels_schema_name", "labels", ["label_schema_id", "name"])

    # ── label_attributes ───────────────────────────────────────────────────────
    op.create_table(
        "label_attributes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("labels.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("value_type", sa.Enum("categorical", "free_text", "linking", name="attributevaluetype"), nullable=False),
        sa.Column("allowed_values", postgresql.JSONB(), nullable=True),
        sa.Column("is_grouping_key", sa.Boolean(), default=False),
    )

    # ── uploads ────────────────────────────────────────────────────────────────
    op.create_table(
        "uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_zip_ref", sa.String(500), nullable=True),
        sa.Column("status", sa.Enum("pending","processing","ingested","failed","partially_failed", name="uploadstatus"), nullable=False),
        sa.Column("progress_pct", sa.Float(), default=0.0),
        sa.Column("processed_count", sa.Integer(), default=0),
        sa.Column("total_count", sa.Integer(), default=0),
        sa.Column("is_reference", sa.Boolean(), default=False),
        sa.Column("chunk_count", sa.Integer(), nullable=True),
        sa.Column("chunks_received", sa.Integer(), default=0),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_uploads_project_status", "uploads", ["project_id", "status"])

    # ── students ───────────────────────────────────────────────────────────────
    op.create_table(
        "students",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("cvat_task_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("task_size", sa.Integer(), nullable=True),
        sa.Column("start_frame", sa.Integer(), nullable=True),
        sa.Column("stop_frame", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_unique_constraint("uq_student_project_task", "students", ["project_id", "cvat_task_id"])
    op.create_index("ix_students_project_id", "students", ["project_id"])

    # ── images ─────────────────────────────────────────────────────────────────
    op.create_table(
        "images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("uploads.id"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("students.id"), nullable=True),
        sa.Column("raw_filename", sa.String(500), nullable=False),
        sa.Column("normalized_key", sa.String(500), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("storage_ref", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_images_project_normalized_key", "images", ["project_id", "normalized_key"])
    op.create_index("ix_images_upload_student", "images", ["upload_id", "student_id"])
    op.create_index("ix_images_content_hash", "images", ["content_hash"])

    # ── shapes ─────────────────────────────────────────────────────────────────
    op.create_table(
        "shapes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=False),
        sa.Column("label_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("labels.id"), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("geometry", postgresql.JSONB(), nullable=False),
        sa.Column("group_value", sa.String(255), nullable=True),
        sa.Column("geometry_invalid", sa.Boolean(), default=False),
        sa.Column("occluded", sa.Boolean(), default=False),
        sa.Column("z_order", sa.Integer(), default=0),
        sa.Column("label_name", sa.String(255), nullable=True),
    )
    op.create_index("ix_shapes_image_id", "shapes", ["image_id"])
    op.create_index("ix_shapes_image_label", "shapes", ["image_id", "label_id"])

    # ── shape_attributes ───────────────────────────────────────────────────────
    op.create_table(
        "shape_attributes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shape_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shapes.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
    )
    op.create_index("ix_shape_attributes_shape_id", "shape_attributes", ["shape_id"])

    # ── tags ───────────────────────────────────────────────────────────────────
    op.create_table(
        "tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
    )
    op.create_index("ix_tags_image_id", "tags", ["image_id"])

    # ── reference_sets ─────────────────────────────────────────────────────────
    op.create_table(
        "reference_sets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("source_type", sa.Enum("uploaded_gt", "student", name="referencesourcetype"), nullable=False),
        sa.Column("reference_upload_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("uploads.id"), nullable=True),
        sa.Column("reference_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("students.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # ── comparison_runs ────────────────────────────────────────────────────────
    op.create_table(
        "comparison_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("reference_set_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reference_sets.id"), nullable=False),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("uploads.id"), nullable=False),
        sa.Column("status", sa.Enum("pending","processing","complete","failed","partially_failed", name="runstatus"), nullable=False),
        sa.Column("progress_pct", sa.Float(), default=0.0),
        sa.Column("processed_count", sa.Integer(), default=0),
        sa.Column("total_count", sa.Integer(), default=0),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_runs_project_status", "comparison_runs", ["project_id", "status"])
    op.create_index("ix_runs_upload_id", "comparison_runs", ["upload_id"])

    # ── comparison_results ─────────────────────────────────────────────────────
    op.create_table(
        "comparison_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("comparison_runs.id"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("students.id"), nullable=False),
        sa.Column("student_image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=False),
        sa.Column("reference_image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=True),
        sa.Column("verdict", sa.Enum("exact_match","minor_difference","significant_difference","missing","extra","needs_manual_review", name="verdict"), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("review_status", sa.Enum("open","in_review","needs_rework","approved","resolved", name="reviewstatus"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_unique_constraint("uq_result_run_student_image", "comparison_results", ["run_id", "student_id", "student_image_id"])
    op.create_index("ix_results_run_student", "comparison_results", ["run_id", "student_id"])
    op.create_index("ix_results_run_verdict", "comparison_results", ["run_id", "verdict"])
    op.create_index("ix_results_run_score", "comparison_results", ["run_id", "score"])

    # ── shape_diffs ────────────────────────────────────────────────────────────
    op.create_table(
        "shape_diffs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("comparison_result_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("comparison_results.id"), nullable=False),
        sa.Column("reference_shape_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shapes.id"), nullable=True),
        sa.Column("student_shape_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shapes.id"), nullable=True),
        sa.Column("verdict", sa.Enum("exact_match","minor_difference","significant_difference","missing","extra","needs_manual_review", name="verdict"), nullable=False),
        sa.Column("iou_score", sa.Float(), nullable=True),
        sa.Column("attribute_diffs", postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_shape_diffs_result_id", "shape_diffs", ["comparison_result_id"])

    # ── feedbacks ─────────────────────────────────────────────────────────────
    op.create_table(
        "feedbacks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("comparison_result_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("comparison_results.id"), nullable=True),
        sa.Column("shape_diff_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shape_diffs.id"), nullable=True),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_feedbacks_result_id", "feedbacks", ["comparison_result_id"])

    # ── parse_warnings ────────────────────────────────────────────────────────
    op.create_table(
        "parse_warnings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("uploads.id"), nullable=False),
        sa.Column("image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=True),
        sa.Column("severity", sa.Enum("warning", "error", name="parsewarningseverity"), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_parse_warnings_upload_id", "parse_warnings", ["upload_id"])

    # ── job_runs ──────────────────────────────────────────────────────────────
    op.create_table(
        "job_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_type", sa.String(100), nullable=False),
        sa.Column("related_entity_type", sa.String(100), nullable=False),
        sa.Column("related_entity_id", sa.String(36), nullable=False),
        sa.Column("status", sa.Enum("pending","running","complete","failed","retrying", name="jobstatus"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), default=0),
        sa.Column("max_attempts", sa.Integer(), default=3),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_job_runs_entity", "job_runs", ["related_entity_type", "related_entity_id"])

    # ── audit_logs ────────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(255), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), index=True),
    )
    op.create_index("ix_audit_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_actor_time", "audit_logs", ["actor_id", "created_at"])


def downgrade() -> None:
    for tbl in [
        "audit_logs", "job_runs", "parse_warnings", "feedbacks",
        "shape_diffs", "comparison_results", "comparison_runs", "reference_sets",
        "tags", "shape_attributes", "shapes", "images", "students",
        "uploads", "label_attributes", "labels", "label_schemas", "projects", "users",
    ]:
        op.drop_table(tbl)
    for enum_name in [
        "userrole", "gtmode", "geometrytype", "attributevaluetype", "uploadstatus",
        "referencesourcetype", "runstatus", "verdict", "reviewstatus",
        "parsewarningseverity", "jobstatus",
    ]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
