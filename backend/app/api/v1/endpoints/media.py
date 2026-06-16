from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import get_media_service
from app.schemas.media import (
    MediaCreate,
    MediaList,
    MediaPlaybackUrlResponse,
    MediaRead,
    MediaUpdate,
    MediaUploadUrlRequest,
    MediaUploadUrlResponse,
)
from app.services.media_service import (
    MediaConflictError,
    MediaService,
    MediaStorageUnavailableError,
    MediaUploadUrlError,
    MediaUploadValidationError,
)

router = APIRouter()


@router.get("", response_model=MediaList)
async def list_media(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: MediaService = Depends(get_media_service),
) -> MediaList:
    result = await service.list_media(limit=limit, offset=offset)
    return MediaList(
        items=[MediaRead.model_validate(item) for item in result.items],
        total=result.total,
        limit=result.limit,
        offset=result.offset,
    )


@router.post("/upload-url", response_model=MediaUploadUrlResponse)
async def create_media_upload_url(
    request: MediaUploadUrlRequest,
    service: MediaService = Depends(get_media_service),
) -> MediaUploadUrlResponse:
    try:
        upload = await service.generate_upload_url(request)
    except MediaUploadUrlError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except MediaStorageUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return MediaUploadUrlResponse(
        media_id=upload.media_id,
        version=upload.version,
        upload_url=upload.upload_url,
        object_key=upload.object_key,
        expires_in=upload.expires_in,
        required_headers=upload.required_headers,
    )


@router.post("/{media_id}/playback-url", response_model=MediaPlaybackUrlResponse)
async def create_media_playback_url(
    media_id: uuid.UUID,
    service: MediaService = Depends(get_media_service),
) -> MediaPlaybackUrlResponse:
    try:
        result = await service.generate_playback_url(media_id)
    except MediaUploadUrlError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except MediaStorageUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    media, playback = result
    return MediaPlaybackUrlResponse(
        media_id=media.id,
        version=media.version,
        playback_url=playback.download_url,
        expires_in=playback.expires_in,
    )


@router.post("", response_model=MediaRead, status_code=status.HTTP_201_CREATED)
async def create_media(
    media_create: MediaCreate,
    service: MediaService = Depends(get_media_service),
) -> MediaRead:
    try:
        media = await service.create_media(media_create)
    except MediaConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except MediaUploadValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except MediaStorageUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return MediaRead.model_validate(media)


@router.get("/{media_id}", response_model=MediaRead)
async def get_media(
    media_id: uuid.UUID,
    service: MediaService = Depends(get_media_service),
) -> MediaRead:
    media = await service.get_media(media_id)
    if media is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    return MediaRead.model_validate(media)


@router.patch("/{media_id}", response_model=MediaRead)
async def update_media(
    media_id: uuid.UUID,
    media_update: MediaUpdate,
    service: MediaService = Depends(get_media_service),
) -> MediaRead:
    try:
        media = await service.update_media(media_id, media_update)
    except MediaConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    if media is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    return MediaRead.model_validate(media)


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    media_id: uuid.UUID,
    service: MediaService = Depends(get_media_service),
) -> Response:
    deleted = await service.delete_media(media_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
