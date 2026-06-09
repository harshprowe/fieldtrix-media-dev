from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest

from app.core.config import Settings
from app.services.r2_storage_service import (
    R2ConfigurationError,
    R2StorageService,
    R2UploadValidationError,
)


class FakeR2Client:
    def __init__(self) -> None:
        self.presigned_calls: list[dict[str, Any]] = []
        self.head_response: dict[str, Any] = {
            "ContentLength": 1024,
            "ContentType": "image/png",
            "ETag": '"etag"',
        }

    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, Any] | None = None,
        ExpiresIn: int = 3600,
        HttpMethod: str | None = None,
    ) -> str:
        self.presigned_calls.append(
            {
                "ClientMethod": ClientMethod,
                "Params": Params,
                "ExpiresIn": ExpiresIn,
                "HttpMethod": HttpMethod,
            }
        )
        return f"https://r2.example.test/{ClientMethod}"

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        return self.head_response


def make_settings() -> Settings:
    return Settings(
        r2_account_id="account",
        r2_access_key_id="access",
        r2_secret_access_key="secret",
        r2_bucket_name="fieldtrix-media",
        r2_public_base_url="https://cdn.example.com",
        r2_presigned_upload_expire_seconds=600,
        r2_presigned_download_expire_seconds=300,
        r2_max_upload_size_bytes=10_000,
    )


def test_generate_upload_url_uses_presigned_put_object() -> None:
    client = FakeR2Client()
    service = R2StorageService(config=make_settings(), client=client)
    media_id = UUID("11111111-1111-1111-1111-111111111111")

    result = service.generate_upload_url(
        filename="Launch Screen.png",
        content_type="image/png",
        content_length=1024,
        media_id=media_id,
        version=2,
    )

    assert result.upload_url == "https://r2.example.test/put_object"
    assert result.media_id == media_id
    assert result.version == 2
    assert result.object_key == f"media/{media_id}/v2/Launch-Screen.png"
    assert result.cdn_url == f"https://cdn.example.com/{result.object_key}"
    assert result.required_headers == {"Content-Type": "image/png"}
    assert client.presigned_calls[0]["ClientMethod"] == "put_object"
    assert client.presigned_calls[0]["HttpMethod"] == "PUT"


def test_generate_download_url_uses_presigned_get_object() -> None:
    client = FakeR2Client()
    service = R2StorageService(config=make_settings(), client=client)

    result = service.generate_download_url(object_key="media/file.png")

    assert result.download_url == "https://r2.example.test/get_object"
    assert result.object_key == "media/file.png"
    assert result.expires_in == 300
    assert client.presigned_calls[0]["ClientMethod"] == "get_object"
    assert client.presigned_calls[0]["HttpMethod"] == "GET"


def test_validate_upload_returns_head_metadata_without_downloading_file() -> None:
    service = R2StorageService(config=make_settings(), client=FakeR2Client())

    result = service.validate_upload(
        object_key="media/file.png",
        expected_content_length=1024,
        expected_content_type="image/png",
    )

    assert result.is_valid is True
    assert result.file_size == 1024
    assert result.content_type == "image/png"
    assert result.etag == '"etag"'


def test_validate_upload_rejects_size_mismatch() -> None:
    service = R2StorageService(config=make_settings(), client=FakeR2Client())

    with pytest.raises(R2UploadValidationError):
        service.validate_upload(object_key="media/file.png", expected_content_length=2048)


def test_missing_r2_configuration_is_rejected() -> None:
    config = make_settings().model_copy(update={"r2_bucket_name": ""})
    service = R2StorageService(config=config, client=FakeR2Client())

    with pytest.raises(R2ConfigurationError):
        service.generate_download_url(object_key="media/file.png")
