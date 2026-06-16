from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, Sequence

from app.models.media_asset import MediaType
from app.schemas.media import (
    MediaCreate,
    MediaCreateMetadata,
    MediaUpdate,
    MediaUploadUrlRequest,
)
from app.services.r2_storage_service import (
    PresignedDownload,
    PresignedUpload,
    R2ConfigurationError,
    R2PresignError,
    R2StorageService,
    R2UploadValidationError,
)


class MediaEntity(Protocol):
    id: uuid.UUID
    title: str
    media_type: MediaType
    object_key: str
    cdn_url: str | None
    version: int
    file_size: int
    created_at: datetime
    updated_at: datetime


class MediaRepositoryProtocol(Protocol):
    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[MediaEntity], int]: ...

    async def get(self, media_id: uuid.UUID) -> MediaEntity | None: ...

    async def get_by_title_and_version(self, *, title: str, version: int) -> MediaEntity | None: ...

    async def create(self, media_create: MediaCreateMetadata) -> MediaEntity: ...

    async def update(self, media: Any, media_update: MediaUpdate) -> MediaEntity: ...

    async def delete(self, media: Any) -> None: ...


class StorageServiceProtocol(Protocol):
    def generate_upload_url(
        self,
        *,
        filename: str,
        content_type: str,
        content_length: int,
        media_id: uuid.UUID | None = None,
        version: int = 1,
        folder: str = "media",
    ) -> PresignedUpload: ...

    def validate_upload(
        self,
        *,
        object_key: str,
        expected_content_length: int | None = None,
        expected_content_type: str | None = None,
    ) -> Any: ...


@dataclass(frozen=True)
class MediaListResult:
    items: Sequence[MediaEntity]
    total: int
    limit: int
    offset: int


class MediaConflictError(Exception):
    pass


class MediaUploadUrlError(Exception):
    pass


class MediaUploadValidationError(Exception):
    pass


class MediaStorageUnavailableError(Exception):
    pass


class MediaService:
    def __init__(
        self,
        repository: MediaRepositoryProtocol,
        storage_service: StorageServiceProtocol | None = None,
    ) -> None:
        self._repository = repository
        self._storage_service = storage_service or R2StorageService()

    async def list_media(self, *, limit: int = 50, offset: int = 0) -> MediaListResult:
        items, total = await self._repository.list(limit=limit, offset=offset)
        return MediaListResult(items=items, total=total, limit=limit, offset=offset)

    async def get_media(self, media_id: uuid.UUID) -> MediaEntity | None:
        return await self._repository.get(media_id)

    async def generate_upload_url(self, request: MediaUploadUrlRequest) -> PresignedUpload:
        try:
            return self._storage_service.generate_upload_url(
                filename=request.filename,
                content_type=request.content_type,
                content_length=request.file_size,
                media_id=request.media_id,
                version=request.version,
            )
        except R2UploadValidationError as exc:
            raise MediaUploadUrlError(str(exc)) from exc
        except (R2ConfigurationError, R2PresignError) as exc:
            raise MediaStorageUnavailableError(str(exc)) from exc

    async def generate_playback_url(self, media_id: uuid.UUID) -> tuple[MediaEntity, PresignedDownload] | None:
        media = await self._repository.get(media_id)
        if media is None:
            return None

        try:
            playback = self._storage_service.generate_download_url(object_key=media.object_key)
        except R2UploadValidationError as exc:
            raise MediaUploadUrlError(str(exc)) from exc
        except (R2ConfigurationError, R2PresignError) as exc:
            raise MediaStorageUnavailableError(str(exc)) from exc

        return media, playback

    async def create_media(self, media_create: MediaCreate) -> MediaEntity:
        media_id = media_create.id or self._extract_media_id_from_object_key(media_create.object_key)
        self._validate_versioned_object_key(
            object_key=media_create.object_key,
            media_id=media_id,
            version=media_create.version,
        )
        existing_media = await self._repository.get(media_id)

        existing = await self._repository.get_by_title_and_version(
            title=media_create.title,
            version=media_create.version,
        )
        if existing is not None and existing.id != media_id:
            raise MediaConflictError("A media asset with this title and version already exists")

        if existing_media is not None and media_create.version <= existing_media.version:
            raise MediaConflictError("New media versions must be greater than the current version")

        try:
            self._storage_service.validate_upload(
                object_key=media_create.object_key,
                expected_content_length=media_create.file_size,
                expected_content_type=media_create.content_type,
            )
        except R2UploadValidationError as exc:
            raise MediaUploadValidationError(str(exc)) from exc
        except R2ConfigurationError as exc:
            raise MediaStorageUnavailableError(str(exc)) from exc

        metadata = MediaCreateMetadata.model_validate(
            media_create.model_dump() | {"id": media_id}
        )
        if existing_media is not None:
            return await self._repository.update(
                existing_media,
                MediaUpdate(
                    title=metadata.title,
                    media_type=metadata.media_type,
                    object_key=metadata.object_key,
                    cdn_url=metadata.cdn_url,
                    version=metadata.version,
                    file_size=metadata.file_size,
                ),
            )
        return await self._repository.create(metadata)

    async def update_media(
        self,
        media_id: uuid.UUID,
        media_update: MediaUpdate,
    ) -> MediaEntity | None:
        media = await self._repository.get(media_id)
        if media is None:
            return None

        next_version = media_update.version if media_update.version is not None else media.version
        next_object_key = media_update.object_key if media_update.object_key is not None else media.object_key
        if media_update.version is not None or media_update.object_key is not None:
            if next_version <= media.version:
                raise MediaConflictError("New media versions must be greater than the current version")
            self._validate_versioned_object_key(
                object_key=next_object_key,
                media_id=media.id,
                version=next_version,
            )

        next_title = media_update.title if media_update.title is not None else media.title
        if next_title != media.title or next_version != media.version:
            existing = await self._repository.get_by_title_and_version(
                title=next_title,
                version=next_version,
            )
            if existing is not None and existing.id != media.id:
                raise MediaConflictError("A media asset with this title and version already exists")

        return await self._repository.update(media, media_update)

    async def delete_media(self, media_id: uuid.UUID) -> bool:
        media = await self._repository.get(media_id)
        if media is None:
            return False

        await self._repository.delete(media)
        return True

    def _extract_media_id_from_object_key(self, object_key: str) -> uuid.UUID:
        parts = object_key.split("/")
        if len(parts) < 4:
            raise MediaUploadValidationError(
                "Object key must use immutable media/{media_id}/v{version}/{filename} format"
            )
        try:
            return uuid.UUID(parts[1])
        except ValueError as exc:
            raise MediaUploadValidationError("Object key media id is invalid") from exc

    def _validate_versioned_object_key(
        self,
        *,
        object_key: str,
        media_id: uuid.UUID,
        version: int,
    ) -> None:
        expected_prefix = f"media/{media_id}/v{version}/"
        if not object_key.startswith(expected_prefix):
            raise MediaUploadValidationError(
                "Object key must include the media id and version as immutable identity"
            )
