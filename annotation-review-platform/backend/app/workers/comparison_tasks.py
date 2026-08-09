"""
Comparison Celery tasks — §8.3.
run_comparison    — fans out per-student sub-jobs
compare_student   — one student's full image set vs. reference
cleanup_stalled   — heartbeat-based stalled job detection §14.4
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from celery import chord, group
from sqlalchemy import select, update

from app.config import settings
from app.models.comparison import ComparisonRun, ReferenceSet, RunStatus
from app.models.student import Student
from app.models.upload import Upload
from app.services.comparison_service import (
    build_project_config,
    compare_student,
    resolve_reference_images,
)
from app.workers.celery_app import celery_app
from app.models.project import Project

logger = structlog.get_logger(__name__)


def _sync_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(settings.database_sync_url, pool_pre_ping=True)
    return sessionmaker(bind=engine)()


@celery_app.task(bind=True, max_retries=settings.job_max_attempts, queue="comparison")
def run_comparison(self, run_id: str) -> None:
    """
    Main comparison task — §8.3.
    1. Resolve ReferenceSet → normalized-key index.
    2. Fan out one compare_student_task per student in parallel.
    3. Mark run complete when all sub-jobs finish.
    """
    db = _sync_db()
    try:
        run = db.execute(select(ComparisonRun).where(ComparisonRun.id == run_id)).scalar_one_or_none()
        if run is None:
            logger.error("run_comparison.not_found", run_id=run_id)
            return

        run.status = RunStatus.processing
        run.started_at = datetime.now(timezone.utc)
        run.last_heartbeat_at = datetime.now(timezone.utc)
        db.commit()

        ref_set = db.execute(
            select(ReferenceSet).where(ReferenceSet.id == run.reference_set_id)
        ).scalar_one()

        project = db.execute(
            select(Project).where(Project.id == run.project_id)
        ).scalar_one()

        # Build normalized-key → ref_image_id index — §9.2
        ref_image_index = resolve_reference_images(db, ref_set, run.project_id)

        if not ref_image_index:
            run.status = RunStatus.failed
            db.commit()
            logger.error("run_comparison.empty_reference", run_id=run_id)
            return

        # Get all students in this upload
        upload = db.execute(select(Upload).where(Upload.id == run.upload_id)).scalar_one()
        students_stmt = select(Student).where(Student.project_id == run.project_id)
        students = db.execute(students_stmt).scalars().all()

        # Filter to students who have images in this upload (skip reference student if promoted)
        from app.models.image import Image
        student_ids_with_images_stmt = (
            select(Image.student_id).distinct()
            .where(Image.upload_id == run.upload_id)
        )
        valid_student_ids = {
            row[0] for row in db.execute(student_ids_with_images_stmt).all()
        }
        students_to_compare = [
            s for s in students
            if s.id in valid_student_ids
            and s.id != ref_set.reference_student_id
        ]

        run.total_count = len(students_to_compare)
        db.commit()

        # Fan out per-student sub-jobs — §8.3.3
        for student in students_to_compare:
            compare_student_task.apply_async(
                args=[run_id, str(student.id)],
                queue="comparison",
            )

        # Note: run is marked complete by a separate finalise task or by polling.
        # For simplicity in this implementation we check completion inline after
        # launching all tasks. In production, use a Celery chord callback.
        logger.info("run_comparison.fanned_out", run_id=run_id,
                    student_count=len(students_to_compare))

    except Exception as exc:
        logger.exception("run_comparison.error", run_id=run_id)
        try:
            run.status = RunStatus.failed
            db.commit()
        except Exception:
            pass
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery_app.task(bind=True, max_retries=settings.job_max_attempts, queue="comparison")
def compare_student_task(self, run_id: str, student_id: str) -> None:
    """
    Per-student comparison sub-job — §8.3.4.
    Safe to retry: ComparisonResult rows are upserted, not duplicated.
    """
    db = _sync_db()
    try:
        run = db.execute(select(ComparisonRun).where(ComparisonRun.id == run_id)).scalar_one()
        student = db.execute(select(Student).where(Student.id == student_id)).scalar_one()
        project = db.execute(select(Project).where(Project.id == run.project_id)).scalar_one()

        ref_set = db.execute(
            select(ReferenceSet).where(ReferenceSet.id == run.reference_set_id)
        ).scalar_one()

        ref_image_index = resolve_reference_images(db, ref_set, run.project_id)
        config = build_project_config(db, project)

        compare_student(db, run, student, ref_image_index, config)

        # Increment progress counter — §8.5
        run.processed_count = (run.processed_count or 0) + 1
        run.last_heartbeat_at = datetime.now(timezone.utc)
        if run.total_count > 0:
            run.progress_pct = min(99.0, run.processed_count / run.total_count * 100)
        db.commit()

        # Check if all students done → mark complete
        _maybe_complete_run(db, run)

        logger.info("compare_student_task.done", run_id=run_id, student_id=student_id)

    except Exception as exc:
        logger.exception("compare_student_task.error", run_id=run_id, student_id=student_id)
        # Mark student as partially_failed on the run — §14.3
        try:
            run = db.execute(select(ComparisonRun).where(ComparisonRun.id == run_id)).scalar_one()
            run.status = RunStatus.partially_failed
            db.commit()
        except Exception:
            pass
        raise self.retry(exc=exc)
    finally:
        db.close()


def _maybe_complete_run(db, run: ComparisonRun) -> None:
    """Mark run complete when all student sub-jobs have finished."""
    if run.processed_count >= run.total_count and run.status == RunStatus.processing:
        run.status = RunStatus.complete
        run.progress_pct = 100.0
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("run.complete", run_id=str(run.id))


@celery_app.task(queue="cleanup")
def cleanup_stalled_jobs() -> None:
    """
    Heartbeat-based stalled-job detection — §14.4.
    Flags Upload/ComparisonRun rows stuck in 'processing' with a stale heartbeat.
    """
    db = _sync_db()
    threshold = datetime.now(timezone.utc) - timedelta(seconds=settings.job_heartbeat_timeout_seconds)

    try:
        from app.models.upload import UploadStatus
        stalled_uploads = db.execute(
            select(Upload).where(
                Upload.status == UploadStatus.processing,
                Upload.last_heartbeat_at < threshold,
            )
        ).scalars().all()
        for u in stalled_uploads:
            u.status = UploadStatus.failed
            logger.warning("stalled_upload_detected", upload_id=str(u.id))

        stalled_runs = db.execute(
            select(ComparisonRun).where(
                ComparisonRun.status == RunStatus.processing,
                ComparisonRun.last_heartbeat_at < threshold,
            )
        ).scalars().all()
        for r in stalled_runs:
            r.status = RunStatus.failed
            logger.warning("stalled_run_detected", run_id=str(r.id))

        db.commit()
    finally:
        db.close()
