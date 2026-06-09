from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media_asset import MediaAsset
from app.schemas.media import MediaCreateMetadata, MediaUpdate


class MediaRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(self, *, limit: int, offset: int) -> tuple[list[MediaAsset], int]:
        total_result = await self._session.execute(select(func.count()).select_from(MediaAsset))
        total = total_result.scalar_one()

        result = await self._session.execute(
            select(MediaAsset).order_by(MediaAsset.created_at.desc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), total

    async def get(self, media_id: uuid.UUID) -> MediaAsset | None:
        return await self._session.get(MediaAsset, media_id)

    async def get_by_title_and_version(self, *, title: str, version: int) -> MediaAsset | None:
        result = await self._session.execute(
            select(MediaAsset).where(MediaAsset.title == title, MediaAsset.version == version)
        )
        return result.scalar_one_or_none()

    async def create(self, media_create: MediaCreateMetadata) -> MediaAsset:
        media = MediaAsset(**media_create.model_dump(exclude_none=True))
        self._session.add(media)
        await self._session.commit()
        await self._session.refresh(media)
        return media

    async def update(self, media: MediaAsset, media_update: MediaUpdate) -> MediaAsset:
        update_data = media_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(media, field, value)

        await self._session.commit()
        await self._session.refresh(media)
        return media

    async def delete(self, media: MediaAsset) -> None:
        await self._session.delete(media)
        await self._session.commit()
