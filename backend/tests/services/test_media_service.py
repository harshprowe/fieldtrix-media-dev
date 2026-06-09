from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from app.models.media_asset import MediaType
from app.schemas.media import MediaCreate, MediaCreateMetadata, MediaUpdate
from app.services.media_service import MediaConflictError, MediaService, MediaUploadValidationError
from app.services.r2_storage_service import PresignedUpload, R2UploadValidationError


@dataclass
class MediaRecord:
    id: uuid.UUID
    title: str
    media_type: MediaType
    object_key: str
    cdn_url: str
    version: int
    file_size: int
    created_at: datetime
    updated_at: datetime


class FakeMediaRepository:
    def __init__(self) -> None:
        self.records: dict[uuid.UUID, MediaRecord] = {}

    async def list(self, *, limit: int, offset: int) -> tuple[list[MediaRecord], int]:
        records = list(self.records.values())
        return records[offset : offset + limit], len(records)

    async def get(self, media_id: uuid.UUID) -> MediaRecord | None:
        return self.records.get(media_id)

    async def get_by_title_and_version(self, *, title: str, version: int) -> MediaRecord | None:
        return next(
            (
                record
                for record in self.records.values()
                if record.title == title and record.version == version
            ),
            None,
        )

    async def create(self, media_create: MediaCreateMetadata) -> MediaRecord:
        now = datetime.now(UTC)
        record = MediaRecord(
            id=media_create.id or uuid.uuid4(),
            title=media_create.title,
            media_type=media_create.media_type,
            object_key=media_create.object_key,
            cdn_url=media_create.cdn_url,
            version=media_create.version,
            file_size=media_create.file_size,
            created_at=now,
            updated_at=now,
        )
        self.records[record.id] = record
        return record

    async def update(self, media: MediaRecord, media_update: MediaUpdate) -> MediaRecord:
        update_data = media_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(media, field, value)
        media.updated_at = datetime.now(UTC)
        return media

    async def delete(self, media: MediaRecord) -> None:
        self.records.pop(media.id)


class FakeStorageService:
    def generate_upload_url(
        self,
        *,
        filename: str,
        content_type: str,
        content_length: int,
        media_id: uuid.UUID | None = None,
        version: int = 1,
        folder: str = "media",
    ) -> PresignedUpload:
        resolved_media_id = media_id or uuid.UUID("11111111-1111-1111-1111-111111111111")
        object_key = f"{folder}/{resolved_media_id}/v{version}/{filename}"
        return PresignedUpload(
            media_id=resolved_media_id,
            version=version,
            upload_url="https://r2.example.test/upload",
            object_key=object_key,
            cdn_url=f"https://cdn.example.com/{object_key}",
            expires_in=900,
            required_headers={"Content-Type": content_type},
        )

    def validate_upload(
        self,
        *,
        object_key: str,
        expected_content_length: int | None = None,
        expected_content_type: str | None = None,
    ) -> object:
        return object()


class FailingValidationStorageService(FakeStorageService):
    def validate_upload(
        self,
        *,
        object_key: str,
        expected_content_length: int | None = None,
        expected_content_type: str | None = None,
    ) -> object:
        raise R2UploadValidationError("Uploaded object was not found in R2")


@pytest.mark.asyncio
async def test_create_media_rejects_duplicate_title_and_version() -> None:
    repository = FakeMediaRepository()
    service = MediaService(repository, FakeStorageService())
    payload = MediaCreate(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        title="Launch Screen",
        media_type=MediaType.IMAGE,
        object_key="media/11111111-1111-1111-1111-111111111111/v1/launch.png",
        cdn_url="https://cdn.example.com/media/11111111-1111-1111-1111-111111111111/v1/launch.png",
        version=1,
        file_size=1024,
        content_type="image/png",
    )

    await service.create_media(payload)

    with pytest.raises(MediaConflictError):
        await service.create_media(payload)


@pytest.mark.asyncio
async def test_update_media_rejects_duplicate_target_version() -> None:
    repository = FakeMediaRepository()
    service = MediaService(repository, FakeStorageService())
    first = await service.create_media(
        MediaCreate(
            id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            title="Menu",
            media_type=MediaType.IMAGE,
            object_key="media/11111111-1111-1111-1111-111111111111/v1/menu.png",
            cdn_url="https://cdn.example.com/media/11111111-1111-1111-1111-111111111111/v1/menu.png",
            version=1,
            file_size=100,
            content_type="image/png",
        )
    )
    await service.create_media(
        MediaCreate(
            id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            title="Menu",
            media_type=MediaType.IMAGE,
            object_key="media/22222222-2222-2222-2222-222222222222/v2/menu.png",
            cdn_url="https://cdn.example.com/media/22222222-2222-2222-2222-222222222222/v2/menu.png",
            version=2,
            file_size=120,
            content_type="image/png",
        )
    )

    with pytest.raises(MediaConflictError):
        await service.update_media(first.id, MediaUpdate(version=2))


@pytest.mark.asyncio
async def test_delete_media_returns_false_when_missing() -> None:
    repository = FakeMediaRepository()
    service = MediaService(repository, FakeStorageService())

    deleted = await service.delete_media(uuid.uuid4())

    assert deleted is False


@pytest.mark.asyncio
async def test_create_media_rejects_metadata_when_r2_upload_is_not_validated() -> None:
    repository = FakeMediaRepository()
    service = MediaService(repository, FailingValidationStorageService())

    with pytest.raises(MediaUploadValidationError):
        await service.create_media(
            MediaCreate(
                id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
                title="Missing Upload",
                media_type=MediaType.IMAGE,
                object_key="media/11111111-1111-1111-1111-111111111111/v1/missing.png",
                cdn_url="https://cdn.example.com/media/11111111-1111-1111-1111-111111111111/v1/missing.png",
                version=1,
                file_size=1024,
                content_type="image/png",
            )
        )

    assert repository.records == {}
