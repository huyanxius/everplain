from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse, Response

from qunxue_api.api.contracts.common import ErrorCode, ErrorDetail, ErrorResponse
from qunxue_api.api.contracts.research_exchange import (
    ResearchAuditEventListResponse,
    ResearchAuditEventResponse,
)
from qunxue_api.api.dependencies import (
    CurrentSessionDependency,
    OwnedResearchTaskDependency,
    ResearchProjectExchangeApplicationDependency,
)
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application import ResearchExchangeIdempotencyConflict

router = APIRouter(
    prefix="/api/research-tasks/{task_id}/exchange",
    tags=["research-project-exchange"],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)


def _error(status_code: int, code: ErrorCode, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorDetail(code=code, message=message, trace_id=str(uuid4())))
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


@router.post(
    "/archive",
    operation_id="export_research_project_archive",
    response_class=Response,
    response_model=None,
    responses={
        200: {
            "description": "A BagIt research archive containing QDPX and native recovery data.",
            "content": {
                "application/zip": {
                    "schema": {"type": "string", "format": "binary"},
                }
            },
        },
        409: {"model": ErrorResponse},
    },
)
def export_research_project_archive(
    task_id: UUID,
    task: OwnedResearchTaskDependency,
    current: CurrentSessionDependency,
    application: ResearchProjectExchangeApplicationDependency,
    idempotency_key: IdempotencyKey,
) -> Response | JSONResponse:
    try:
        exported = application.export_archive(
            user_id=current.user.user_id,
            task_id=task_id,
            idempotency_key=idempotency_key,
        )
    except ResearchExchangeIdempotencyConflict as error:
        return _error(status.HTTP_409_CONFLICT, ErrorCode.IDEMPOTENCY_CONFLICT, str(error))
    filename = quote(f"{task.project_title or 'research-project'}.zip")
    losses = exported.report.losses
    return Response(
        content=exported.archive.payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "X-Qunxue-Exchange-Id": str(exported.exchange.exchange_id),
            "X-Qunxue-Artifact-SHA256": exported.archive.sha256,
            "X-Qunxue-Exchange-Loss-Count": str(len(losses)),
            "X-Qunxue-Exchange-Blocking-Loss-Count": str(
                sum(loss.severity.value == "blocking" for loss in losses)
            ),
        },
    )


@router.get(
    "/audit",
    operation_id="list_research_project_audit_events",
    response_model=ResearchAuditEventListResponse,
)
def list_research_project_audit_events(
    task_id: UUID,
    _task: OwnedResearchTaskDependency,
    current: CurrentSessionDependency,
    application: ResearchProjectExchangeApplicationDependency,
) -> ResearchAuditEventListResponse:
    events = application.list_audit_events(
        user_id=current.user.user_id,
        task_id=task_id,
    )
    return ResearchAuditEventListResponse(
        task_id=task_id,
        items=[ResearchAuditEventResponse.from_domain(event) for event in events],
    )
