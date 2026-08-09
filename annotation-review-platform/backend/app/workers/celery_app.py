"""
Celery application configuration — §8.
Queue layout:
  ingestion  — ZIP extraction, XML parsing, image storage  (I/O-heavy)
  comparison — per-student comparison sub-jobs             (CPU-bound)
  cleanup    — stalled-job detection, temp file cleanup    (low-priority)

Using Celery over RQ because:
- Mature retry-with-backoff, per-task time limits, and beat scheduler (needed for
  stalled-job detection §14.4 and pg_dump cron §22.3).
- Per-queue concurrency limits and priority routing (§8.4, §13.10).
- First-class support for fan-out (chord/group) used in §8.3.
"""
from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "arplatform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.ingestion_tasks",
        "app.workers.comparison_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Per-queue routing — §8.4
    task_routes={
        "app.workers.ingestion_tasks.*": {"queue": "ingestion"},
        "app.workers.comparison_tasks.*": {"queue": "comparison"},
        "app.workers.comparison_tasks.cleanup_stalled_jobs": {"queue": "cleanup"},
    },
    task_acks_late=True,           # ack after completion so crashes don't lose tasks
    worker_prefetch_multiplier=1,  # one task at a time per worker slot; better fairness
    task_time_limit=3600,          # hard kill after 1 hour — §13.9
    task_soft_time_limit=3300,     # soft warning at 55 min
    # Retry defaults (each task can override)
    task_max_retries=settings.job_max_attempts,
    # Beat schedule — §14.4 stalled-job detection
    beat_schedule={
        "detect-stalled-jobs": {
            "task": "app.workers.comparison_tasks.cleanup_stalled_jobs",
            "schedule": crontab(minute="*/5"),  # every 5 minutes
        },
    },
)
