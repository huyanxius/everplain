from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qunxue_api.adapters.sqlite import (
    AgentConversationRow,
    AgentMessageRow,
    AgentOutputAttemptRow,
    AgentOutputEventRow,
    AgentRunRow,
)
from qunxue_api.adapters.sqlite.agent_memory_model import invalidate_conversation_summary
from qunxue_api.adapters.sqlite.research_material_model import (
    ResearchMaterialBlockRow,
    ResearchMaterialRow,
)
from qunxue_api.modules.agent_conversation import (
    AgentCitation,
    AgentMaterialAttachment,
    AgentMessage,
    AgentOutputAttempt,
    AgentOutputEvent,
    AgentRun,
    AgentTurn,
    CanvasEditConflict,
    Conversation,
    ConversationNotFound,
    ConversationTaskBindingConflict,
    IdempotentTurn,
    ResearchMaterialCitationUnavailable,
    RunAlreadyActive,
    aggregate_research_map,
    apply_canvas_edits,
    merge_digest,
    patches_from_tool_summary,
    prepare_canvas_edit,
)
from qunxue_api.modules.agent_memory import redact_sensitive

_MATERIAL_TOOL_NAMES = frozenset({"search_research_materials", "read_research_material_context"})
_DELETED_MATERIAL_ANSWER = "该回答引用的个人研究材料已删除，原回答内容已隐藏。"
_DELETED_MATERIAL_TRACE_DETAIL = "个人研究材料已删除，历史工具结果已隐藏。"


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class SqliteConversationRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def commit(self) -> None:
        self._session.commit()

    def get_research_task_id(self, *, user_id: UUID, conversation_id: UUID) -> UUID | None:
        row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        return UUID(row.current_research_task_id) if row.current_research_task_id else None

    def link_research_task(self, *, user_id: UUID, conversation_id: UUID, task_id: UUID) -> None:
        row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        if row.current_research_task_id and row.current_research_task_id != str(task_id):
            raise ConversationTaskBindingConflict(
                "The conversation is already bound to a different research task."
            )
        row.current_research_task_id = str(task_id)
        self._session.flush()

    def create(self, conversation: Conversation) -> Conversation:
        self._session.add(
            AgentConversationRow(
                conversation_id=str(conversation.conversation_id),
                user_id=str(conversation.user_id),
                title=conversation.title,
                reference_knowledge_base_id=str(conversation.reference_knowledge_base_id)
                if conversation.reference_knowledge_base_id
                else None,
                version=1,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
            )
        )
        self._session.flush()
        return conversation

    def get(self, *, user_id: UUID, conversation_id: UUID) -> Conversation:
        row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        messages = list(
            self._session.scalars(
                select(AgentMessageRow)
                .where(AgentMessageRow.conversation_id == str(conversation_id))
                .order_by(AgentMessageRow.sequence)
            )
        )
        run_attachments = {
            run.turn_id: {
                str(item["material_id"]): str(item["parse_id"])
                for item in (run.material_attachments or [])
            }
            for run in self._session.scalars(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(conversation_id),
                    AgentRunRow.status == "completed",
                    AgentRunRow.turn_id.is_not(None),
                )
            )
        }
        run_summaries = {
            row.turn_id: tuple(dict(item) for item in (row.tool_summary or []))
            for row in self._session.scalars(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(conversation_id),
                    AgentRunRow.status == "completed",
                    AgentRunRow.turn_id.is_not(None),
                )
            )
            if row.turn_id is not None
        }
        output_by_turn = {
            run.turn_id: self._run_with_output(run).output_attempts
            for run in self._session.scalars(select(AgentRunRow).where(
                AgentRunRow.conversation_id == str(conversation_id),
                AgentRunRow.status == "completed", AgentRunRow.turn_id.is_not(None),
            ))
        }
        turns: list[AgentTurn] = []
        for index in range(0, len(messages), 2):
            user_row, assistant_row = messages[index : index + 2]
            if user_row.role != "user" or assistant_row.role != "assistant":
                continue
            selected = run_attachments.get(str(user_row.turn_id), {})
            citations = tuple(
                _restore_citation(
                    item,
                    session=self._session,
                    attachments=selected,
                    user_id=UUID(row.user_id),
                    task_id=(
                        UUID(row.current_research_task_id) if row.current_research_task_id else None
                    ),
                )
                for item in assistant_row.citations
            )
            raw_tool_summary = run_summaries.get(str(user_row.turn_id), ())
            unavailable_trace_material_ids = _unavailable_trace_material_ids(
                raw_tool_summary,
                attachments=selected,
                session=self._session,
                user_id=UUID(row.user_id),
                task_id=(
                    UUID(row.current_research_task_id) if row.current_research_task_id else None
                ),
            )
            deleted_citation = any(
                citation.deleted and citation.material_id is not None for citation in citations
            )
            tool_summary = _redact_deleted_material_traces(
                raw_tool_summary,
                unavailable_material_ids=unavailable_trace_material_ids,
                force_material_tools=deleted_citation,
            )
            canvas_patches = patches_from_tool_summary(tool_summary)
            turns.append(
                AgentTurn(
                    turn_id=UUID(user_row.turn_id),
                    user_message=_message(user_row),
                    assistant_message=_message(
                        assistant_row,
                        citations=citations,
                        content=(
                            _DELETED_MATERIAL_ANSWER
                            if deleted_citation or unavailable_trace_material_ids
                            else None
                        ),
                    ),
                    evidence_ids=frozenset(item.citation_id for item in citations),
                    tool_summary=tool_summary,
                    canvas_patches=canvas_patches,
                    output_attempts=tuple(
                        replace(attempt, answer=_DELETED_MATERIAL_ANSWER)
                        if deleted_citation or unavailable_trace_material_ids else attempt
                        for attempt in output_by_turn.get(user_row.turn_id, ())
                    ),
                )
            )
        all_patches = [patch for turn in turns for patch in turn.canvas_patches]
        return Conversation(
            conversation_id=UUID(row.conversation_id),
            user_id=UUID(row.user_id),
            title=row.title,
            reference_knowledge_base_id=UUID(row.reference_knowledge_base_id)
            if row.reference_knowledge_base_id
            else None,
            task_id=UUID(row.current_research_task_id) if row.current_research_task_id else None,
            created_at=_utc(row.created_at),
            updated_at=_utc(row.updated_at),
            turns=tuple(turns),
            research_map=apply_canvas_edits(
                aggregate_research_map(
                    all_patches,
                    protected_since={
                        key: value.get("_patch_count", 0) for key, value in row.canvas_edits.items()
                    },
                ),
                row.canvas_edits,
            ),
            canvas_edit_version=row.canvas_edit_version,
            unfinished_runs=tuple(
                self._safe_unfinished_run(run)
                for run in self._session.scalars(
                    select(AgentRunRow)
                    .where(
                        AgentRunRow.conversation_id == str(conversation_id),
                        AgentRunRow.status != "completed",
                    )
                    .order_by(AgentRunRow.started_at)
                    .execution_options(populate_existing=True)
                )
            ),
        )

    def edit_canvas_node(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        node_id: str,
        title: str,
        summary: str,
        expected_title: str,
        expected_summary: str | None,
        expected_version: int,
    ) -> Conversation:
        current = self.get(user_id=user_id, conversation_id=conversation_id)
        if current.canvas_edit_version != expected_version:
            raise CanvasEditConflict("卡片已经更新，请重新载入后再保存。")
        edit = prepare_canvas_edit(
            current.research_map,
            node_id=node_id,
            title=title,
            summary=summary,
            expected_title=expected_title,
            expected_summary=expected_summary,
        )
        row = self._session.get(AgentConversationRow, str(conversation_id))
        edit["_patch_count"] = min(
            edit["_patch_count"],
            row.canvas_edits.get(node_id, {}).get("_patch_count", edit["_patch_count"]),
        )
        edit["user_edit_version"] = expected_version + 1
        edits = {**row.canvas_edits, node_id: edit}
        result = self._session.execute(
            update(AgentConversationRow)
            .where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
                AgentConversationRow.canvas_edit_version == expected_version,
            )
            .values(
                canvas_edits=edits,
                canvas_edit_version=expected_version + 1,
                updated_at=datetime.now(UTC),
            )
        )
        if result.rowcount != 1:
            raise CanvasEditConflict("卡片已经更新，请重新载入后再保存。")
        self._session.flush()
        return self.get(user_id=user_id, conversation_id=conversation_id)

    def list(self, *, user_id: UUID) -> list[Conversation]:
        rows = self._session.scalars(
            select(AgentConversationRow)
            .where(AgentConversationRow.user_id == str(user_id))
            .order_by(AgentConversationRow.updated_at.desc())
        )
        return [
            self.get(user_id=user_id, conversation_id=UUID(row.conversation_id)) for row in rows
        ]

    def rename(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        title: str,
        updated_at: datetime,
    ) -> Conversation:
        row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        row.title = title
        invalidate_conversation_summary(self._session, user_id)
        row.updated_at = updated_at
        self._session.flush()
        return self.get(user_id=user_id, conversation_id=conversation_id)

    def delete(self, *, user_id: UUID, conversation_id: UUID) -> None:
        row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation_id),
                AgentConversationRow.user_id == str(user_id),
            )
        )
        if row is None:
            raise ConversationNotFound(str(conversation_id))
        self._session.delete(row)
        invalidate_conversation_summary(self._session, user_id)
        self._session.flush()

    def release_ids_by_turn(self, *, conversation_id: UUID) -> dict[UUID, str]:
        return {
            UUID(row.turn_id): row.knowledge_release_id
            for row in self._session.scalars(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(conversation_id),
                    AgentRunRow.status == "completed",
                    AgentRunRow.turn_id.is_not(None),
                    AgentRunRow.knowledge_release_id.is_not(None),
                )
            )
            if row.turn_id is not None and row.knowledge_release_id is not None
        }

    def append_turn(self, *, conversation: Conversation, turn: AgentTurn, idempotency_key: str):
        existing = self._session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.conversation_id == str(conversation.conversation_id),
                AgentRunRow.idempotency_key == idempotency_key,
            ).execution_options(populate_existing=True)
        )
        if existing is not None and existing.status == "completed":
            return IdempotentTurn(UUID(existing.turn_id or existing.run_id))
        self._require_live_material_citations(
            conversation=conversation,
            turn=turn,
            attachments=existing.material_attachments if existing else (),
        )
        self._session.add_all(
            [
                AgentMessageRow(
                    message_id=str(turn.user_message.message_id),
                    conversation_id=str(conversation.conversation_id),
                    turn_id=str(turn.turn_id),
                    role="user",
                    content=turn.user_message.content,
                    citations=[],
                    sequence=turn.user_message.sequence,
                    created_at=turn.user_message.created_at,
                ),
                AgentMessageRow(
                    message_id=str(turn.assistant_message.message_id),
                    conversation_id=str(conversation.conversation_id),
                    turn_id=str(turn.turn_id),
                    role="assistant",
                    content=turn.assistant_message.content,
                    citations=[_citation_dict(item) for item in turn.assistant_message.citations],
                    sequence=turn.assistant_message.sequence,
                    created_at=turn.assistant_message.created_at,
                ),
            ]
        )
        row = self._session.scalar(select(AgentConversationRow).where(
            AgentConversationRow.conversation_id == str(conversation.conversation_id),
            AgentConversationRow.user_id == str(conversation.user_id),
        ).execution_options(populate_existing=True))
        if row is None:
            raise ConversationNotFound(str(conversation.conversation_id))
        row.context_digest = merge_digest(
            row.context_digest or {}, message_id=str(turn.user_message.message_id),
            sequence=turn.user_message.sequence,
            content=redact_sensitive(turn.user_message.content),
        )
        row.updated_at = max(_utc(row.updated_at), turn.assistant_message.created_at)
        row.version += 1
        invalidate_conversation_summary(self._session, conversation.user_id)
        self._session.flush()
        return turn

    def _require_live_material_citations(
        self,
        *,
        conversation: Conversation,
        turn: AgentTurn,
        attachments=(),
    ) -> None:
        from qunxue_api.adapters.sqlite.shared_knowledge import SqliteSharedKnowledgeRepository
        from qunxue_api.modules.shared_knowledge import SharedKnowledgeService

        shared = SharedKnowledgeService(SqliteSharedKnowledgeRepository(self._session))
        for citation in turn.assistant_message.citations:
            if citation.source_kind != "shared_material":
                continue
            if (
                not citation.knowledge_base_id
                or (conversation.reference_knowledge_base_id is not None
                    and str(conversation.reference_knowledge_base_id) != citation.knowledge_base_id)
            ):
                raise ResearchMaterialCitationUnavailable("知识库引用不属于当前会话。")
            if conversation.reference_knowledge_base_id is None:
                kb = shared.require_read(conversation.user_id, UUID(citation.knowledge_base_id))
                if kb.owner_user_id != conversation.user_id:
                    raise ResearchMaterialCitationUnavailable("全局知识库只能引用本人资料。")
            doc = shared.source(conversation.user_id, UUID(citation.knowledge_base_id),
                                UUID(citation.material_id), citation.segment_id)
            if str(doc.parse_id) != citation.parse_id:
                raise ResearchMaterialCitationUnavailable("课程引用版本不可用。")
        selected = {str(item["material_id"]): str(item["parse_id"]) for item in attachments}
        material_citations = tuple(
            citation
            for citation in turn.assistant_message.citations
            if citation.material_id is not None and citation.source_kind != "shared_material"
        )
        if not material_citations:
            return
        conversation_row = self._session.scalar(
            select(AgentConversationRow).where(
                AgentConversationRow.conversation_id == str(conversation.conversation_id),
                AgentConversationRow.user_id == str(conversation.user_id),
            )
        )
        task_id = conversation_row.current_research_task_id if conversation_row else None
        for citation in material_citations:
            material = self._session.scalar(
                select(ResearchMaterialRow).where(
                    ResearchMaterialRow.material_id == citation.material_id,
                    ResearchMaterialRow.user_id == str(conversation.user_id),
                    ResearchMaterialRow.status != "deleted",
                )
            )
            if (
                material is None
                or (
                    material.task_id != task_id
                    and selected.get(citation.material_id) != citation.parse_id
                )
                or (selected and selected.get(citation.material_id) != citation.parse_id)
                or citation.parse_id is None
                or citation.segment_id is None
            ):
                raise ResearchMaterialCitationUnavailable(
                    "research material is no longer eligible for a new citation"
                )
            block = self._session.scalar(
                select(ResearchMaterialBlockRow).where(
                    ResearchMaterialBlockRow.material_id == citation.material_id,
                    ResearchMaterialBlockRow.parse_id == citation.parse_id,
                    ResearchMaterialBlockRow.segment_id == citation.segment_id,
                )
            )
            if block is None:
                raise ResearchMaterialCitationUnavailable(
                    "research material segment is no longer eligible for a new citation"
                )

    def start_run(
        self,
        run: AgentRun,
        *,
        enforce_expected_generation: bool = False,
        expected_previous_lease_token: str | None = None,
    ) -> AgentRun:
        existing = self._session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.conversation_id == str(run.conversation_id),
                AgentRunRow.idempotency_key == run.idempotency_key,
            ).execution_options(populate_existing=True)
        )
        current_token = (existing.lease_token or "") if existing is not None else None
        if enforce_expected_generation and current_token != expected_previous_lease_token:
            # Financial repair covered this exact generation, including absence.
            # A later failed/completed generation cannot inherit that repair.
            self._session.rollback()
            raise RunAlreadyActive(str(run.conversation_id))
        if existing is not None:
            if existing.status == "running":
                raise RunAlreadyActive(str(run.conversation_id))
            if existing.status == "completed":
                return self._run_with_output(existing)
            active = self._session.scalar(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(run.conversation_id),
                    AgentRunRow.status == "running",
                    AgentRunRow.run_id != existing.run_id,
                )
            )
            if active is not None:
                raise RunAlreadyActive(str(run.conversation_id))
            try:
                # Two clients may read the same paused row. A unique index on running
                # conversations does not distinguish two writers updating that one row.
                claimed = self._session.execute(
                    update(AgentRunRow).where(
                        AgentRunRow.run_id == existing.run_id,
                        AgentRunRow.user_id == str(run.user_id),
                        AgentRunRow.status == existing.status,
                        AgentRunRow.lease_token == (
                            expected_previous_lease_token
                            if enforce_expected_generation and expected_previous_lease_token
                            else existing.lease_token
                        ),
                    ).values(status="running", lease_token=run.lease_token)
                ).rowcount
                if not claimed:
                    self._session.rollback()
                    raise RunAlreadyActive(str(run.conversation_id))
                self._ensure_legacy_output(existing, current_token or existing.run_id)
                self._start_output_attempt(existing.run_id, run.lease_token, run.updated_at)
                existing.status = "running"
                existing.error = None
                existing.completed_at = None
                existing.knowledge_release_id = run.knowledge_release_id
                existing.provider = run.provider
                existing.model = run.model
                existing.turn_id = None
                existing.request_snapshot = dict(
                    run.request_snapshot or existing.request_snapshot or {}
                )
                existing.cancel_requested = False
                existing.lease_token = run.lease_token
                existing.lease_expires_at = run.lease_expires_at
                existing.updated_at = run.updated_at
                self._session.flush()
                return self._run_with_output(existing)
            except IntegrityError as error:
                self._session.rollback()
                active = self._session.scalar(
                    select(AgentRunRow).where(
                        AgentRunRow.conversation_id == str(run.conversation_id),
                        AgentRunRow.status == "running",
                    )
                )
                if active is not None:
                    raise RunAlreadyActive(str(run.conversation_id)) from error
                existing = self._session.scalar(
                    select(AgentRunRow).where(
                        AgentRunRow.conversation_id == str(run.conversation_id),
                        AgentRunRow.idempotency_key == run.idempotency_key,
                    )
                )
                if existing is not None:
                    if enforce_expected_generation:
                        raise RunAlreadyActive(str(run.conversation_id)) from error
                    return self._run_with_output(existing)
                raise error

        active = self._session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.conversation_id == str(run.conversation_id),
                AgentRunRow.status == "running",
            )
        )
        if active is not None:
            raise RunAlreadyActive(str(run.conversation_id))
        try:
            self._session.add(
                AgentRunRow(
                    run_id=str(run.run_id),
                    turn_id=None,
                    conversation_id=str(run.conversation_id),
                    user_id=str(run.user_id),
                    idempotency_key=run.idempotency_key,
                    status=run.status,
                    provider=run.provider,
                    model=run.model,
                    knowledge_release_id=run.knowledge_release_id,
                    usage={},
                    tool_summary=[],
                    material_attachments=[
                        {
                            "material_id": str(item.material_id),
                            "parse_id": str(item.parse_id),
                        }
                        for item in run.material_attachments
                    ],
                    started_at=datetime.now(UTC),
                    request_snapshot=dict(run.request_snapshot),
                    partial_answer=run.partial_answer,
                    updated_at=run.updated_at,
                    cancel_requested=False,
                    lease_token=run.lease_token,
                    lease_expires_at=run.lease_expires_at,
                )
            )
            self._session.flush()
        except IntegrityError as error:
            self._session.rollback()
            existing = self._session.scalar(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(run.conversation_id),
                    AgentRunRow.idempotency_key == run.idempotency_key,
                )
            )
            if existing is not None:
                if enforce_expected_generation or existing.status == "running":
                    raise RunAlreadyActive(str(run.conversation_id)) from error
                return self._run_with_output(existing)
            active = self._session.scalar(
                select(AgentRunRow).where(
                    AgentRunRow.conversation_id == str(run.conversation_id),
                    AgentRunRow.status == "running",
                )
            )
            if active is not None:
                raise RunAlreadyActive(str(run.conversation_id)) from error
            raise error
        self._start_output_attempt(str(run.run_id), run.lease_token, run.updated_at)
        row = self._session.get(AgentRunRow, str(run.run_id))
        return self._run_with_output(row)

    def _start_output_attempt(self, run_id: str, attempt_id: str, created_at: datetime) -> None:
        ordinal = self._session.scalar(select(func.max(AgentOutputAttemptRow.ordinal)).where(
            AgentOutputAttemptRow.run_id == run_id,
        )) or 0
        self._session.add(AgentOutputAttemptRow(
            attempt_id=attempt_id, run_id=run_id, ordinal=ordinal + 1,
            status="running", answer="", created_at=created_at,
        ))
        self._session.flush()

    def _ensure_legacy_output(self, row: AgentRunRow, attempt_id: str) -> None:
        count = self._session.scalar(select(func.count()).select_from(AgentOutputAttemptRow).where(
            AgentOutputAttemptRow.run_id == row.run_id,
        ))
        if not count and row.partial_answer:
            self._session.add(AgentOutputAttemptRow(
                attempt_id=attempt_id, run_id=row.run_id, ordinal=1, status=row.status,
                answer=row.partial_answer, created_at=row.started_at,
            ))
            self._session.flush()

    def _run_with_output(self, row: AgentRunRow) -> AgentRun:
        attempts = self._session.scalars(select(AgentOutputAttemptRow).where(
            AgentOutputAttemptRow.run_id == row.run_id,
        ).order_by(AgentOutputAttemptRow.ordinal).execution_options(populate_existing=True))
        return replace(_run_from_row(row), output_attempts=tuple(
            AgentOutputAttempt(
                attempt_id=item.attempt_id, ordinal=item.ordinal, status=item.status,
                answer=item.answer, created_at=_utc(item.created_at),
            ) for item in attempts
        ), last_event_sequence=row.last_event_sequence)

    def append_output_event(
        self, *, user_id: UUID, run_id: UUID, attempt_id: str,
        name: str, payload: dict[str, object],
    ) -> AgentOutputEvent | None:
        # Output uses its own transaction. Rolling back a tool, final answer or
        # billing transaction cannot undo a body that a subscriber already saw.
        with Session(self._session.get_bind()) as session:
            event = SqliteConversationRepository(session)._append_output_event(
                user_id=user_id, run_id=run_id, attempt_id=attempt_id,
                name=name, payload=payload,
            )
            session.commit()
            return event

    def _append_output_event(
        self, *, user_id: UUID, run_id: UUID, attempt_id: str,
        name: str, payload: dict[str, object],
    ) -> AgentOutputEvent | None:
        # Sequence allocation and the body projection are one fenced transaction.
        query = update(AgentRunRow).where(
            AgentRunRow.run_id == str(run_id), AgentRunRow.user_id == str(user_id),
            AgentRunRow.lease_token == attempt_id,
        )
        if name == "assistant_delta":
            query = query.where(AgentRunRow.status == "running")
        sequence = self._session.execute(query.values(
            last_event_sequence=AgentRunRow.last_event_sequence + 1
        )
            .returning(AgentRunRow.last_event_sequence)).scalar_one_or_none()
        if sequence is None:
            return None
        if name == "assistant_delta":
            delta = str(payload["delta"])
            answer = self._session.execute(update(AgentOutputAttemptRow).where(
                AgentOutputAttemptRow.attempt_id == attempt_id,
                AgentOutputAttemptRow.run_id == str(run_id),
            ).values(answer=AgentOutputAttemptRow.answer + delta)
                .returning(AgentOutputAttemptRow.answer)).scalar_one()
            self._session.execute(update(AgentRunRow).where(
                AgentRunRow.run_id == str(run_id),
            ).values(partial_answer=answer))
        self._session.add(AgentOutputEventRow(
            run_id=str(run_id), sequence=sequence, attempt_id=attempt_id,
            name=name, payload=dict(payload), created_at=datetime.now(UTC),
        ))
        self._session.flush()
        return AgentOutputEvent(
            run_id=run_id, attempt_id=attempt_id, sequence=sequence,
            name=name, payload=dict(payload),
        )

    def read_output_events(
        self, *, user_id: UUID, run_id: UUID, after: int = 0, limit: int = 200,
    ) -> tuple[AgentOutputEvent, ...]:
        run = self.find_run_by_id(user_id=user_id, run_id=run_id)
        if run is None:
            raise ConversationNotFound(str(run_id))
        # Apply the same deleted-source policy to replay and archived bodies.
        if run.request_snapshot.get("_unavailable_materials"):
            return ()
        rows = self._session.scalars(select(AgentOutputEventRow).where(
            AgentOutputEventRow.run_id == str(run_id), AgentOutputEventRow.sequence > after,
        ).order_by(AgentOutputEventRow.sequence).limit(limit))
        return tuple(AgentOutputEvent(
            run_id=run_id, attempt_id=row.attempt_id, sequence=row.sequence,
            name=row.name, payload=dict(row.payload),
        ) for row in rows)

    def find_run(self, *, user_id: UUID, idempotency_key: str) -> AgentRun | None:
        row = self._session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.user_id == str(user_id),
                AgentRunRow.idempotency_key == idempotency_key,
            ).execution_options(populate_existing=True)
        )
        if row is None:
            return None
        run = self._run_with_output(row)
        if run.status != "completed" or run.turn_id is None:
            return self._safe_unfinished_run(row)
        conversation = self.get(
            user_id=user_id,
            conversation_id=run.conversation_id,
        )
        turn = next(
            (item for item in conversation.turns if item.turn_id == run.turn_id),
            None,
        )
        if turn is None:
            return run
        unavailable = turn.assistant_message.content == _DELETED_MATERIAL_ANSWER
        return replace(
            run, tool_summary=turn.tool_summary, output_attempts=turn.output_attempts,
            partial_answer=_DELETED_MATERIAL_ANSWER if unavailable else run.partial_answer,
            request_snapshot={**run.request_snapshot, "_unavailable_materials": True}
            if unavailable else run.request_snapshot,
        )

    def find_run_by_id(self, *, user_id: UUID, run_id: UUID) -> AgentRun | None:
        row = self._session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.run_id == str(run_id),
                AgentRunRow.user_id == str(user_id),
            ).execution_options(populate_existing=True)
        )
        if row is None:
            return None
        run = self._run_with_output(row)
        if run.status != "completed" or run.turn_id is None:
            return self._safe_unfinished_run(row)
        conversation = self.get(user_id=user_id, conversation_id=run.conversation_id)
        turn = next((item for item in conversation.turns if item.turn_id == run.turn_id), None)
        if turn is None:
            return run
        unavailable = turn.assistant_message.content == _DELETED_MATERIAL_ANSWER
        return replace(
            run, tool_summary=turn.tool_summary, output_attempts=turn.output_attempts,
            partial_answer=_DELETED_MATERIAL_ANSWER if unavailable else run.partial_answer,
            request_snapshot={**run.request_snapshot, "_unavailable_materials": True}
            if unavailable else run.request_snapshot,
        )

    def finish_run(
        self,
        *,
        run_id: UUID,
        status: str,
        error: str | None = None,
        turn_id: UUID | None = None,
        tool_summary: tuple[dict[str, object], ...] = (),
        provider: str | None = None,
        model: str | None = None,
        lease_token: str | None = None,
    ) -> None:
        row = self._session.get(AgentRunRow, str(run_id), populate_existing=True)
        if row is None:
            return
        if lease_token is not None:
            # Claim the terminal write before touching related records. A reclaimed worker
            # must never overwrite a newer attempt of the same durable request.
            claimed = self._session.execute(
                update(AgentRunRow).where(
                    AgentRunRow.run_id == str(run_id),
                    AgentRunRow.lease_token == lease_token,
                    AgentRunRow.status == "running",
                ).values(status=status)
            ).rowcount
            if not claimed:
                return
        self._session.execute(update(AgentOutputAttemptRow).where(
            AgentOutputAttemptRow.attempt_id == (lease_token or row.lease_token),
            AgentOutputAttemptRow.run_id == str(run_id),
        ).values(status=status))
        row.status = status
        row.error = error
        if turn_id is not None:
            row.turn_id = str(turn_id)
        elif status != "completed":
            row.turn_id = None
        if provider is not None:
            normalized_provider = provider.strip()
            if not normalized_provider:
                raise ValueError("Agent provider must not be empty")
            row.provider = normalized_provider
        if model is not None:
            normalized_model = model.strip()
            if not normalized_model:
                raise ValueError("Agent model must not be empty")
            row.model = normalized_model
        row.tool_summary = [dict(item) for item in tool_summary]
        row.completed_at = datetime.now(UTC)
        row.updated_at = row.completed_at
        row.lease_expires_at = None
        self._session.flush()


    def _safe_unfinished_run(self, row: AgentRunRow) -> AgentRun:
        run = self._run_with_output(row)
        if not run.partial_answer and not run.tool_summary:
            return run
        attachments = {
            str(item.material_id): str(item.parse_id) for item in run.material_attachments
        }
        task_id = self.get_research_task_id(
            user_id=run.user_id, conversation_id=run.conversation_id
        )
        unavailable = _unavailable_trace_material_ids(
            (*run.tool_summary, *({"material_id": key} for key in attachments)),
            session=self._session, user_id=run.user_id, task_id=task_id, attachments=attachments,
        )
        if not unavailable:
            return run
        # A draft can contain derivatives of a deleted attachment in any tool result,
        # including a memo or document proposal. Retain identity without source text.
        safe_traces = _redact_deleted_material_traces(
            run.tool_summary, unavailable_material_ids=unavailable, force_material_tools=True,
        )
        return replace(
            run,
            partial_answer=_DELETED_MATERIAL_ANSWER,
            output_attempts=tuple(replace(item, answer=_DELETED_MATERIAL_ANSWER)
                                  for item in run.output_attempts),
            request_snapshot={
                **run.request_snapshot,
                "_unavailable_materials": sorted(unavailable),
            },
            tool_summary=tuple(
                {
                    key: value
                    for key, value in entry.items()
                    if key in {"tool", "phase", "call_id", "error"}
                }
                for entry in safe_traces
            ),
        )

    def checkpoint_run(
        self, *, user_id: UUID, run_id: UUID, lease_token: str | None = None,
        partial_answer: str | None = None,
        tool_summary: tuple[dict[str, object], ...] | None = None,
        request_snapshot: dict[str, object] | None = None,
        require_not_cancelled: bool = False,
    ) -> bool:
        now = datetime.now(UTC)
        values = {"updated_at": now, "lease_expires_at": now + timedelta(seconds=30)}
        if partial_answer is not None:
            values["partial_answer"] = partial_answer
        if tool_summary is not None:
            values["tool_summary"] = [dict(item) for item in tool_summary]
        if request_snapshot is not None:
            values["request_snapshot"] = dict(request_snapshot)
        query = update(AgentRunRow).where(
            AgentRunRow.run_id == str(run_id), AgentRunRow.user_id == str(user_id),
            AgentRunRow.status == "running",
        )
        if require_not_cancelled:
            query = query.where(AgentRunRow.cancel_requested.is_(False))
        if lease_token is not None:
            query = query.where(AgentRunRow.lease_token == lease_token)
        return bool(self._session.execute(query.values(**values)).rowcount)

    def request_cancel(self, *, user_id: UUID, run_id: UUID) -> AgentRun:
        run = self.find_run_by_id(user_id=user_id, run_id=run_id)
        if run is None:
            raise ConversationNotFound(str(run_id))
        self._session.execute(update(AgentRunRow).where(
            AgentRunRow.run_id == str(run_id), AgentRunRow.user_id == str(user_id),
            AgentRunRow.status == "running",
        ).values(cancel_requested=True, updated_at=datetime.now(UTC)))
        return self.find_run_by_id(user_id=user_id, run_id=run_id)

    def recover_expired_runs(self, *, user_id: UUID, conversation_id: UUID) -> tuple[AgentRun, ...]:
        now = datetime.now(UTC)
        rows = self._session.scalars(
            select(AgentRunRow).where(
                AgentRunRow.user_id == str(user_id),
                AgentRunRow.conversation_id == str(conversation_id),
                AgentRunRow.status == "running",
                or_(AgentRunRow.lease_expires_at.is_(None), AgentRunRow.lease_expires_at <= now),
            ).execution_options(populate_existing=True)
        ).all()
        recovered = []
        for row in rows:
            changed = self._session.execute(update(AgentRunRow).where(
                AgentRunRow.run_id == row.run_id, AgentRunRow.status == "running",
                or_(AgentRunRow.lease_expires_at.is_(None), AgentRunRow.lease_expires_at <= now),
            ).values(status="interrupted", cancel_requested=True, updated_at=now,
                     lease_expires_at=None, completed_at=now)
                .execution_options(synchronize_session="fetch")).rowcount
            if changed:
                self._session.execute(update(AgentOutputAttemptRow).where(
                    AgentOutputAttemptRow.attempt_id == row.lease_token,
                    AgentOutputAttemptRow.run_id == row.run_id,
                ).values(status="interrupted"))
                recovered.append(self._run_with_output(row))
        return tuple(recovered)


