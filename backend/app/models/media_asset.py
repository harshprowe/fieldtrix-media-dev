from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import BigInteger, Enum, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    OTHER = "other"


class MediaAsset(Base, TimestampMixin):
    __tablename__ = "media_assets"
    __table_args__ = (
        UniqueConstraint("title", "version", name="uq_media_assets_title_version"),
        UniqueConstraint("object_key", name="uq_media_assets_object_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    media_type: Mapped[MediaType] = mapped_column(
        Enum(MediaType, name="media_type", values_callable=lambda enum: [item.value for item in enum]),
        nullable=False,
    )
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    cdn_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
