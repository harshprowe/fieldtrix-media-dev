from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any, Protocol, cast

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings, settings

_SAFE_FILENAME_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


class R2StorageError(Exception):
    pass


class R2ConfigurationError(R2StorageError):
    pass


class R2PresignError(R2StorageError):
    pass


class R2UploadValidationError(R2StorageError):
    pass


class S3CompatibleClient(Protocol):
    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, Any] | None = None,
        ExpiresIn: int = 3600,
        HttpMethod: str | None = None,
    ) -> str: ...

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]: ...


@dataclass(frozen=True)
class PresignedUpload:
    media_id: uuid.UUID
    version: int
    upload_url: str
    object_key: str
    cdn_url: str | None
    expires_in: int
    required_headers: dict[str, str]


@dataclass(frozen=True)
class PresignedDownload:
    download_url: str
    object_key: str
    expires_in: int


@dataclass(frozen=True)
class UploadValidation:
    object_key: str
    file_size: int
    content_type: str | None
    etag: str | None
    is_valid: bool


class R2StorageService:
    def __init__(
        self,
        config: Settings = settings,
        client: S3CompatibleClient | None = None,
    ) -> None:
        self._settings = config
        self._client = client

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
        self._validate_config()
        self._validate_upload_request(
            filename=filename,
            content_type=content_type,
            content_length=content_length,
            version=version,
        )

        resolved_media_id = media_id or uuid.uuid4()
        object_key = self._build_object_key(
            folder=folder,
            media_id=resolved_media_id,
            version=version,
            filename=filename,
        )
        try:
            upload_url = self._get_client().generate_presigned_url(
                ClientMethod="put_object",
                Params={
                    "Bucket": self._settings.r2_bucket_name,
                    "Key": object_key,
                    "ContentType": content_type,
                },
                ExpiresIn=self._settings.r2_presigned_upload_expire_seconds,
                HttpMethod="PUT",
            )
        except (BotoCoreError, ClientError) as exc:
            raise R2PresignError("Unable to generate R2 upload URL") from exc

        return PresignedUpload(
            media_id=resolved_media_id,
            version=version,
            upload_url=upload_url,
            object_key=object_key,
            cdn_url=self._build_public_url(object_key),
            expires_in=self._settings.r2_presigned_upload_expire_seconds,
            required_headers={"Content-Type": content_type},
        )

    def generate_download_url(self, *, object_key: str) -> PresignedDownload:
        self._validate_config()
        self._validate_object_key(object_key)

        try:
            download_url = self._get_client().generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": self._settings.r2_bucket_name, "Key": object_key},
                ExpiresIn=self._settings.r2_presigned_download_expire_seconds,
                HttpMethod="GET",
            )
        except (BotoCoreError, ClientError) as exc:
            raise R2PresignError("Unable to generate R2 download URL") from exc

        return PresignedDownload(
            download_url=download_url,
            object_key=object_key,
            expires_in=self._settings.r2_presigned_download_expire_seconds,
        )

    def validate_upload(
        self,
        *,
        object_key: str,
        expected_content_length: int | None = None,
        expected_content_type: str | None = None,
    ) -> UploadValidation:
        self._validate_config()
        self._validate_object_key(object_key)

        try:
            head = self._get_client().head_object(
                Bucket=self._settings.r2_bucket_name,
                Key=object_key,
            )
        except ClientError as exc:
            raise R2UploadValidationError("Uploaded object was not found in R2") from exc
        except BotoCoreError as exc:
            raise R2UploadValidationError("Unable to validate uploaded R2 object") from exc

        actual_length = int(head.get("ContentLength", 0))
        actual_type = cast(str | None, head.get("ContentType"))
        if expected_content_length is not None and actual_length != expected_content_length:
            raise R2UploadValidationError("Uploaded object size does not match expected size")
        if expected_content_type is not None and actual_type != expected_content_type:
            raise R2UploadValidationError("Uploaded object content type does not match expected type")

        return UploadValidation(
            object_key=object_key,
            file_size=actual_length,
            content_type=actual_type,
            etag=cast(str | None, head.get("ETag")),
            is_valid=True,
        )

    def _get_client(self) -> S3CompatibleClient:
        if self._client is None:
            endpoint_url = f"https://{self._settings.r2_account_id}.r2.cloudflarestorage.com"
            self._client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                aws_access_key_id=self._settings.r2_access_key_id,
                aws_secret_access_key=self._settings.r2_secret_access_key,
                region_name=self._settings.r2_region_name,
                config=Config(signature_version="s3v4"),
            )
        return self._client

    def _validate_config(self) -> None:
        missing = [
            name
            for name, value in {
                "R2_ACCOUNT_ID": self._settings.r2_account_id,
                "R2_ACCESS_KEY_ID": self._settings.r2_access_key_id,
                "R2_SECRET_ACCESS_KEY": self._settings.r2_secret_access_key,
                "R2_BUCKET_NAME": self._settings.r2_bucket_name,
            }.items()
            if not value
        ]
        if missing:
            raise R2ConfigurationError(f"Missing required R2 configuration: {', '.join(missing)}")

    def _validate_upload_request(
        self,
        *,
        filename: str,
        content_type: str,
        content_length: int,
        version: int,
    ) -> None:
        if not filename.strip():
            raise R2UploadValidationError("Filename is required")
        if not content_type.strip():
            raise R2UploadValidationError("Content type is required")
        if content_length <= 0:
            raise R2UploadValidationError("Content length must be greater than zero")
        if content_length > self._settings.r2_max_upload_size_bytes:
            raise R2UploadValidationError("Content length exceeds maximum upload size")
        if version < 1:
            raise R2UploadValidationError("Media version must be greater than zero")

    def _validate_object_key(self, object_key: str) -> None:
        if not object_key.strip():
            raise R2UploadValidationError("Object key is required")
        if object_key.startswith("/") or ".." in object_key.split("/"):
            raise R2UploadValidationError("Object key is invalid")

    def _build_object_key(
        self,
        *,
        folder: str,
        media_id: uuid.UUID,
        version: int,
        filename: str,
    ) -> str:
        safe_folder = _SAFE_FILENAME_PATTERN.sub("-", folder.strip("/")) or "media"
        safe_filename = _SAFE_FILENAME_PATTERN.sub("-", filename.strip()).strip(".-")
        if not safe_filename:
            raise R2UploadValidationError("Filename must contain at least one safe character")
        return f"{safe_folder}/{media_id}/v{version}/{safe_filename}"

    def _build_public_url(self, object_key: str) -> str | None:
        if not self._settings.r2_public_base_url:
            return None
        return f"{self._settings.r2_public_base_url.rstrip('/')}/{object_key}"
