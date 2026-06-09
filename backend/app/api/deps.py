from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db_session
from app.repositories.media_repository import MediaRepository
from app.schemas.auth import TokenPayload
from app.services.media_service import MediaService
from app.services.r2_storage_service import R2StorageService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")


async def get_db() -> AsyncIterator[AsyncSession]:
    async for session in get_db_session():
        yield session


async def get_current_token_payload(token: str = Depends(oauth2_scheme)) -> TokenPayload:
    payload = decode_token(token)
    if payload is None or payload.token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


async def get_media_service(db: AsyncSession = Depends(get_db)) -> MediaService:
    return MediaService(MediaRepository(db), R2StorageService())
