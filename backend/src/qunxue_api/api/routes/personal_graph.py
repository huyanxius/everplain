from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from qunxue_api.api.contracts.agent import KnowledgeIndexChoiceResponse
from qunxue_api.api.contracts.personal_graph import (
    PersonalGraphRefreshRequest,
    PersonalGraphResponse,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.personal_graph import PersonalGraphApplication

router = APIRouter(prefix="/api/personal-graph", tags=["personal-graph"])


def application(request: Request):
    with request.app.state.personal_graph_scope() as value:
        yield value


Application = Annotated[PersonalGraphApplication, Depends(application)]


@router.get("", response_model=PersonalGraphResponse, operation_id="get_personal_graph")
def get_graph(current: CurrentSessionDependency, app: Application, request: Request):
    with request.app.state.disciplinary_agent_scope() as agent:
        readiness = agent.knowledge_index_status(user_id=current.user.user_id, purpose="graph")
    return {**app.read(current.user.user_id), "knowledge_index_status": readiness}


@router.post(
    "/refresh",
    response_model=PersonalGraphResponse,
    operation_id="refresh_personal_graph",
    responses={409: {"model": KnowledgeIndexChoiceResponse}},
)
def refresh_graph(
    current: CurrentSessionDependency,
    app: Application,
    _key: IdempotencyKey,
    request: Request,
    payload: PersonalGraphRefreshRequest | None = None,
):
    with request.app.state.disciplinary_agent_scope() as agent:
        readiness = agent.knowledge_index_status(user_id=current.user.user_id, purpose="graph")
    if readiness["missing_count"] and (payload is None or payload.knowledge_index_action is None):
        return JSONResponse(
            status_code=409,
            content={
                "code": "knowledge_index_choice_required",
                "status": readiness,
            },
        )
    graph = app.refresh(
        current.user.user_id, eligible_document_ids=set(readiness["ready_document_ids"])
    )
    return {**graph, "knowledge_index_status": readiness}
