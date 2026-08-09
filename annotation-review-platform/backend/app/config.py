"""
Application configuration — reads from environment / .env file.
All comparison thresholds are project-level overrides; these are system-wide defaults (§9.5, FR-6.3).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://arplatform:changeme@postgres:5432/arplatform"
    database_sync_url: str = "postgresql://arplatform:changeme@postgres:5432/arplatform"

    # Redis / Celery
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"

    # Auth
    secret_key: str = "dev-insecure-key-replace-in-production"
    access_token_expire_minutes: int = 60
    algorithm: str = "HS256"

    # Storage (§22.2)
    data_dir: str = "/data"

    @property
    def raw_zips_dir(self) -> str:
        return os.path.join(self.data_dir, "raw-zips")

    @property
    def images_dir(self) -> str:
        return os.path.join(self.data_dir, "images")

    @property
    def xml_archive_dir(self) -> str:
        return os.path.join(self.data_dir, "xml-archive")

    @property
    def backups_dir(self) -> str:
        return os.path.join(self.data_dir, "backups")

    # Upload limits (§13.1, §13.2, §16.5)
    max_zip_size_bytes: int = 10 * 1024 ** 3      # 10 GB
    max_entry_size_bytes: int = 2 * 1024 ** 3     # 2 GB per entry
    chunk_size_bytes: int = 5 * 1024 ** 2         # 5 MB

    # Worker / queue
    worker_concurrency: int = 4
    ingestion_batch_size: int = 500
    comparison_batch_size: int = 500
    job_max_attempts: int = 3
    job_heartbeat_timeout_seconds: int = 300

    # Comparison defaults — all overridable per project via ProjectConfig (§9.5)
    default_box_iou_exact: float = 0.90
    default_box_iou_minor: float = 0.75
    default_polygon_iou_exact: float = 0.90
    default_polygon_iou_minor: float = 0.60
    default_ocr_edit_distance_minor: int = 1

    # App
    environment: str = "production"
    log_level: str = "INFO"


settings = Settings()
