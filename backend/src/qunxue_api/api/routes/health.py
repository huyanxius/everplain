from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from qunxue_api.api.contracts.common import (
    ErrorResponse,
)
from qunxue_api.api.contracts.health import HealthResponse
from qunxue_api.settings import Settings

router = APIRouter(
    prefix="/api",
    tags=["system"],
    responses={422: {"model": ErrorResponse}},
)


@router.get(
    "/health",
    operation_id="get_health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse | ErrorResponse}},
)
def get_health(request: Request) -> HealthResponse | JSONResponse:
    settings: Settings = request.app.state.settings
    request.app.state.database.is_ready()
    descriptor = request.app.state.model_gateway.descriptor
    runtime_mode = descriptor.capability_tier
    model_router = request.app.state.model_router
    if runtime_mode == "mock":
        model_status = "degraded" if settings.allow_model_fallback else "healthy"
    elif model_router is None:
        model_status = "unknown"
    else:
        snapshot_status = model_router.health_snapshot().status
        model_status = {
            "unhealthy": "unavailable",
            "recovering": "degraded",
        }.get(snapshot_status, snapshot_status)
    model_provider = request.app.state.model_provider
    health = HealthResponse(
        status="ok",
        service=settings.app_name,
        runtime_mode=runtime_mode,
        provider=descriptor.provider,
        model_version=descriptor.model_version,
        persistence="sqlite",
        contract_version=settings.contract_version,
        capability=descriptor.capability_tier,
        knowledge_release_id=None,
        model_status=model_status,
        model_checked_at=getattr(model_provider, "health_checked_at", None),
        release_revision=settings.release_revision,
    )
    if model_status == "unavailable":
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=health.model_dump(mode="json"),
        )
    return health
