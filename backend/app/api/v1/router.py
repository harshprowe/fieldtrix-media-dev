from fastapi import APIRouter

from app.api.v1.endpoints import auth, health, media, metrics

api_router = APIRouter()
api_router.include_router(metrics.router, tags=["metrics"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