def _citation_dict(item: AgentCitation) -> dict[str, object]:
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


def _run_from_row(row: AgentRunRow) -> AgentRun:
    return AgentRun(
        run_id=UUID(row.run_id),
        conversation_id=UUID(row.conversation_id),
        user_id=UUID(row.user_id),
        idempotency_key=row.idempotency_key,
        status=row.status,  # type: ignore[arg-type]
        provider=row.provider,
        model=row.model,
        knowledge_release_id=row.knowledge_release_id,
        turn_id=UUID(row.turn_id) if row.turn_id else None,
        tool_summary=tuple(dict(item) for item in row.tool_summary),
        request_snapshot=dict(row.request_snapshot or {}),
        partial_answer=row.partial_answer or "",
        updated_at=_utc(row.updated_at or row.started_at),
        cancel_requested=bool(row.cancel_requested),
        lease_expires_at=_utc(row.lease_expires_at) if row.lease_expires_at else None,
        lease_token=row.lease_token or "",
        material_attachments=tuple(
            AgentMaterialAttachment(
                material_id=UUID(str(item["material_id"])),
                parse_id=UUID(str(item["parse_id"])),
            )
            for item in (row.material_attachments or [])
        ),
    )


def _citation(item: dict[str, object]) -> AgentCitation:
    return AgentCitation(
        citation_id=str(item["citation_id"]),
        label=str(item["label"]),
        kind=str(item["kind"]),  # type: ignore[arg-type]
        excerpt=str(item["excerpt"]) if item.get("excerpt") else None,
        knowledge_id=str(item["knowledge_id"]) if item.get("knowledge_id") else None,
        source_id=str(item["source_id"]) if item.get("source_id") else None,
        source_kind=str(item["source_kind"]) if item.get("source_kind") else None,
        material_id=str(item["material_id"]) if item.get("material_id") else None,
        parse_id=str(item["parse_id"]) if item.get("parse_id") else None,
        segment_id=str(item["segment_id"]) if item.get("segment_id") else None,
        locator=(dict(item["locator"]) if isinstance(item.get("locator"), dict) else None),
        deleted=bool(item.get("deleted", False)),
        knowledge_base_id=str(item["knowledge_base_id"]) if item.get("knowledge_base_id") else None,
    )


