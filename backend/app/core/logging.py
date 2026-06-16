from __future__ import annotations

import time
import uuid
from logging import getLevelName
from collections.abc import Callable
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from structlog.types import EventDict

from app.core.config import settings
from app.core.metrics import is_media_playback_backend_hit, record_request_metrics

logger = structlog.get_logger("fieldtrix")


def _drop_none_values(_: Any, __: str, event_dict: EventDict) -> EventDict:
    return {key: value for key, value in event_dict.items() if value is not None}


def configure_logging() -> None:
    minimum_level = getLevelName(settings.log_level.upper())
    if not isinstance(minimum_level, int):
        minimum_level = getLevelName("INFO")

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.add_log_level,
            _drop_none_values,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(minimum_level),
        cache_logger_on_first_use=True,
    )


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Any]) -> Response:
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        start_time = time.perf_counter()

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_seconds = time.perf_counter() - start_time
            duration_ms = round(duration_seconds * 1000, 2)
            status_code = response.status_code if response is not None else 500
            endpoint = _resolve_endpoint_name(request)
            path = request.url.path
            playback_backend_hit = is_media_playback_backend_hit(
                method=request.method,
                path=path,
                accept_header=request.headers.get("accept"),
            )
            request_purpose = _classify_request_purpose(
                method=request.method,
                path=path,
                endpoint=endpoint,
                playback_backend_hit=playback_backend_hit,
            )
            record_request_metrics(
                method=request.method,
                endpoint=endpoint,
                path=path,
                status_code=status_code,
                duration_seconds=duration_seconds,
                accept_header=request.headers.get("accept"),
            )
            logger.info(
                "http.request",
                method=request.method,
                path=path,
                endpoint=endpoint,
                request_purpose=request_purpose,
                backend_hit_type=_classify_backend_hit_type(request_purpose),
                is_media_playback_backend_hit=playback_backend_hit,
                query=str(request.url.query) or None,
                status_code=status_code,
                duration_ms=duration_ms,
                client_host=request.client.host if request.client else None,
            )
            if response is not None:
                response.headers["X-Request-ID"] = request_id


def _resolve_endpoint_name(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str):
        return path
    return "unmatched"


def _classify_backend_hit_type(request_purpose: str) -> str:
    if request_purpose == "media_playback_backend_hit":
        return "unexpected_playback"
    if request_purpose in {"media_cdn_upload_url", "media_metadata_create", "media_metadata_read"}:
        return "expected_metadata"
    if request_purpose in {"health_check", "metrics_scrape"}:
        return "observability"
    if request_purpose == "auth":
        return "authentication"
    return "other"


def _classify_request_purpose(
    *,
    method: str,
    path: str,
    endpoint: str,
    playback_backend_hit: bool,
) -> str:
    if playback_backend_hit:
        return "media_playback_backend_hit"

    normalized_method = method.upper()
    normalized_path = path.rstrip("/")

    if normalized_path.endswith("/metrics"):
        return "metrics_scrape"
    if "/health" in normalized_path:
        return "health_check"
    if "/auth" in normalized_path:
        return "auth"
    if normalized_path.endswith("/media/upload-url") and normalized_method == "POST":
        return "media_cdn_upload_url"
    if normalized_path.endswith("/media") and normalized_method == "POST":
        return "media_metadata_create"
    if "/media" in normalized_path and normalized_method in {"GET", "HEAD"}:
        return "media_metadata_read"
    if "/media" in normalized_path and normalized_method in {"PATCH", "DELETE"}:
        return "media_metadata_write"
    if endpoint == "unmatched":
        return "unmatched"
    return "api_request"
