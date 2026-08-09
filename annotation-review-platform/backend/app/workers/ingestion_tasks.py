"""
Ingestion Celery tasks — §8.2.
ingest_upload  → streams ZIP, locates annotations.xml, runs two-pass parse,
                  batch-writes to DB, stores images to disk with content-hash dedup.
"""
from __future__ import annotations

import os
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

import structlog
from celery import shared_task
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.feedback import JobRun, JobStatus, ParseWarning
from app.models.image import Image
from app.models.project import Label, LabelSchema, Project
from app.models.upload import Upload, UploadStatus
from app.services.ingestion_service import (
    CVATXMLParser,
    archive_xml,
    content_hash_and_store,
    find_annotation_xml_in_zip,
    persist_image_batch,
    persist_meta,
)
from app.workers.celery_app import celery_app

logger = structlog.get_logger(__name__)


def _sync_db():
    """Return a synchronous SQLAlchemy session for use inside Celery tasks."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(settings.database_sync_url, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    return Session()


@celery_app.task(
    bind=True,
    max_retries=settings.job_max_attempts,
    default_retry_delay=30,
    queue="ingestion",
)
def ingest_upload(self, upload_id: str) -> None:
    """
    Main ingestion task — §8.2.
    Steps: stream-extract ZIP → Pass 1 (meta) → Pass 2 (images) → archive XML → done.
    Idempotent: re-running on the same upload_id won't duplicate data.
    Per-element failures are logged as ParseWarning, not task failures.
    """
    db = _sync_db()
    try:
        upload = db.execute(select(Upload).where(Upload.id == upload_id)).scalar_one_or_none()
        if upload is None:
            logger.error("ingest_upload.not_found", upload_id=upload_id)
            return

        _set_upload_status(db, upload, UploadStatus.processing)

        project = db.execute(select(Project).where(Project.id == upload.project_id)).scalar_one()

        zip_path = os.path.join(
            settings.raw_zips_dir, str(upload.project_id), str(upload_id), "source.zip"
        )
        if not os.path.exists(zip_path):
            _fail_upload(db, upload, f"ZIP not found at {zip_path}")
            return

        # Validate ZIP guard — §15.1, §16.5
        try:
            zf = zipfile.ZipFile(zip_path, "r")
        except zipfile.BadZipFile as exc:
            _fail_upload(db, upload, f"Invalid ZIP: {exc}")
            return

        with zf:
            # Guard: total extracted size — §13.2 zip-bomb defence
            total_size = sum(info.file_size for info in zf.infolist())
            if total_size > settings.max_zip_size_bytes:
                _fail_upload(db, upload, f"Extracted size {total_size} exceeds max {settings.max_zip_size_bytes}")
                return

            # Locate annotations.xml — FR-3.5
            xml_entry = find_annotation_xml_in_zip(zf)
            if xml_entry is None:
                _fail_upload(db, upload, "No annotations.xml found in ZIP")
                return

            # Extract XML to temp file for two-pass parsing
            with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp:
                tmp_xml_path = tmp.name
                with zf.open(xml_entry) as src:
                    import shutil
                    shutil.copyfileobj(src, tmp)

            parser = CVATXMLParser()

            # ── Pass 1: meta (tasks + labels) ────────────────────────────────
            try:
                parsed_meta = parser.parse_meta(tmp_xml_path)
            except Exception as exc:
                _fail_upload(db, upload, f"XML meta parse failed: {exc}")
                os.unlink(tmp_xml_path)
                return

            # Build label_name → label_id map from DB (project's latest schema)
            label_name_to_id = _build_label_map(db, upload.project_id)

            # Persist students (idempotent upsert)
            task_to_student = persist_meta(
                db, upload.project_id, uuid.UUID(upload_id), parsed_meta, upload.is_reference
            )

            # ── Pass 2: stream images in batches ─────────────────────────────
            total_images = 0
            all_warnings: list[ParseWarning] = []

            for image_batch in parser.stream_images(tmp_xml_path, settings.ingestion_batch_size):
                warnings = persist_image_batch(
                    db=db,
                    project_id=upload.project_id,
                    upload_id=uuid.UUID(upload_id),
                    task_to_student=task_to_student,
                    label_name_to_id=label_name_to_id,
                    image_batch=image_batch,
                    is_reference=upload.is_reference,
                )
                all_warnings.extend(warnings)
                total_images += len(image_batch)
                _heartbeat(db, upload, processed=total_images)

            # Persist any ParseWarnings
            if all_warnings:
                for w in all_warnings:
                    db.add(w)
                db.commit()

            # ── Store images from ZIP's images/ folder (if present) ───────────
            image_entries = [e for e in zf.namelist()
                             if not e.endswith("/") and
                             e.lower().split(".")[-1] in ("jpg", "jpeg", "png", "webp", "bmp")]

            for entry_name in image_entries:
                info = zf.getinfo(entry_name)
                if info.file_size > settings.max_entry_size_bytes:
                    logger.warning("image_entry_too_large", entry=entry_name, size=info.file_size)
                    continue
                image_bytes = zf.read(entry_name)
                content_hash, storage_ref = content_hash_and_store(image_bytes, entry_name)
                # Update Image rows that have this normalized key but no storage_ref
                norm_key = _normalize_key(entry_name)
                stmt = (
                    select(Image)
                    .where(
                        Image.project_id == upload.project_id,
                        Image.upload_id == uuid.UUID(upload_id),
                        Image.normalized_key == norm_key,
                        Image.storage_ref.is_(None),
                    )
                )
                imgs = db.execute(stmt).scalars().all()
                for img in imgs:
                    img.content_hash = content_hash
                    img.storage_ref = storage_ref
                db.commit()

            # ── Archive XML — §12.4 ───────────────────────────────────────────
            archive_xml(upload.project_id, uuid.UUID(upload_id), tmp_xml_path)
            os.unlink(tmp_xml_path)

        # Mark complete
        upload.status = UploadStatus.ingested if not all_warnings else UploadStatus.ingested
        upload.progress_pct = 100.0
        upload.processed_count = total_images
        upload.total_count = total_images
        upload.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("ingest_upload.complete", upload_id=upload_id, total_images=total_images,
                    warnings=len(all_warnings))

    except Exception as exc:
        logger.exception("ingest_upload.error", upload_id=upload_id)
        try:
            _fail_upload(db, upload, str(exc))
        except Exception:
            pass
        raise self.retry(exc=exc)
    finally:
        db.close()


def _set_upload_status(db, upload: Upload, status: UploadStatus) -> None:
    upload.status = status
    upload.started_at = datetime.now(timezone.utc)
    upload.last_heartbeat_at = datetime.now(timezone.utc)
    db.commit()


def _heartbeat(db, upload: Upload, processed: int) -> None:
    upload.last_heartbeat_at = datetime.now(timezone.utc)
    upload.processed_count = processed
    if upload.total_count > 0:
        upload.progress_pct = min(99.0, processed / upload.total_count * 100)
    db.commit()


def _fail_upload(db, upload: Upload, reason: str) -> None:
    upload.status = UploadStatus.failed
    upload.completed_at = datetime.now(timezone.utc)
    db.add(ParseWarning(
        upload_id=upload.id,
        severity="error",
        message=reason,
    ))
    db.commit()
    logger.error("upload_failed", upload_id=str(upload.id), reason=reason)


def _build_label_map(db, project_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """Return {label_name: label_id} from the project's latest schema."""
    schema_stmt = (
        select(LabelSchema)
        .where(LabelSchema.project_id == project_id)
        .order_by(LabelSchema.version.desc())
    )
    schema = db.execute(schema_stmt).scalar_one_or_none()
    if schema is None:
        return {}
    labels = db.execute(select(Label).where(Label.label_schema_id == schema.id)).scalars().all()
    return {l.name: l.id for l in labels}


def _normalize_key(filename: str) -> str:
    from app.services.ingestion_service import normalize_image_key
    return normalize_image_key(filename)
