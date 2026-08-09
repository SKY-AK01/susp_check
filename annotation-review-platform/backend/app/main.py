"""
FastAPI application entrypoint — §7.1.
All API routes registered here; CORS, middleware, and WebSocket (SSE) progress endpoint.
"""
import structlog
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, direct_images, feedback, images, projects, reference_sets, reports, runs, students, uploads
from app.auth.rbac import get_current_user

logger = structlog.get_logger(__name__)

app = FastAPI(
    title="Annotation Review Platform",
    version="1.0.0",
    description="Supervisor annotation-review and quality-control platform.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten in production to the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ──────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(uploads.router)
app.include_router(students.router)
app.include_router(reference_sets.router)
app.include_router(runs.router)
app.include_router(images.router)
app.include_router(direct_images.router)
app.include_router(feedback.router)
app.include_router(reports.router)


# ── WebSocket progress endpoint — §7.1, §8.5 ─────────────────────────────────
@app.websocket("/ws/progress/{entity_type}/{entity_id}")
async def ws_progress(websocket: WebSocket, entity_type: str, entity_id: str):
    """
    Push job progress updates to the frontend — §8.5.
    Clients subscribe to /ws/progress/upload/<upload_id> or /ws/progress/run/<run_id>.
    Progress is polled from DB and pushed every 2 seconds while the job is running.
    """
    import asyncio
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.upload import Upload, UploadStatus
    from app.models.comparison import ComparisonRun, RunStatus

    await websocket.accept()
    try:
        while True:
            async with AsyncSessionLocal() as db:
                if entity_type == "upload":
                    from uuid import UUID
                    obj = (await db.execute(
                        select(Upload).where(Upload.id == UUID(entity_id))
                    )).scalar_one_or_none()
                    if obj:
                        await websocket.send_json({
                            "type": "upload_progress",
                            "status": obj.status.value,
                            "progress_pct": obj.progress_pct,
                            "processed_count": obj.processed_count,
                            "total_count": obj.total_count,
                        })
                        if obj.status in (UploadStatus.ingested, UploadStatus.failed,
                                          UploadStatus.partially_failed):
                            break
                elif entity_type == "run":
                    from uuid import UUID
                    obj = (await db.execute(
                        select(ComparisonRun).where(ComparisonRun.id == UUID(entity_id))
                    )).scalar_one_or_none()
                    if obj:
                        await websocket.send_json({
                            "type": "run_progress",
                            "status": obj.status.value,
                            "progress_pct": obj.progress_pct,
                            "processed_count": obj.processed_count,
                            "total_count": obj.total_count,
                        })
                        if obj.status in (RunStatus.complete, RunStatus.failed,
                                          RunStatus.partially_failed):
                            break

            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass


@app.get("/healthz")
async def health():
    return {"status": "ok"}
