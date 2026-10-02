from typing import Annotated

from fastapi import APIRouter, Depends, Request

from qunxue_api.api.contracts.personal_graph import PersonalGraphResponse
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.personal_graph import PersonalGraphApplication

router = APIRouter(prefix="/api/personal-graph", tags=["personal-graph"])


def application(request: Request):
    with request.app.state.personal_graph_scope() as value:
        yield value


Application = Annotated[PersonalGraphApplication, Depends(application)]


@router.get("", response_model=PersonalGraphResponse, operation_id="get_personal_graph")
def get_graph(current: CurrentSessionDependency, app: Application):
    return app.read(current.user.user_id)


@router.post(
    "/refresh", response_model=PersonalGraphResponse, operation_id="refresh_personal_graph"
)
def refresh_graph(current: CurrentSessionDependency, app: Application, _key: IdempotencyKey):
    return app.refresh(current.user.user_id)
