"""
Upload service — validates and assembles uploads before handing off to the ingestion task.
Thin layer; heavy lifting is in ingestion_service.py and ingestion_tasks.py.
"""
from __future__ import annotations
import os
import zipfile

from app.config import settings
from app.services.ingestion_service import find_annotation_xml_in_zip


def validate_zip_sync(zip_path: str) -> tuple[bool, str]:
    """
    Synchronous fast-fail validation on a fully assembled ZIP — §15.1.
    Returns (is_valid, error_message).
    """
    if not os.path.exists(zip_path):
        return False, f"ZIP file not found at {zip_path}"

    file_size = os.path.getsize(zip_path)
    if file_size > settings.max_zip_size_bytes:
        return False, (
            f"ZIP size {file_size:,} bytes exceeds maximum "
            f"{settings.max_zip_size_bytes:,} bytes"
        )

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Guard against zip-bomb: check total uncompressed size — §13.2, §16.5
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            if total_uncompressed > settings.max_zip_size_bytes:
                return False, (
                    f"Total uncompressed size {total_uncompressed:,} bytes would exceed "
                    f"maximum {settings.max_zip_size_bytes:,} bytes"
                )

            # Guard against path traversal — §16.5
            for name in zf.namelist():
                if name.startswith("/") or ".." in name:
                    return False, f"Dangerous ZIP entry path detected: {name}"

            xml_entry = find_annotation_xml_in_zip(zf)
            if xml_entry is None:
                return False, (
                    "ZIP contains no annotations.xml. "
                    "Please export from CVAT as a project-level XML export."
                )
    except zipfile.BadZipFile as exc:
        return False, f"File is not a valid ZIP archive: {exc}"
    except ValueError as exc:
        return False, str(exc)

    return True, ""
