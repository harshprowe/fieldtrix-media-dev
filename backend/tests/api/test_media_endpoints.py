from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_media_service
from app.main import app
from app.models.media_asset import MediaType
from app.schemas.media import MediaCreate, MediaUpdate, MediaUploadUrlRequest
from app.services.media_service import MediaConflictError, MediaListResult
from app.services.r2_storage_service import PresignedDownload, PresignedUpload


fastapi_app = app.app


@dataclass
class MediaRecord:
    id: uuid.UUID
    title: str
    media_type: MediaType
    object_key: str
    cdn_url: str | None
    version: int
    file_size: int
    created_at: datetime
    updated_at: datetime


class FakeMediaService:
    def __init__(self) -> None:
        now = datetime.now(UTC)
        self.record = MediaRecord(
            id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            title="Launch Screen",
            media_type=MediaType.IMAGE,
            object_key="media/00000000-0000-0000-0000-000000000001/v1/launch.png",
            cdn_url="https://cdn.example.com/media/00000000-0000-0000-0000-000000000001/v1/launch.png",
            version=1,
            file_size=1024,
            created_at=now,
            updated_at=now,
        )

    async def list_media(self, *, limit: int = 50, offset: int = 0) -> MediaListResult:
        return MediaListResult(items=[self.record], total=1, limit=limit, offset=offset)

    async def generate_upload_url(self, request: MediaUploadUrlRequest) -> PresignedUpload:
        media_id = request.media_id or uuid.UUID("11111111-1111-1111-1111-111111111111")
        object_key = f"media/{media_id}/v{request.version}/uploaded.png"
        return PresignedUpload(
            media_id=media_id,
            version=request.version,
            upload_url="https://r2.example.test/upload",
            object_key=object_key,
            cdn_url=f"https://cdn.example.com/{object_key}",
            expires_in=900,
            required_headers={"Content-Type": request.content_type},
        )

    async def get_media(self, media_id: uuid.UUID) -> MediaRecord | None:
        if media_id == self.record.id:
            return self.record
        return None

    async def generate_playback_url(
        self,
        media_id: uuid.UUID,
    ) -> tuple[MediaRecord, PresignedDownload] | None:
        if media_id != self.record.id:
            return None
        return self.record, PresignedDownload(
            download_url="https://r2.example.test/signed-download",
            object_key=self.record.object_key,
            expires_in=900,
        )

    async def create_media(self, media_create: MediaCreate) -> MediaRecord:
        if media_create.title == "Duplicate":
            raise MediaConflictError("A media asset with this title and version already exists")

        self.record.title = media_create.title
        self.record.media_type = media_create.media_type
        self.record.object_key = media_create.object_key
        self.record.cdn_url = media_create.cdn_url
        self.record.version = media_create.version
        self.record.file_size = media_create.file_size
        return self.record

    async def update_media(
        self,
        media_id: uuid.UUID,
        media_update: MediaUpdate,
    ) -> MediaRecord | None:
        if media_id != self.record.id:
            return None
        if media_update.title == "Duplicate":
            raise MediaConflictError("A media asset with this title and version already exists")

        for field, value in media_update.model_dump(exclude_unset=True).items():
            setattr(self.record, field, value)
        return self.record

    async def delete_media(self, media_id: uuid.UUID) -> bool:
        return media_id == self.record.id


@pytest.fixture(autouse=True)
def override_media_service() -> Iterator[None]:
    fastapi_app.dependency_overrides[get_media_service] = FakeMediaService
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_media() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/api/v1/media")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Launch Screen"
    assert "cdn_url" not in body["items"][0]
    assert "object_key" not in body["items"][0]


@pytest.mark.asyncio
async def test_create_media_returns_created_asset() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/v1/media",
            json={
                "title": "Menu Board",
                "media_type": "image",
                "id": "11111111-1111-1111-1111-111111111111",
                "object_key": "media/11111111-1111-1111-1111-111111111111/v1/menu.png",
                "cdn_url": None,
                "version": 1,
                "file_size": 2048,
                "content_type": "image/png",
            },
        )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Menu Board"
    assert "cdn_url" not in body
    assert "object_key" not in body


@pytest.mark.asyncio
async def test_get_media_returns_not_found_for_missing_asset() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/api/v1/media/00000000-0000-0000-0000-000000000999")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_media_returns_conflict_for_duplicate_asset() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/v1/media",
            json={
                "title": "Duplicate",
                "media_type": "image",
                "id": "11111111-1111-1111-1111-111111111111",
                "object_key": "media/11111111-1111-1111-1111-111111111111/v1/duplicate.png",
                "cdn_url": None,
                "version": 1,
                "file_size": 2048,
                "content_type": "image/png",
            },
        )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_create_upload_url_returns_presigned_r2_contract() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/v1/media/upload-url",
            json={
                "filename": "uploaded.png",
                "content_type": "image/png",
                "file_size": 2048,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["media_id"] == "11111111-1111-1111-1111-111111111111"
    assert body["version"] == 1
    assert body["upload_url"] == "https://r2.example.test/upload"
    assert body["object_key"] == "media/11111111-1111-1111-1111-111111111111/v1/uploaded.png"
    assert "cdn_url" not in body
    assert body["required_headers"] == {"Content-Type": "image/png"}


@pytest.mark.asyncio
async def test_create_playback_url_returns_short_lived_signed_url() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/v1/media/00000000-0000-0000-0000-000000000001/playback-url"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["media_id"] == "00000000-0000-0000-0000-000000000001"
    assert body["version"] == 1
    assert body["playback_url"] == "https://r2.example.test/signed-download"
    assert body["expires_in"] == 900
