import asyncio
import json
import logging
import threading
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from qunxue_api.api.billing_errors import billing_error
from qunxue_api.api.contracts.agent import (
    AgentCanvasNodeEditRequest,
    AgentCitationResponse,
    AgentConversationListResponse,
    AgentConversationResponse,
    AgentConversationSummaryResponse,
    AgentConversationUpdateRequest,
    AgentMaterialContextRequest,
    AgentMaterialContextResponse,
    AgentMessageResponse,
    AgentModelCatalogResponse,
    AgentModelChoiceResponse,
    AgentOutputAttemptResponse,
    AgentResearchJourneyResponse,
    AgentRunLookupResponse,
    AgentRunRecoveryResponse,
    AgentRunStopResponse,
    AgentTurnRequest,
    AgentTurnResponse,
    ConfirmResearchStartRequest,
    ConfirmResearchStartResponse,
    ConversationSummaryResponse,
    KnowledgeIndexRepairRequest,
    KnowledgeIndexStatusResponse,
    RecentConversationContextsResponse,
    ResearchStartProposalResponse,
)
from qunxue_api.api.contracts.common import ErrorCode, ErrorDetail, ErrorResponse
from qunxue_api.api.contracts.research_materials import AgentMaterialListResponse
from qunxue_api.api.dependencies import (
    CurrentSessionDependency,
    ResearchMaterialApplicationDependency,
)
from qunxue_api.api.routes.research_materials import _material_response
from qunxue_api.api.routes.research_tasks import _match_status, _navigation_response
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.modules.agent_conversation import (
    AgentInterrupted,
    AgentModelRouteFailure,
    AgentModelSelectionUnavailable,
    AgentOutputStorageFailure,
    AgentToolEvent,
    AgentWritingPreviewEvent,
    CanvasEditConflict,
    ContextSuggestionUnavailable,
    ConversationNotFound,
    ConversationTaskBindingConflict,
    ResearchMaterialCitationUnavailable,
    RunAlreadyActive,
    display_card,
    resolve_agent_model_selection,
)
from qunxue_api.modules.billing import BillingFailure, CreditRunInProgress, CreditsDepleted
from qunxue_api.modules.knowledge_catalog import RetrievalPipelineUnavailable
from qunxue_api.modules.research_intake import ResearchStartProposalStatus
from qunxue_api.modules.shared_knowledge import (
    find_knowledge_index_choice,
)