def _redact_deleted_material_citation(citation: AgentCitation) -> AgentCitation:
    """Keep a deleted source's identity/locator while removing its excerpt."""

    return replace(citation, excerpt=None, deleted=True)


def _restore_citation(
    item: dict[str, object],
    *,
    session: Session,
    user_id: UUID,
    task_id: UUID | None,
    attachments: dict[str, str] | None = None,
) -> AgentCitation:
    citation = _citation(item)
    if citation.source_kind == "shared_material":
        from qunxue_api.adapters.sqlite.shared_knowledge import SqliteSharedKnowledgeRepository
        from qunxue_api.modules.shared_knowledge import (
            SharedKnowledgeService,
            SharedKnowledgeUnavailable,
        )

        try:
            shared = SharedKnowledgeService(SqliteSharedKnowledgeRepository(session))
            document = shared.source(user_id, UUID(citation.knowledge_base_id or ""),
                                     UUID(citation.material_id or ""), citation.segment_id)
            if str(document.parse_id) != citation.parse_id:
                return _redact_deleted_material_citation(citation)
        except (SharedKnowledgeUnavailable, ValueError):
            return _redact_deleted_material_citation(citation)
        return citation
    if not citation.material_id:
        return citation
    material = session.scalar(
        select(ResearchMaterialRow).where(
            ResearchMaterialRow.material_id == citation.material_id,
        )
    )
    if (
        material is None
        or material.user_id != str(user_id)
        or (
            material.task_id != str(task_id)
            and (attachments or {}).get(citation.material_id) != citation.parse_id
        )
        or material.status == "deleted"
    ):
        return _redact_deleted_material_citation(citation)
    return citation


