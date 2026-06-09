from fastapi import APIRouter, Response

from app.core.metrics import render_metrics

router = APIRouter()


@router.get("/metrics", include_in_schema=False)
async def prometheus_metrics() -> Response:
    content, media_type = render_metrics()
    return Response(content=content, media_type=media_type)

