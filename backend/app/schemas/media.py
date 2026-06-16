from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.media_asset import MediaType


class MediaMetadataBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    media_type: MediaType
    object_key: str = Field(min_length=1, max_length=1024)
    cdn_url: str | None = Field(default=None, min_length=1, max_length=2048)
    version: int = Field(default=1, ge=1)
    file_size: int = Field(ge=0)


class MediaCreate(MediaMetadataBase):
    id: uuid.UUID | None = None
    content_type: str = Field(min_length=1, max_length=255)


class MediaCreateMetadata(MediaMetadataBase):
    id: uuid.UUID | None = None


class MediaUploadUrlRequest(BaseModel):
    media_id: uuid.UUID | None = None
    version: int = Field(default=1, ge=1)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=255)
    file_size: int = Field(gt=0)


class MediaUploadUrlResponse(BaseModel):
    media_id: uuid.UUID
    version: int
    upload_url: str
    object_key: str
    expires_in: int
    required_headers: dict[str, str]


class MediaPlaybackUrlResponse(BaseModel):
    media_id: uuid.UUID
    version: int
    playback_url: str
    expires_in: int


class MediaUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    media_type: MediaType | None = None
    object_key: str | None = Field(default=None, min_length=1, max_length=1024)
    cdn_url: str | None = Field(default=None, min_length=1, max_length=2048)
    version: int | None = Field(default=None, ge=1)
    file_size: int | None = Field(default=None, ge=0)


class MediaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    media_type: MediaType
    version: int
    file_size: int
    created_at: datetime
    updated_at: datetime


class MediaList(BaseModel):
    items: list[MediaRead]
    total: int
    limit: int
    offset: int
