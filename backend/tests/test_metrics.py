from app.core.metrics import is_media_playback_backend_hit, render_metrics


def test_media_playback_backend_hit_detects_media_file_request() -> None:
    assert (
        is_media_playback_backend_hit(
            method="GET",
            path="/api/v1/media/video.mp4",
            accept_header=None,
        )
        is True
    )


def test_media_playback_backend_hit_ignores_metadata_request() -> None:
    assert (
        is_media_playback_backend_hit(
            method="GET",
            path="/api/v1/media",
            accept_header="application/json",
        )
        is False
    )


def test_metrics_render_includes_playback_guardrail() -> None:
    content, content_type = render_metrics()

    assert b"media_playback_backend_hits" in content
    assert "text/plain" in content_type

