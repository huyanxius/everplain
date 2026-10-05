from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from qunxue_api.api.contracts.agent_profile import AgentProfileResponse, AgentProfileUpdate
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.agent_profile import AgentProfileApplication
from qunxue_api.modules.agent_profile import ProfileConflict

router = APIRouter(prefix="/api/agent-profile", tags=["agent-profile"])


def application(request: Request):
    with request.app.state.agent_profile_scope() as value:
        yield value


Application = Annotated[AgentProfileApplication, Depends(application)]


def response(app, user_id, profile):
    values = asdict(profile)
    values.pop("user_id")
    values.pop("memory_ids")
    return AgentProfileResponse(**values, greeting=app.greeting(user_id))


@router.get("", response_model=AgentProfileResponse, operation_id="get_agent_profile")
def get_profile(current: CurrentSessionDependency, app: Application):
    user_id = current.user.user_id
    return response(app, user_id, app.get(user_id))


@router.patch("", response_model=AgentProfileResponse, operation_id="update_agent_profile")
def update_profile(
    payload: AgentProfileUpdate,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    user_id = current.user.user_id
    changes = payload.model_dump(exclude_none=True, exclude={"expected_version"})
    if "user_avatar" in payload.model_fields_set:
        # Omission preserves the selection; an explicit null turns it off.
        changes["user_avatar"] = payload.user_avatar
    try:
        profile = app.update(
            user_id, expected_version=payload.expected_version, changes=changes, request_key=key
        )
    except ProfileConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return response(app, user_id, profile)