def _material_ids(value: object) -> set[str]:
    if isinstance(value, dict):
        found = {
            item
            for key, item in value.items()
            if key == "material_id" and isinstance(item, str) and item
        }
        for item in value.values():
            found.update(_material_ids(item))
        return found
    if isinstance(value, (list, tuple)):
        found: set[str] = set()
        for item in value:
            found.update(_material_ids(item))
        return found
    return set()


def _unavailable_trace_material_ids(
    tool_summary: tuple[dict[str, object], ...],
    *,
    session: Session,
    user_id: UUID,
    task_id: UUID | None,
    attachments: dict[str, str] | None = None,
) -> set[str]:
    referenced = _material_ids(tool_summary)
    if not referenced:
        return referenced
    live = set(
        session.scalars(
            select(ResearchMaterialRow.material_id).where(
                ResearchMaterialRow.material_id.in_(referenced),
                ResearchMaterialRow.user_id == str(user_id),
                or_(
                    ResearchMaterialRow.task_id == str(task_id),
                    ResearchMaterialRow.material_id.in_(tuple(attachments or {})),
                ),
                ResearchMaterialRow.status != "deleted",
            )
        )
    )
    return referenced - live


def _redact_deleted_material_traces(
    tool_summary: tuple[dict[str, object], ...],
    *,
    unavailable_material_ids: set[str],
    force_material_tools: bool,
) -> tuple[dict[str, object], ...]:
    sensitive_call_ids = {
        str(entry.get("call_id"))
        for entry in tool_summary
        if entry.get("tool") in _MATERIAL_TOOL_NAMES
        and (
            force_material_tools
            or bool(_material_ids(entry).intersection(unavailable_material_ids))
        )
    }
    redacted: list[dict[str, object]] = []
    for entry in tool_summary:
        if (
            entry.get("tool") not in _MATERIAL_TOOL_NAMES
            or str(entry.get("call_id")) not in sensitive_call_ids
        ):
            redacted.append(dict(entry))
            continue
        safe = dict(entry)
        if safe.get("phase") != "started" or "output" in safe:
            safe["output"] = {"deleted": True}
        safe["detail"] = _DELETED_MATERIAL_TRACE_DETAIL
        redacted.append(safe)
    return tuple(redacted)


def _message(
    row: AgentMessageRow,
    *,
    citations: tuple[AgentCitation, ...] | None = None,
    content: str | None = None,
) -> AgentMessage:
    return AgentMessage(
        message_id=UUID(row.message_id),
        role=row.role,  # type: ignore[arg-type]
        content=row.content if content is None else content,
        citations=(
            citations if citations is not None else tuple(_citation(item) for item in row.citations)
        ),
        sequence=row.sequence,
        created_at=_utc(row.created_at),
    )
