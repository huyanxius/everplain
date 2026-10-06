"""Run-local tool events, cancellation and proposal delivery; no prompt selection."""

from collections.abc import Callable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar

from pydantic_ai import RunContext

from qunxue_api.adapters.retrieval.errors import RetrievalPipelineUnavailable
from qunxue_api.modules.agent_conversation import AgentInterrupted, AgentToolEvent

from .catalog_tools import KnowledgeToolRegistry
from .tool_support import _completed_write_result, _tool_call_id
from .writing_preview import WritingPreviewStream


class AgentToolCommitFailure(RuntimeError):
    """An unacknowledged command commit must stop execution, never trigger a tool retry."""


class AgentToolRuntime:
    def __init__(self, *, writing_instructions: Callable[[], str]) -> None:
        self._writing_instructions = writing_instructions
        self._active_tool_event: ContextVar[Callable[[AgentToolEvent], None] | None] = ContextVar(
            f"agent_tool_event_{id(self)}", default=None,
        )
        self._active_writing_proposals: ContextVar[list[dict] | None] = ContextVar(
            f"agent_writing_proposals_{id(self)}", default=None,
        )
        self._active_writing_preview: ContextVar[WritingPreviewStream | None] = ContextVar(
            f"agent_writing_preview_{id(self)}", default=None,
        )
        self._active_cancelled: ContextVar[Callable[[], bool] | None] = ContextVar(
            f"agent_cancelled_{id(self)}", default=None,
        )

    def invoke(self, tools, tool_name: str, *args, **kwargs):
        """Finish the shared-Session command before publishing any terminal event.

        The registered function supplies the name, never model arguments. A
        failure returned as ordinary data has the same rollback semantics as an
        exception. The registry's explicit business-command owner completes a
        durable result before any event callback, including on nonstream runs.
        Billing, writing-operation and memory receipts retain their own scopes.
        """
        rollback = getattr(tools, "rollback_failed_tool", None)
        try:
            result = getattr(tools, tool_name)(*args, **kwargs)
            failed = isinstance(result, Mapping) and bool(result.get("error"))
            complete = getattr(tools, "commit_completed_tool", None)
            if not failed and callable(complete):
                try:
                    complete(tool_name, result)
                except AgentInterrupted:
                    raise
                except Exception as error:
                    raise AgentToolCommitFailure(str(error)) from error
        except BaseException:
            if callable(rollback):
                rollback()
            raise
        if failed and callable(rollback):
            rollback()
        return result

    @contextmanager
    def activate(self, *, on_tool_event, is_cancelled, writing_preview):
        """Bind callbacks to this run, including SDK worker-thread context copies."""
        proposals = []
        tokens = (
            (self._active_tool_event, self._active_tool_event.set(on_tool_event)),
            (self._active_cancelled, self._active_cancelled.set(is_cancelled)),
            (self._active_writing_preview, self._active_writing_preview.set(writing_preview)),
            (self._active_writing_proposals, self._active_writing_proposals.set(proposals)),
        )
        try:
            yield proposals
        finally:
            for variable, token in reversed(tokens):
                variable.reset(token)

    def run_writing(self, ctx, tool_name, payload):
        call_id = _tool_call_id(ctx, tool_name)
        trace_input = payload
        if tool_name == "propose_writing_edit":
            # A rejected replacement may itself contain leaked instructions.
            # Keep neither it nor the original prose in persisted tool traces.
            trace_input = {key: payload.get(key) for key in (
                "expected_version", "selection_start", "selection_end",
            )}
            trace_input.update(
                original_characters=len(payload["original_text"]),
                replacement_characters=len(payload["replacement_text"]),
            )
        self.emit(AgentToolEvent(
            tool=tool_name, phase="started", call_id=call_id, input=trace_input,
            detail=(
                "正在读取写作文稿" if tool_name == "read_writing_document" else "正在提议精确修改"
            ),
        ))
        try:
            arguments = dict(payload)
            if tool_name == "propose_writing_edit":
                # Same-source trusted rules are selected at prompt construction;
                # user memory/history/context remains data regardless of format.
                # Neither becomes a model-controlled argument or event field.
                arguments["runtime_instructions"] = self._writing_instructions()
            preview = self._active_writing_preview.get()
            if tool_name == "propose_writing_edit" and preview is not None:
                preview.validate_final(call_id, payload)
            result = self.invoke(ctx.deps, tool_name, **arguments)
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except LookupError:
            result = {"error": "writing_document_unavailable", "message": "文稿不存在或不可访问"}
        except ValueError as error:
            result = {"error": "writing_edit_conflict", "message": str(error)}
        except Exception:
            result = {"error": "writing_tool_unavailable", "message": "写作工具暂时不可用"}
        if tool_name == "propose_writing_edit" and not result.get("error"):
            proposals = self._active_writing_proposals.get()
            if proposals is not None:
                proposals.append(result)
        try:
            cancelled = self._active_cancelled.get()
            if tool_name == "propose_writing_edit" and cancelled is not None and cancelled():
                raise AgentInterrupted("Writing proposal cancelled after persistence")
            if tool_name == "propose_writing_edit":
                preview = self._active_writing_preview.get()
                if preview is not None:
                    preview.finish(call_id, payload, result)
            failed = bool(result.get("error"))
            trace = result
            if tool_name == "read_writing_document" and not failed:
                trace = {key: result.get(key) for key in (
                    "document_id", "version", "context_stale", "pending_revision_ids",
                )}
            elif tool_name == "propose_writing_edit" and not failed:
                trace = {key: result.get(key) for key in (
                    "revision_id", "document_id", "base_version", "action", "status",
                    "selection_start", "selection_end",
                )}
                trace.update(
                    before_characters=len(result.get("before_markdown", "")),
                    after_characters=len(result.get("after_markdown", "")),
                )
            self.emit(AgentToolEvent(
                tool=tool_name, phase="failed" if failed else "finished", call_id=call_id,
                input=trace_input, output=trace,
                detail=str(result["message"]) if failed else (
                    "已读取写作文稿" if tool_name == "read_writing_document"
                    else "已生成待接受或撤回的修订，正文尚未修改"
                ),
                error=str(result["error"]) if failed else None,
            ))
            return result
        except BaseException as error:
            cancelled = self._active_cancelled.get()
            explicit_stop = (isinstance(error, AgentInterrupted)
                             or cancelled is not None and cancelled())
            preview = self._active_writing_preview.get()
            delivered = (preview is not None
                         and result.get("revision_id") in preview.ready_revision_ids)
            if (tool_name == "propose_writing_edit" and not result.get("error")
                    and (explicit_stop or preview is not None and not delivered)):
                discard = getattr(ctx.deps, "discard_writing_proposal", None)
                if callable(discard):
                    discard(result)
            raise


    def run_workflow(
        self,
        ctx: RunContext[KnowledgeToolRegistry],
        tool_name: str,
        payload: dict[str, object],
        detail: str,
    ) -> dict[str, object]:
        call_id = _tool_call_id(ctx, tool_name)
        self.emit(
            AgentToolEvent(
                tool=tool_name,
                phase="started",
                call_id=call_id,
                input=payload,
                detail=detail,
            )
        )
        try:
            previous = _completed_write_result(ctx.deps, tool_name, payload)
            result = (
                previous if previous is not None else self.invoke(ctx.deps, tool_name, **payload)
            )
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except RetrievalPipelineUnavailable:
            self.emit(
                AgentToolEvent(
                    tool=tool_name,
                    phase="failed",
                    call_id=call_id,
                    input=payload,
                    detail="检索证据链失败，本轮研究流程已中止",
                    error="retrieval_pipeline_unavailable",
                )
            )
            raise
        except Exception as error:
            result = {"error": "research_workflow_failed", "message": str(error)}
        self.emit(
            AgentToolEvent(
                tool=tool_name,
                phase="failed" if result.get("error") else "finished",
                call_id=call_id,
                input=payload,
                output=result,
                detail=str(result.get("message") or "研究流程状态已更新"),
                error=str(result["error"]) if result.get("error") else None,
            )
        )
        return result


    def run_analysis(
        self,
        ctx: RunContext[KnowledgeToolRegistry],
        tool_name: str,
        payload: dict[str, object],
        detail: str,
        *,
        candidate: bool,
    ) -> dict[str, object]:
        call_id = _tool_call_id(ctx, tool_name)
        self.emit(
            AgentToolEvent(
                tool=tool_name,
                phase="started",
                call_id=call_id,
                input=payload,
                detail=detail,
            )
        )
        try:
            invocation = dict(payload)
            if candidate:
                # The model never supplies provenance. The runner binds each
                # candidate to Pydantic AI's stable call identity.
                invocation["tool_call_id"] = call_id
            previous = _completed_write_result(ctx.deps, tool_name, payload)
            result = (
                previous if previous is not None else self.invoke(ctx.deps, tool_name, **invocation)
            )
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except Exception as error:
            failure = {
                "error": "research_analysis_tool_failed",
                "message": str(error),
            }
            self.emit(
                AgentToolEvent(
                    tool=tool_name,
                    phase="failed",
                    call_id=call_id,
                    input=payload,
                    output=failure,
                    detail="质性分析操作未完成",
                    error="research_analysis_tool_failed",
                )
            )
            return failure
        failed = bool(result.get("error"))
        self.emit(
            AgentToolEvent(
                tool=tool_name,
                phase="failed" if failed else "finished",
                call_id=call_id,
                input=payload,
                output=result,
                detail=(
                    str(result.get("message", "质性分析操作未完成"))
                    if failed
                    else "已生成待用户确认的分析候选"
                    if candidate
                    else "已读取质性分析"
                ),
                error=str(result["error"]) if failed else None,
            )
        )
        return result


    def emit(self, event: AgentToolEvent) -> None:
        cancelled = self._active_cancelled.get()
        if event.phase == "started" and cancelled is not None and cancelled():
            raise AgentInterrupted("Agent run was interrupted before another tool")
        callback = self._active_tool_event.get()
        if callback is not None:
            callback(event)
