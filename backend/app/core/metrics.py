from __future__ import annotations

from collections.abc import Iterable

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

MEDIA_PLAYBACK_EXTENSIONS = (
    ".aac",
    ".avi",
    ".flac",
    ".gif",
    ".jpeg",
    ".jpg",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".ogg",
    ".pdf",
    ".png",
    ".svg",
    ".wav",
    ".webm",
    ".webp",
)

HTTP_REQUESTS_TOTAL = Counter(
    "fieldtrix_http_requests_total",
    "Total HTTP requests handled by the backend.",
    ("method", "endpoint", "status_code"),
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "fieldtrix_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "endpoint"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)

HTTP_ERRORS_TOTAL = Counter(
    "fieldtrix_http_errors_total",
    "Total HTTP responses with status code >= 500.",
    ("method", "endpoint", "status_code"),
)

HTTP_ENDPOINT_DISTRIBUTION_TOTAL = Counter(
    "fieldtrix_http_endpoint_distribution_total",
    "Request distribution by endpoint.",
    ("endpoint",),
)

MEDIA_PLAYBACK_BACKEND_HITS = Gauge(
    "media_playback_backend_hits",
    "Requests that look like media playback attempts through FastAPI. This should remain zero.",
)
MEDIA_PLAYBACK_BACKEND_HITS.set(0)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST


def record_request_metrics(
    *,
    method: str,
    endpoint: str,
    path: str,
    status_code: int,
    duration_seconds: float,
    accept_header: str | None,
) -> None:
    status = str(status_code)
    HTTP_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint, status_code=status).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, endpoint=endpoint).observe(duration_seconds)
    HTTP_ENDPOINT_DISTRIBUTION_TOTAL.labels(endpoint=endpoint).inc()

    if status_code >= 500:
        HTTP_ERRORS_TOTAL.labels(method=method, endpoint=endpoint, status_code=status).inc()

    if is_media_playback_backend_hit(method=method, path=path, accept_header=accept_header):
        MEDIA_PLAYBACK_BACKEND_HITS.inc()


def is_media_playback_backend_hit(*, method: str, path: str, accept_header: str | None) -> bool:
    if method.upper() not in {"GET", "HEAD"}:
        return False
    if _has_media_file_extension(path, MEDIA_PLAYBACK_EXTENSIONS):
        return True
    if accept_header is None:
        return False
    return any(media_type in accept_header.lower() for media_type in ("video/", "audio/"))


def _has_media_file_extension(path: str, extensions: Iterable[str]) -> bool:
    normalized_path = path.lower().split("?", maxsplit=1)[0]
    return any(normalized_path.endswith(extension) for extension in extensions)