router = APIRouter(
    prefix="/api/agent",
    tags=["agent"],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
logger = logging.getLogger(__name__)
AgentRuntimeMode = Literal["mock", "base", "sft"]
_SSE_HEARTBEAT_SECONDS = 5.0
_ACTIVE_RUNS_LOCK = threading.Lock()
_ACTIVE_RUN_CANCEL_EVENTS: dict[tuple[UUID, UUID], threading.Event] = {}


def _register_active_run(
    user_id: UUID,
    run_id: UUID,
    cancel_event: threading.Event,
) -> None:
    with _ACTIVE_RUNS_LOCK:
        _ACTIVE_RUN_CANCEL_EVENTS[(user_id, run_id)] = cancel_event


def _cancel_active_run(user_id: UUID, run_id: UUID) -> bool:
    with _ACTIVE_RUNS_LOCK:
        cancel_event = _ACTIVE_RUN_CANCEL_EVENTS.get((user_id, run_id))
    if cancel_event is None:
        return False
    cancel_event.set()
    return True


def _release_active_run(
    user_id: UUID,
    run_id: UUID,
    cancel_event: threading.Event,
) -> None:
    with _ACTIVE_RUNS_LOCK:
        key = (user_id, run_id)
        if _ACTIVE_RUN_CANCEL_EVENTS.get(key) is cancel_event:
            _ACTIVE_RUN_CANCEL_EVENTS.pop(key, None)


def _effective_agent_runtime_mode(request: Request) -> AgentRuntimeMode:
    """Expose the runtime actually selected for the independent Agent runner.

    The Agent deliberately has its own API-key override and does not use the
    legacy model gateway reported by ``/api/health``.  Keeping this decision at
    the route boundary prevents the frontend from labeling an API-key-backed
    run as a deterministic preview just because the legacy gateway remains in
    its zero-config ``mock`` mode.
    """
    settings = request.app.state.settings
    if settings.runtime_mode != "mock":
        return settings.runtime_mode
    return "base" if settings.has_model_api_key else "mock"


@router.get("/recent-context", response_model=RecentConversationContextsResponse,
            operation_id="list_recent_conversation_context")
def list_recent_conversation_context(request: Request, current: CurrentSessionDependency,
                                     response: Response) -> RecentConversationContextsResponse:
    response.headers["Cache-Control"] = "private, no-store"
    with request.app.state.conversation_context_scope() as (repository, _):
        return RecentConversationContextsResponse(items=repository.recent(current.user.user_id))


@router.get("/context-summary", response_model=ConversationSummaryResponse,
            operation_id="read_conversation_summary")
def read_conversation_summary(request: Request, current: CurrentSessionDependency,
                              response: Response) -> ConversationSummaryResponse:
    response.headers["Cache-Control"] = "private, no-store"
    worker = request.app.state.context_summary_worker
    with request.app.state.context_summary_scope() as repository:
        result = repository.read(
            current.user.user_id, idle_seconds=worker.idle_seconds,
            daily_calls=worker.daily_calls, daily_tokens=worker.daily_tokens,
            reservation_estimator=worker.reservation_estimator(),
        )
    if result["status"] in {"pending", "failed"} and worker.generate is None:
        # No configured background generator means no awaited result can arrive.
        result["status"] = "failed"
        result["status_reason"] = "generator_unavailable"
        result["retry_at"] = None
    return ConversationSummaryResponse(**result)


@router.post(
    "/material-context",
    response_model=AgentMaterialContextResponse,
    operation_id="prepare_agent_material_context",
)
def prepare_agent_material_context(
    payload: AgentMaterialContextRequest,
    request: Request,
    current: CurrentSessionDependency,
    idempotency_key: IdempotencyKey,
) -> AgentMaterialContextResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        conversation_id, task_id = app.prepare_material_context(
            user_id=current.user.user_id,
            conversation_id=payload.conversation_id,
            idempotency_key=idempotency_key,
        )
        return AgentMaterialContextResponse(conversation_id=conversation_id, task_id=task_id)


@router.get(
    "/materials", response_model=AgentMaterialListResponse, operation_id="list_agent_materials"
)
def list_agent_materials(
    current: CurrentSessionDependency,
    application: ResearchMaterialApplicationDependency,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> AgentMaterialListResponse:
    return AgentMaterialListResponse(
        items=[
            _material_response(application, item)
            for item in application.list_owned(
                user_id=current.user.user_id, limit=limit, offset=offset
            )
        ]
    )


@router.get(
    "/conversations",
    response_model=AgentConversationListResponse,
    operation_id="list_agent_conversations",
)
def list_agent_conversations(
    request: Request, current: CurrentSessionDependency
) -> AgentConversationListResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        return AgentConversationListResponse(
            items=[_summary(item) for item in app.list_conversations(user_id=current.user.user_id)]
        )


@router.get(
    "/conversations/{conversation_id}",
    response_model=AgentConversationResponse,
    operation_id="get_agent_conversation",
)
def get_agent_conversation(
    conversation_id: UUID,
    request: Request,
    current: CurrentSessionDependency,
) -> AgentConversationResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        conversation = app.get_conversation(
            user_id=current.user.user_id,
            conversation_id=conversation_id,
        )
        return _conversation(
            conversation,
            release_ids=app.release_ids_by_turn(
                user_id=current.user.user_id,
                conversation_id=conversation_id,
            ),
        )


@router.patch(
    "/conversations/{conversation_id}",
    response_model=AgentConversationSummaryResponse,
    operation_id="update_agent_conversation",
)
def update_agent_conversation(
    conversation_id: UUID,
    payload: AgentConversationUpdateRequest,
    request: Request,
    current: CurrentSessionDependency,
    _idempotency_key: IdempotencyKey,
) -> AgentConversationSummaryResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        return _summary(
            app.rename_conversation(
                user_id=current.user.user_id,
                conversation_id=conversation_id,
                title=payload.title,
            )
        )


@router.patch(
    "/conversations/{conversation_id}/research-map/nodes/{node_id}",
    response_model=AgentConversationResponse,
    operation_id="edit_agent_canvas_node",
    responses={409: {"model": ErrorResponse}},
)
def edit_agent_canvas_node(
    conversation_id: UUID,
    node_id: str,
    payload: AgentCanvasNodeEditRequest,
    request: Request,
    current: CurrentSessionDependency,
    _idempotency_key: IdempotencyKey,
) -> AgentConversationResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        try:
            result = app.edit_canvas_node(
                user_id=current.user.user_id,
                conversation_id=conversation_id,
                node_id=node_id,
                **payload.model_dump(),
            )
        except CanvasEditConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return _conversation(
            result,
            release_ids=app.release_ids_by_turn(
                user_id=current.user.user_id,
                conversation_id=conversation_id,
            ),
        )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="delete_agent_conversation",
)
def delete_agent_conversation(
    conversation_id: UUID,
    request: Request,
    current: CurrentSessionDependency,
    _idempotency_key: IdempotencyKey,
) -> None:
    with request.app.state.disciplinary_agent_scope() as app:
        app.delete_conversation(
            user_id=current.user.user_id,
            conversation_id=conversation_id,
        )


@router.get(
    "/conversations/{conversation_id}/research-start-proposal",
    response_model=ResearchStartProposalResponse,
    operation_id="get_agent_research_start_proposal",
)
def get_agent_research_start_proposal(
    conversation_id: UUID,
    request: Request,
    current: CurrentSessionDependency,
) -> ResearchStartProposalResponse:
    with request.app.state.research_start_application_scope() as application:
        proposal = application.get_conversation_proposal(
            user_id=current.user.user_id,
            conversation_id=conversation_id,
        )
        return ResearchStartProposalResponse.from_domain(proposal)


@router.get(
    "/conversations/{conversation_id}/journey",
    response_model=AgentResearchJourneyResponse,
    operation_id="get_agent_research_journey",
)
def get_agent_research_journey(
    conversation_id: UUID,
    request: Request,
    current: CurrentSessionDependency,
) -> AgentResearchJourneyResponse:
    with request.app.state.research_start_application_scope() as application:
        journey = application.get_journey(
            user_id=current.user.user_id,
            conversation_id=conversation_id,
        )
        match_status = None
        if journey.task is not None:
            with request.app.state.research_navigation_match_reader_scope() as matches:
                match_status = _match_status(matches, journey.task)
        return AgentResearchJourneyResponse(
            conversation_id=journey.conversation_id,
            status=(
                "proposal_pending"
                if journey.proposal is not None
                and journey.proposal.status is ResearchStartProposalStatus.PENDING_CONFIRMATION
                else "task_bound"
                if journey.task is not None
                else "collecting"
            ),
            task_id=journey.task.task_id if journey.task is not None else None,
            proposal=(
                ResearchStartProposalResponse.from_domain(journey.proposal)
                if journey.proposal is not None
                else None
            ),
            navigation=(
                _navigation_response(
                    journey.task,
                    journey.progress,
                    match_status=match_status,
                )
                if journey.task is not None and journey.progress is not None
                else None
            ),
        )


@router.post(
    "/research-start-proposals/{proposal_id}/confirm",
    response_model=ConfirmResearchStartResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="confirm_agent_research_start",
    responses={409: {"model": ErrorResponse}},
)
def confirm_agent_research_start(
    proposal_id: UUID,
    payload: ConfirmResearchStartRequest,
    request: Request,
    current: CurrentSessionDependency,
    idempotency_key: IdempotencyKey,
) -> ConfirmResearchStartResponse:
    with request.app.state.research_start_application_scope() as application:
        result = application.confirm(
            user_id=current.user.user_id,
            proposal_id=proposal_id,
            idempotency_key=idempotency_key,
            expected_version=payload.expected_version,
            phenomenon=payload.phenomenon,
            research_intent=payload.research_intent,
            context=payload.context,
        )
        return ConfirmResearchStartResponse(
            conversation_id=result.proposal.conversation_id,
            status="task_bound",
            task_id=result.task.task_id,
            proposal=ResearchStartProposalResponse.from_domain(result.proposal),
            navigation=_navigation_response(result.task, result.progress),
        )


@router.get("/models", response_model=AgentModelCatalogResponse, operation_id="list_agent_models")
def list_agent_models(
    request: Request,
    current: CurrentSessionDependency,
) -> AgentModelCatalogResponse:
    return AgentModelCatalogResponse(
        runtime_mode=_effective_agent_runtime_mode(request),
        items=[
            AgentModelChoiceResponse(
                model_id=choice.model_id,
                label=choice.label,
                reasoning_efforts=list(choice.reasoning_efforts),
                default_reasoning_effort=choice.default_reasoning_effort,
            )
            for choice in getattr(request.app.state, "agent_model_choices", ())
        ],
    )


@router.get(
    "/knowledge-index-status", response_model=KnowledgeIndexStatusResponse,
    operation_id="get_agent_knowledge_index_status",
)
def get_agent_knowledge_index_status(
    request: Request, current: CurrentSessionDependency,
    reference_knowledge_base_id: UUID | None = None,
    purpose: Literal["search", "graph"] = "search",
):
    with request.app.state.disciplinary_agent_scope() as app:
        return app.knowledge_index_status(
            user_id=current.user.user_id, kb_id=reference_knowledge_base_id, purpose=purpose
        )


@router.post(
    "/knowledge-index-repairs", response_model=KnowledgeIndexStatusResponse,
    operation_id="repair_agent_knowledge_index", status_code=202,
)
def repair_agent_knowledge_index(
    payload: KnowledgeIndexRepairRequest, request: Request,
    current: CurrentSessionDependency, _idempotency_key: IdempotencyKey,
):
    with request.app.state.disciplinary_agent_scope() as app:
        try:
            return app.repair_knowledge_indexes(
                user_id=current.user.user_id,
                documents=[item.model_dump() for item in payload.documents],
                idempotency_key=_idempotency_key,
                kb_id=payload.reference_knowledge_base_id, purpose=payload.purpose,
            )
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error


@router.post(
    "/turns",
    status_code=status.HTTP_200_OK,
    operation_id="stream_agent_turn",
    response_class=StreamingResponse,
    responses={
        409: {"model": ErrorResponse},
        200: {
            "description": "Server-sent Agent events",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
)
def stream_agent_turn(
    payload: AgentTurnRequest,
    request: Request,
    current: CurrentSessionDependency,
    idempotency_key: IdempotencyKey,
) -> Response:
    try:
        resolve_agent_model_selection(
            payload.model_id, payload.reasoning_effort,
            getattr(request.app.state, "agent_model_choices", ()),
        )
    except AgentModelSelectionUnavailable as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    user_id = current.user.user_id
    runtime_mode = _effective_agent_runtime_mode(request)
    with request.app.state.disciplinary_agent_scope() as app:
        existing = app.find_run(user_id=user_id, idempotency_key=idempotency_key)
    if existing is not None and payload.conversation_id not in {None, existing.conversation_id}:
        raise HTTPException(status_code=409, detail="请求标识已属于另一段对话。")
    # POST is an explicit execution command. Already-active/completed requests
    # observe that generation; they never wait for its failure and then execute it.
    if existing is not None and (
        existing.status == "completed" or (
            existing.status == "running" and existing.lease_expires_at is not None
            and existing.lease_expires_at > datetime.now(UTC)
        )
    ):
        return _run_event_response(
            request, user_id, existing.run_id,
            after=existing.last_event_sequence if existing.status == "running" else 0,
            replay_completed=existing.status == "completed", snapshot_first=True,
        )

    if payload.context_suggestion is not None or (
        existing is not None and existing.request_snapshot.get("context_suggestion")
    ):
        with request.app.state.disciplinary_agent_scope() as app:
            try:
                app.resolve_context_suggestion(
                    user_id=user_id,
                    selection=(payload.context_suggestion.model_dump()
                               if payload.context_suggestion else None),
                    existing_run=existing,
                )
            except ContextSuggestionUnavailable:
                body = ErrorResponse(error=ErrorDetail(
                    code=ErrorCode.CONFLICT,
                    message="这张背景卡已更新或来源不可访问，请重新选择。",
                    trace_id=str(uuid4()),
                ))
                return JSONResponse(status_code=409, content=body.model_dump(mode="json"))
    after = existing.last_event_sequence if existing is not None else 0
    ready = threading.Event()
    finished = threading.Event()
    cancel_event = threading.Event()
    identity: dict[str, object] = {}
    startup_failure: list[tuple[str, dict[str, object]]] = []
    unsaved_body: list[str] = []
    unsaved_delivery_state: list[dict[str, object]] = []
    terminal_failure: list[tuple[str, dict[str, object]]] = []

    def on_delta(delta: str, *, persisted: bool = True, answer: str | None = None) -> None:
        if not persisted:
            # Presentation-only fallback for this live subscription. It is not
            # a durable replay cursor or a second persistence/scheduling engine.
            unsaved_body[:] = [answer if answer is not None else delta]

    def publish(name: str, body: dict[str, object]) -> None:
        run_id = identity.get("run_id")
        attempt_id = identity.get("attempt_id")
        if not isinstance(run_id, UUID) or not isinstance(attempt_id, str):
            return
        with request.app.state.disciplinary_agent_scope() as app:
            event = app.append_output_event(user_id=user_id, run_id=run_id,
                                           attempt_id=attempt_id, name=name, payload=body)
        if event is None:
            raise AgentInterrupted("Agent execution lease was replaced")

    def renew_execution_lease() -> None:
        # Retain the existing execution lease while no browser is subscribed.
        # This is transitional supervision of the current worker, not durable
        # workflow recovery or a second scheduling/lease engine.
        while not finished.wait(_SSE_HEARTBEAT_SECONDS):
            run_id = identity.get("run_id")
            if not isinstance(run_id, UUID):
                continue
            try:
                with request.app.state.disciplinary_agent_scope() as app:
                    cancelled = app.heartbeat(user_id=user_id, run_id=run_id,
                                              lease_token=identity.get("attempt_id"))
                if cancelled:
                    cancel_event.set()
                    return
            except Exception:
                logger.exception("Agent execution lease renewal failed")
                cancel_event.set()
                return

    def on_run_started(run_id: UUID, conversation_id: UUID, replayed: bool,
                       *, lease_token: str | None = None) -> None:
        identity.update(run_id=run_id, attempt_id=lease_token, conversation_id=conversation_id)
        if not replayed:
            _register_active_run(user_id, run_id, cancel_event)
        with request.app.state.disciplinary_agent_scope() as app:
            run = app.find_run_by_id(user_id=user_id, run_id=run_id)
        if run is not None and lease_token is None:
            identity["attempt_id"] = run.lease_token
        publish("agent_status", {"status": "thinking"})
        publish("turn_started", {
            "conversation_id": str(conversation_id), "run_id": str(run_id),
            "attempt_id": identity.get("attempt_id"), "replayed": replayed,
            "runtime_mode": runtime_mode,
            "output_attempts": [_output_attempt(item).model_dump(mode="json")
                                for item in (run.output_attempts if run else ())],
        })
        ready.set()
        threading.Thread(target=renew_execution_lease, daemon=True).start()

    def on_tool_event(event: AgentToolEvent) -> None:
        body: dict[str, object] = {"tool": event.tool, "call_id": event.call_id}
        for name in ("input", "output", "detail"):
            value = getattr(event, name)
            if value is not None:
                body[name] = dict(value) if name == "input" else value
        if event.error is not None:
            body.update(message=event.detail or "工具调用失败", error_code=event.error)
        publish(f"tool_{event.phase}", body)
        if (event.tool == "update_research_map" and event.phase == "finished"
                and isinstance(event.output, dict) and event.output.get("schema_version") == 1):
            publish("canvas_patch", event.output)

    def on_writing_preview(event: AgentWritingPreviewEvent) -> None:
        publish("writing_preview", {"type": "writing_preview", **{
            key: value for key, value in asdict(event).items() if value is not None
        }})

    def run_agent() -> None:
        try:
            with request.app.state.disciplinary_agent_scope() as app:
                execution = app.run_turn(
                    user_id=user_id, conversation_id=payload.conversation_id,
                    prompt=payload.message, idempotency_key=idempotency_key,
                    context_suggestion=(payload.context_suggestion.model_dump()
                                        if payload.context_suggestion else None),
                    workspace=payload.workspace, model_id=payload.model_id,
                    reasoning_effort=payload.reasoning_effort, web_search=payload.web_search,
                    task_id=payload.task_id, document_id=payload.document_id,
                    section_id=payload.section_id, document_version=payload.document_version,
                    writing_context=(payload.writing_context.model_dump(mode="json")
                                     if payload.writing_context else None),
                    theory_plan_id=payload.theory_plan_id, material_ids=payload.material_ids,
                    reference_knowledge_base_id=payload.reference_knowledge_base_id,
                    knowledge_index_action=payload.knowledge_index_action, mode=payload.mode,
                    deep_research_run_id=payload.deep_research_run_id,
                    deep_research_action=payload.deep_research_action,
                    deep_research_selection=payload.deep_research_selection,
                    on_run_started=on_run_started, on_delta=on_delta,
                    on_tool_event=on_tool_event, on_writing_preview=on_writing_preview,
                    on_research_event=lambda event: publish(
                        f"research_{event.kind}", dict(event.payload)),
                    is_cancelled=cancel_event.is_set,
                )
            delivery_state = getattr(execution, "delivery_state", {})
            if delivery_state:
                try:
                    publish("agent_delivery_state", delivery_state)
                except Exception:
                    unsaved_delivery_state.append(delivery_state)
            if getattr(execution, "incomplete_reason", None) == "length":
                publish("turn_interrupted", {
                    "code": "output_truncated",
                    "message": "模型本次输出达到上游长度限制，已收到的正文已保存，可以继续本轮。",
                })
            elif execution.pending_research is not None:
                publish("research_waiting", {"run_id": str(execution.run_id),
                                             **execution.pending_research})
            else:
                for citation in execution.result.citations:
                    publish("citation_added", _citation(citation))
                publish("turn_completed", {
                    "conversation": _conversation(
                        execution.conversation,
                        tool_summaries={execution.turn.turn_id: execution.tool_summary}
                        if execution.turn is not None else {},
                        release_ids={execution.turn.turn_id: execution.result.release_id}
                        if execution.turn is not None else {},
                    ).model_dump(mode="json"),
                    "knowledge_release_id": execution.result.release_id,
                    "delivery_state": delivery_state,
                })
        except RunAlreadyActive:
            # A competing POST may win admission. Attach once; no polling loop
            # that can start a second provider attempt when the winner fails.
            with request.app.state.disciplinary_agent_scope() as app:
                run = app.find_run(user_id=user_id, idempotency_key=idempotency_key)
            if run is None:
                startup_failure.append(_agent_failure(RunAlreadyActive("run")))
            else:
                identity["run_id"] = run.run_id
        except Exception as error:
            failure = _agent_failure(error)
            delivery_state = getattr(error, "agent_delivery_state", {})
            if identity.get("run_id") is None:
                startup_failure.append(failure)
            else:
                try:
                    if delivery_state:
                        try:
                            publish("agent_delivery_state", delivery_state)
                        except Exception:
                            unsaved_delivery_state.append(delivery_state)
                    publish(*failure)
                except Exception:
                    terminal_failure.append(failure)
                    logger.exception("Agent terminal event could not be journaled")
        finally:
            finished.set()
            ready.set()
            run_id = identity.get("run_id")
            if isinstance(run_id, UUID):
                _release_active_run(user_id, run_id, cancel_event)

    # Execution starts before response iteration, so lost headers/disconnect do
    # not prevent or cancel the command. Transport owns no model/tool worker.
    threading.Thread(target=run_agent, daemon=True).start()

    async def startup_events() -> AsyncIterator[str]:
        while not ready.is_set():
            await asyncio.sleep(0.02)
        if startup_failure:
            yield _event(*startup_failure[0])
            return
        run_id = identity.get("run_id")
        if isinstance(run_id, UUID):
            async for frame in _subscribe_run_events(
                request, user_id, run_id, after=after, unsaved_body=unsaved_body,
                terminal_failure=terminal_failure, worker_finished=finished,
                unsaved_delivery_state=unsaved_delivery_state, fallback_identity=identity,
            ):
                yield frame

    return StreamingResponse(startup_events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_TERMINAL_EVENT_NAMES = frozenset({"turn_completed", "turn_failed", "turn_interrupted",
                                   "research_waiting", "knowledge_index_choice_required"})


def _agent_failure(error: Exception) -> tuple[str, dict[str, object]]:
    if isinstance(error, ContextSuggestionUnavailable):
        return "turn_failed", {"code": error.code,
                               "message": "这张背景卡已更新或来源不可访问，请重新选择。"}
    if isinstance(error, AgentOutputStorageFailure):
        return "turn_failed", {
            "code": error.code,
            "message": "正文保存失败，已收到的文字仍保留在此页面；未保存部分无法保证恢复。",
        }
    if isinstance(error, ConversationNotFound):
        return "turn_failed", {"code": "not_found", "message": "对话不存在或无权访问。"}
    if isinstance(error, ConversationTaskBindingConflict):
        return "turn_failed", {"code": error.code,
                               "message": "该对话已属于另一个研究任务，无法读取当前任务材料。"}
    if isinstance(error, ResearchMaterialCitationUnavailable):
        return "turn_failed", {"code": error.code,
                               "message": "引用的个人研究材料已删除或不属于当前研究，本轮未保存。"}
    if isinstance(error, (RunAlreadyActive, CreditRunInProgress)):
        return "turn_failed", {
            "code": "run_in_progress", "message": "这段对话正在生成回答，请稍候。",
        }
    if isinstance(error, CreditsDepleted):
        return "turn_failed", {
            "code": "credits_depleted", "message": "额度已用尽，请等待 receipt",
        }
    if isinstance(error, AgentModelSelectionUnavailable):
        return "turn_failed", {"code": "model_selection_unavailable", "message": str(error)}
    if isinstance(error, AgentModelRouteFailure):
        messages = {
            "agent_input_limit": "本轮资料超出模型上下文上限，请缩小研究范围或新建对话后重试。",
            "agent_model_request_rejected": "模型服务拒绝了本轮请求，请稍后重试。",
            "agent_model_unavailable": "模型服务暂时不可用，请稍后重试。",
        }
        return "turn_failed", {
            "code": error.code,
            "message": messages.get(error.code, messages["agent_model_unavailable"]),
        }
    if isinstance(error, BillingFailure):
        _, code, message = billing_error(error)
        return "turn_failed", {"code": code, "message": message}
    if isinstance(error, AgentInterrupted):
        return "turn_interrupted", {"code": "interrupted",
                                    "message": "已暂停，已生成的内容已保存，可以继续。"}
    choice = find_knowledge_index_choice(error)
    if choice is not None:
        return "knowledge_index_choice_required", {"status": choice.status}
    if isinstance(error, RetrievalPipelineUnavailable):
        return "turn_failed", {"code": "retrieval_unavailable",
                               "message": "发布绑定的知识检索暂时不可用，本轮未生成研究回答。"}
    logger.error("Agent turn failed", exc_info=(type(error), error, error.__traceback__))
    return "turn_failed", {"code": "agent_unavailable",
                           "message": "Agent 暂时无法完成回答，请稍后重试。"}


def _run_event_response(request: Request, user_id: UUID, run_id: UUID, *, after: int,
                        replay_completed: bool = False,
                        snapshot_first: bool = False) -> StreamingResponse:
    return StreamingResponse(
        _subscribe_run_events(request, user_id, run_id, after=after,
                              replay_completed=replay_completed, snapshot_first=snapshot_first),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _subscribe_run_events(request: Request, user_id: UUID, run_id: UUID, *, after: int,
                                replay_completed: bool = False,
                                snapshot_first: bool = False,
                                unsaved_body: list[str] | None = None,
                                terminal_failure: list[tuple[str, dict[str, object]]] | None = None,
                                worker_finished: threading.Event | None = None,
                                unsaved_delivery_state: list[dict[str, object]] | None = None,
                                fallback_identity: dict[str, object] | None = None,
                                ) -> AsyncIterator[str]:
    unsaved_body = unsaved_body if unsaved_body is not None else []
    terminal_failure = terminal_failure if terminal_failure is not None else []
    unsaved_sent: str | None = None
    unsaved_metadata_sent = 0
    next_heartbeat = time.monotonic() + _SSE_HEARTBEAT_SECONDS
    while True:
        def read(cursor=after):
            with request.app.state.disciplinary_agent_scope() as app:
                run = app.find_run_by_id(user_id=user_id, run_id=run_id)
                events = app.read_output_events(user_id=user_id, run_id=run_id, after=cursor)
                conversation = (app.get_conversation(user_id=user_id,
                                                     conversation_id=run.conversation_id)
                                if run and run.status == "completed" else None)
                releases = (app.release_ids_by_turn(user_id=user_id,
                                                    conversation_id=run.conversation_id)
                            if conversation is not None else {})
                return run, events, conversation, releases

        read_error = None
        try:
            run, events, conversation, releases = await asyncio.to_thread(read)
        except Exception as error:
            read_error = error
            run, events, conversation, releases = None, (), None, {}
        def unsaved_frames(observed_run, cursor):
            nonlocal unsaved_sent
            if not unsaved_body or (observed_run is not None and observed_run.output_redacted):
                return
            text = unsaved_body[0]
            if text == unsaved_sent:
                return
            snapshot = _run_snapshot(observed_run) if observed_run is not None else {
                "run_id": str(run_id),
                "conversation_id": str((fallback_identity or {}).get("conversation_id", "")),
                "attempt_id": (fallback_identity or {}).get("attempt_id"),
                "status": "failed", "output_attempts": [],
            }
            # A complete current-attempt presentation snapshot avoids reversing
            # prior durable deltas or duplicating an ambiguously committed tail.
            # It carries no invented durable cursor/history or saved-body claim.
            snapshot.update(partial_answer=text, last_event_sequence=cursor,
                            output_persistence_failed=True)
            unsaved_sent = text
            yield _event("turn_snapshot", snapshot)
            yield _event("output_persistence_failed", {
                "message": "以下已收到的正文尚未保存，请先复制保留；未保存部分无法保证恢复。",
            })

        while unsaved_delivery_state and unsaved_metadata_sent < len(unsaved_delivery_state):
            yield _event("agent_delivery_state", unsaved_delivery_state[unsaved_metadata_sent])
            unsaved_metadata_sent += 1
        if read_error is not None:
            for frame in unsaved_frames(run, after):
                yield frame
            if worker_finished is None:
                raise read_error
            if worker_finished is not None and worker_finished.is_set():
                yield _event("turn_failed", {
                    "code": "agent_output_storage_error",
                    "message": "无法读取正文保存状态，页面中的文字仍保留。请先复制保留。",
                })
                return
            await asyncio.sleep(0.05)
            continue
        if run is None:
            return
        if replay_completed:
            yield _event("turn_started", {
                "run_id": str(run.run_id), "conversation_id": str(run.conversation_id),
                "attempt_id": run.lease_token, "replayed": True,
                "runtime_mode": _effective_agent_runtime_mode(request),
                "output_attempts": [_output_attempt(item).model_dump(mode="json")
                                    for item in run.output_attempts],
            })
            events = ()
        if run.output_redacted or snapshot_first:
            yield _event("turn_snapshot", _run_snapshot(run))
            after = run.last_event_sequence
            events = ()
            snapshot_first = False
        for event in events:
            after = event.sequence
            if event.attempt_id != run.lease_token:
                continue
            if event.name in _TERMINAL_EVENT_NAMES:
                for frame in unsaved_frames(run, after):
                    yield frame
            yield _event(event.name, {**event.payload, "attempt_id": event.attempt_id},
                         event_id=f"{run_id}:{event.sequence}")
            if event.name in _TERMINAL_EVENT_NAMES:
                return
        if run.status == "running" and (
            run.lease_expires_at is None or run.lease_expires_at <= datetime.now(UTC)
        ):
            yield _event("turn_failed", {
                "code": "execution_lease_expired",
                "message": "执行状态暂未确认，已收到的正文已保存。请刷新后查看或明确重试本轮。",
            })
            return
        if run.status != "running" and (not events or replay_completed or run.output_redacted):
            for frame in unsaved_frames(run, after):
                yield frame
            # A process may commit a canonical turn then die before its SSE
            # terminal event. Read-only reconciliation closes that gap.
            if run.status == "completed" and conversation is not None:
                yield _event("turn_completed", {
                    "conversation": _conversation(conversation, release_ids=releases)
                    .model_dump(mode="json"),
                    "knowledge_release_id": run.knowledge_release_id or "",
                })
            elif run.status.startswith("awaiting_"):
                pending = next((item for item in run.tool_summary
                                if item.get("kind") == "deep_research_pending"), {})
                yield _event("research_waiting", {"run_id": str(run_id), **pending})
            else:
                name = "turn_interrupted" if run.status == "interrupted" else "turn_failed"
                yield _event(name, {"code": run.status,
                                    "message": "本轮已结束，已收到的正文已保存。"})
            return
        if worker_finished is not None and worker_finished.is_set() and terminal_failure:
            for frame in unsaved_frames(run, after):
                yield frame
            yield _event(*terminal_failure[0])
            return
        if time.monotonic() >= next_heartbeat:
            yield ": keep-alive\n\n"
            next_heartbeat = time.monotonic() + _SSE_HEARTBEAT_SECONDS
        await asyncio.sleep(0.05)


def _run_snapshot(run) -> dict[str, object]:
    return {
        "run_id": str(run.run_id), "conversation_id": str(run.conversation_id),
        "attempt_id": run.lease_token, "status": run.status,
        "partial_answer": run.partial_answer, "last_event_sequence": run.last_event_sequence,
        "context_card": display_card(run.request_snapshot.get("_display_card")),
        "delivery_state": run.delivery_state,
        "writing_previews": list(run.writing_previews),
        "output_attempts": [_output_attempt(item).model_dump(mode="json")
                            for item in run.output_attempts],
    }


@router.get("/runs/{run_id}/events", operation_id="subscribe_agent_run_events",
            response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}})
def subscribe_agent_run_events(run_id: UUID, request: Request, current: CurrentSessionDependency,
                               after: int = Query(default=0, ge=0)) -> StreamingResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        run = app.find_run_by_id(user_id=current.user.user_id, run_id=run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="回答记录不存在或无权访问。")
    last_event_id = request.headers.get("last-event-id")
    if last_event_id:
        prefix, separator, sequence = last_event_id.rpartition(":")
        if not separator or prefix != str(run_id) or not sequence.isdigit():
            raise HTTPException(status_code=422, detail="事件续接标识无效。")
        after = max(after, int(sequence))
    if after > run.last_event_sequence:
        raise HTTPException(status_code=422, detail="事件续接位置超过已保存事件。")
    return _run_event_response(request, current.user.user_id, run_id, after=after)


@router.get(
    "/runs/by-idempotency-key",
    response_model=AgentRunLookupResponse,
    operation_id="lookup_agent_run",
)
def lookup_agent_run(
    request: Request,
    response: Response,
    current: CurrentSessionDependency,
    idempotency_key: IdempotencyKey,
) -> AgentRunLookupResponse | JSONResponse:
    """Observe the owner's original intent without replay, renewal or billing.

    A missing record is provisional: a disconnected request could still be
    entering the server. It must not be interpreted as proof no work occurred.
    """
    headers = {"Cache-Control": "no-store", "Vary": "Cookie, Idempotency-Key"}
    with request.app.state.disciplinary_agent_scope() as app:
        run = app.find_run(
            user_id=current.user.user_id,
            idempotency_key=idempotency_key,
        )
    if run is None or run.user_id != current.user.user_id:
        body = ErrorResponse(error=ErrorDetail(
            code=ErrorCode.NOT_FOUND,
            message="回答记录不存在或无权访问。",
            trace_id=str(uuid4()),
        ))
        return JSONResponse(status_code=404, content=body.model_dump(mode="json"), headers=headers)
    response.headers.update(headers)
    snapshot = {
        key: value for key, value in run.request_snapshot.items()
        if key in AgentTurnRequest.model_fields
    }
    # Legacy/changed snapshots must not block read-only identity reconciliation.
    # Return no resumable request rather than inventing or leaking internal data.
    try:
        original_request = AgentTurnRequest.model_validate(snapshot) if snapshot else None
    except ValidationError:
        original_request = None
    return AgentRunLookupResponse(
        run_id=run.run_id,
        conversation_id=run.conversation_id,
        idempotency_key=run.idempotency_key,
        status=run.status,
        cancel_requested=run.cancel_requested,
        partial_answer=run.partial_answer,
        output_attempts=[_output_attempt(item) for item in run.output_attempts],
        delivery_state=run.delivery_state,
        last_event_sequence=run.last_event_sequence,
        writing_previews=list(run.writing_previews),
        request=original_request,
        context_card=display_card(run.request_snapshot.get("_display_card")),
        updated_at=run.updated_at,
        turn_id=run.turn_id,
    )


@router.post(
    "/runs/{run_id}/stop",
    response_model=AgentRunStopResponse,
    responses={202: {"model": AgentRunStopResponse}},
    operation_id="stop_agent_run",
)
def stop_agent_run(
    run_id: UUID,
    request: Request,
    response: Response,
    current: CurrentSessionDependency,
    _idempotency_key: IdempotencyKey,
) -> AgentRunStopResponse:
    with request.app.state.disciplinary_agent_scope() as app:
        run = app.request_cancel(user_id=current.user.user_id, run_id=run_id)
    _cancel_active_run(current.user.user_id, run_id)
    response.status_code = (
        status.HTTP_202_ACCEPTED if run.status == "running" else status.HTTP_200_OK
    )
    return AgentRunStopResponse(
        run_id=run.run_id,
        status=run.status,
        cancel_requested=run.cancel_requested,
    )


def _event(name: str, payload: dict[str, object], *, event_id: str | None = None) -> str:
    identity = f"id: {event_id}\n" if event_id is not None else ""
    return f"{identity}event: {name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _chunks(value: str, size: int = 72) -> Iterator[str]:
    for index in range(0, len(value), size):
        yield value[index : index + size]


def _summary(item) -> AgentConversationSummaryResponse:
    return AgentConversationSummaryResponse(
        conversation_id=item.conversation_id,
        task_id=item.task_id,
        reference_knowledge_base_id=item.reference_knowledge_base_id,
        title=item.title,
        updated_at=item.updated_at,
        turn_count=len(item.turns),
    )


def _conversation(
    item,
    *,
    tool_summaries: (
        dict[UUID, tuple[dict[str, object], ...] | list[dict[str, object]]] | None
    ) = None,
    release_ids: dict[UUID, str | None] | None = None,
) -> AgentConversationResponse:
    resolved_tool_summaries = tool_summaries or {}
    resolved_release_ids = release_ids or {}
    return AgentConversationResponse(
        conversation_id=item.conversation_id,
        task_id=item.task_id,
        reference_knowledge_base_id=item.reference_knowledge_base_id,
        title=item.title,
        created_at=item.created_at,
        updated_at=item.updated_at,
        turn_count=len(item.turns),
        turns=[
            AgentTurnResponse(
                turn_id=turn.turn_id,
                user=_message(turn.user_message),
                assistant=_message(turn.assistant_message),
                tool_traces=[
                    _tool_trace(entry)
                    for entry in resolved_tool_summaries.get(turn.turn_id, turn.tool_summary)
                ],
                knowledge_release_id=resolved_release_ids.get(turn.turn_id),
                canvas_patches=[dict(patch) for patch in turn.canvas_patches],
                output_attempts=[_output_attempt(item) for item in turn.output_attempts],
                delivery_state=turn.delivery_state,
            )
            for turn in item.turns
        ],
        research_map=dict(item.research_map),
        canvas_edit_version=item.canvas_edit_version,
        unfinished_runs=[
            AgentRunRecoveryResponse(
                run_id=run.run_id,
                idempotency_key=run.idempotency_key,
                status=run.status,
                request=AgentTurnRequest.model_validate({
                    key: value for key, value in run.request_snapshot.items()
                    if key in AgentTurnRequest.model_fields
                }),
                context_card=display_card(run.request_snapshot.get("_display_card")),
                partial_answer=run.partial_answer,
                output_attempts=[_output_attempt(item) for item in run.output_attempts],
                delivery_state=run.delivery_state,
                last_event_sequence=run.last_event_sequence,
                tool_summary=list(run.tool_summary),
                updated_at=run.updated_at,
                cancel_requested=run.cancel_requested,
            )
            for run in item.unfinished_runs
            if run.request_snapshot
        ],
    )


def _output_attempt(item) -> AgentOutputAttemptResponse:
    return AgentOutputAttemptResponse(
        attempt_id=item.attempt_id, ordinal=item.ordinal, status=item.status,
        answer=item.answer, created_at=item.created_at,
    )


def _message(item) -> AgentMessageResponse:
    return AgentMessageResponse(
        message_id=item.message_id,
        role=item.role,
        content=item.content,
        context_card=item.context_card,
        sequence=item.sequence,
        created_at=item.created_at,
        citations=[
            AgentCitationResponse(
                citation_id=citation.citation_id,
                label=citation.label,
                kind=citation.kind,
                excerpt=citation.excerpt,
                knowledge_id=citation.knowledge_id,
                source_id=citation.source_id,
                source_kind=citation.source_kind,
                material_id=citation.material_id,
                parse_id=citation.parse_id,
                segment_id=citation.segment_id,
                locator=citation.locator,
                deleted=citation.deleted,
                knowledge_base_id=citation.knowledge_base_id,
            )
            for citation in item.citations
        ],
    )


def _citation(item) -> dict[str, object]:
    return {
        "citation_id": item.citation_id,
        "label": item.label,
        "kind": item.kind,
        "excerpt": item.excerpt,
        "knowledge_id": item.knowledge_id,
        "source_id": item.source_id,
        "source_kind": item.source_kind,
        "material_id": item.material_id,
        "parse_id": item.parse_id,
        "segment_id": item.segment_id,
        "locator": item.locator,
        "deleted": item.deleted,
        **({"knowledge_base_id": item.knowledge_base_id} if item.knowledge_base_id else {}),
    }


def _tool_trace(item: dict[str, object]):
    return {
        "tool": str(item.get("tool", "unknown")),
        "phase": str(item.get("phase", "finished")),
        "call_id": str(item.get("call_id", "unknown")),
        "input": item.get("input"),
        "output": item.get("output"),
        "detail": item.get("detail"),
        "error": item.get("error"),
    }
