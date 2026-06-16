from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_media_service
from app.api.v1.endpoints import media
from app.repositories.media_repository import MediaRepository
from app.services.media_service import MediaService
from app.services.r2_storage_service import R2StorageService

MediaServiceFactory = Callable[[AsyncSession], MediaService]


def create_default_media_service(session: AsyncSession) -> MediaService:
    return MediaService(MediaRepository(session), R2StorageService())


def mount_fieldtrix_media(
    app: FastAPI,
    *,
    prefix: str = "/api/v1/media",
    tags: list[str] | None = None,
    media_service_factory: MediaServiceFactory = create_default_media_service,
) -> None:
    async def provide_media_service(db: AsyncSession = Depends(get_db)) -> MediaService:
        return media_service_factory(db)

    app.dependency_overrides[get_media_service] = provide_media_service
    app.include_router(media.router, prefix=prefix, tags=tags or ["media"])
