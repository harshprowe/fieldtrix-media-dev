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
from app.core.metrics import record_request_metrics

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
