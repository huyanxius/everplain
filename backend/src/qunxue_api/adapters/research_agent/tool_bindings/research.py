"""Task-scoped research candidates, documents and map bindings."""

from pydantic_ai import ModelRetry, RunContext

from qunxue_api.modules.agent_conversation import AgentInterrupted, AgentToolEvent

from ..catalog_tools import KnowledgeToolRegistry
from ..research_map_contracts import ResearchMapNodeInput, ResearchMapRelationInput
from ..tool_runtime import AgentToolCommitFailure, AgentToolRuntime
from ..tool_support import (
    _completed_write_result,
    _prepare_analysis_tool,
    _prepare_document_tool,
    _prepare_research_handoff_tool,
    _prepare_research_map_tool,
    _tool_call_id,
)


def register_analysis_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_analysis_tool, sequential=True)
    def get_research_analysis(
        ctx: RunContext[KnowledgeToolRegistry],
    ) -> dict[str, object]:
        """读取当前研究任务已有的标注、备忘与比较，不产生写入。"""

        return runtime.run_analysis(
            ctx,
            "get_research_analysis",
            {},
            "正在读取研究分析",
            candidate=False,
        )

    @runtime.tool(agent, prepare=_prepare_analysis_tool, sequential=True)
    def propose_analysis_memo(
        ctx: RunContext[KnowledgeToolRegistry],
        title: str,
        content: str,
        memo_kind: str,
        annotation_ids: list[str],
    ) -> dict[str, object]:
        """基于已有材料与分析提出待确认备忘；不会写入最终研究判断。"""

        return runtime.run_analysis(
            ctx,
            "propose_analysis_memo",
            {
                "title": title,
                "content": content,
                "memo_kind": memo_kind,
                "annotation_ids": annotation_ids,
            },
            "正在生成分析备忘候选",
            candidate=True,
        )

    @runtime.tool(agent, prepare=_prepare_analysis_tool, sequential=True)
    def get_research_comparison_context(
        ctx: RunContext[KnowledgeToolRegistry],
        case_labels: list[str],
        time_labels: list[str],
    ) -> dict[str, object]:
        """读取至少两个案例及可选时间锚点的已有分析，不产生写入。"""

        return runtime.run_analysis(
            ctx,
            "get_research_comparison_context",
            {
                "case_labels": case_labels,
                "time_labels": time_labels,
            },
            "正在读取案例比较上下文",
            candidate=False,
        )

    @runtime.tool(agent, prepare=_prepare_analysis_tool, sequential=True)
    def propose_case_comparison(
        ctx: RunContext[KnowledgeToolRegistry],
        title: str,
        question: str,
        case_labels: list[str],
        time_labels: list[str],
        findings: list[dict[str, object]],
        competing_explanations: list[str],
        evidence_gaps: list[str],
        next_steps: list[dict[str, object]],
        theory_implication: str,
    ) -> dict[str, object]:
        """提出待用户确认的案例比较；不会替用户决定理论或结论。"""

        return runtime.run_analysis(
            ctx,
            "propose_case_comparison",
            {
                "title": title,
                "question": question,
                "case_labels": case_labels,
                "time_labels": time_labels,
                "findings": findings,
                "competing_explanations": competing_explanations,
                "evidence_gaps": evidence_gaps,
                "next_steps": next_steps,
                "theory_implication": theory_implication,
            },
            "正在生成案例比较候选",
            candidate=True,
        )



def register_workflow_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_research_handoff_tool, sequential=True)
    def propose_start_research(
        ctx: RunContext[KnowledgeToolRegistry],
        phenomenon: str,
        research_intent: str | None = None,
        context: str | None = None,
    ) -> dict[str, object]:
        """提出待用户在界面确认的研究起点；不会创建任务或确认现象。"""
        payload = {
            "phenomenon": phenomenon,
            "research_intent": research_intent,
            "context": context,
        }
        return runtime.run_workflow(
            ctx, "propose_start_research", payload, "正在整理待确认的研究起点"
        )

    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def get_research_workflow_state(
        ctx: RunContext[KnowledgeToolRegistry],
    ) -> dict[str, object]:
        """读取当前对话绑定的项目、文稿与研究状态，不产生写入。"""
        return runtime.run_workflow(
            ctx, "get_research_workflow_state", {}, "正在读取研究流程状态"
        )

    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def start_theory_matching(
        ctx: RunContext[KnowledgeToolRegistry],
    ) -> dict[str, object]:
        """基于已确认现象和固定知识发布执行真实理论匹配，返回候选与证据。"""
        return runtime.run_workflow(
            ctx, "start_theory_matching", {}, "正在执行理论匹配"
        )

    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def save_confirmed_theory_plan(
        ctx: RunContext[KnowledgeToolRegistry],
        decisions: list[dict[str, object]],
        use_assignments: list[dict[str, object]],
        relations: list[dict[str, object]],
        user_confirmed: bool,
    ) -> dict[str, object]:
        """读取已有正式理论方案；模型声明不能代替真实用户审批。"""
        payload = {
            "decisions": decisions,
            "use_assignments": use_assignments,
            "relations": relations,
            "user_confirmed": user_confirmed,
        }
        return runtime.run_workflow(
            ctx, "save_confirmed_theory_plan", payload, "正在核对已确认理论方案"
        )



def register_document_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def read_research_document(
        ctx: RunContext[KnowledgeToolRegistry],
        document_id: str,
    ) -> dict[str, object]:
        """读取当前用户的一份研究文档及其固定知识发布版本。"""

        call_id = _tool_call_id(ctx, "read_research_document")
        tool_input = {"document_id": document_id}
        runtime.emit(
            AgentToolEvent(
                tool="read_research_document",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在读取研究文档",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "read_research_document", document_id)
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="read_research_document",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="研究文档读取失败",
                    error="research_document_read_failed",
                )
            )
            return {
                "error": "research_document_unavailable",
                "document_id": document_id,
            }
        runtime.emit(
            AgentToolEvent(
                tool="read_research_document",
                phase="finished",
                call_id=call_id,
                input=tool_input,
                output={
                    "document_id": result.get("document_id"),
                    "version": result.get("version"),
                    "knowledge_release_id": result.get("knowledge_release_id"),
                    "section_count": len(result.get("sections", [])),
                    "error": result.get("error"),
                },
                detail=(
                    "研究文档不可用"
                    if result.get("error")
                    else f"已读取研究文档 v{result.get('version')}"
                ),
            )
        )
        return result

    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def propose_document_revision(
        ctx: RunContext[KnowledgeToolRegistry],
        replacement_content: str,
        rationale: str,
        document_id: str | None = None,
        expected_version: int | None = None,
        section_id: str | None = None,
    ) -> dict[str, object]:
        """为一个文档章节生成待用户接受或拒绝的修改建议。

        此工具不会修改文档；正式写入只能由用户审批建议后发生。
        """

        call_id = _tool_call_id(ctx, "propose_document_revision")
        tool_input = {
            "document_id": document_id,
            "expected_version": expected_version,
            "section_id": section_id,
            "replacement_content": replacement_content,
            "rationale": rationale,
        }
        runtime.emit(
            AgentToolEvent(
                tool="propose_document_revision",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在生成文档修改建议",
            )
        )
        try:
            previous = _completed_write_result(
                ctx.deps, "propose_document_revision", tool_input
            )
            result = (
                previous
                if previous is not None
                else runtime.invoke(ctx.deps, "propose_document_revision", **tool_input)
            )
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="propose_document_revision",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="文档修改建议生成失败",
                    error="research_document_proposal_failed",
                )
            )
            return {
                "error": "research_document_proposal_unavailable",
                "document_id": document_id,
                "section_id": section_id,
            }
        runtime.emit(
            AgentToolEvent(
                tool="propose_document_revision",
                phase="finished",
                call_id=call_id,
                input=tool_input,
                output=result,
                detail=(
                    "修改建议未通过校验"
                    if result.get("error")
                    else "已生成待用户接受或拒绝的修改建议；文档尚未修改"
                ),
            )
        )
        return result

    @runtime.tool(agent, prepare=_prepare_document_tool, sequential=True)
    def propose_document_creation(
        ctx: RunContext[KnowledgeToolRegistry],
        title: str,
        sections: list[dict[str, object]],
        rationale: str,
    ) -> dict[str, object]:
        """为当前项目生成待用户采纳的文稿，不要求理论匹配。

        sections 为 1 到 32 个章节，每节必须有 section_id、key、title、content。
        citation_ids 可列出该节使用的本轮真实来源标识，工具自动保存引用坐标。
        根据实际任务自行安排章节，不套固定学科模板。
        """

        call_id = _tool_call_id(ctx, "propose_document_creation")
        tool_input = {"title": title, "sections": sections, "rationale": rationale}
        runtime.emit(
            AgentToolEvent(
                tool="propose_document_creation",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在生成研究文稿建议",
            )
        )
        try:
            previous = _completed_write_result(
                ctx.deps, "propose_document_creation", tool_input
            )
            result = (
                previous
                if previous is not None
                else runtime.invoke(ctx.deps, "propose_document_creation", **tool_input)
            )
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except Exception:
            result = {
                "error": "research_document_proposal_unavailable",
                "message": "研究文稿建议暂时无法生成。",
            }
        runtime.emit(
            AgentToolEvent(
                tool="propose_document_creation",
                phase="finished" if not result.get("error") else "failed",
                call_id=call_id,
                input=tool_input,
                output=result,
                detail=(
                    "已生成待用户审批的研究文稿"
                    if not result.get("error")
                    else str(result.get("message", "研究文稿生成失败"))
                ),
                error="research_document_proposal_failed" if result.get("error") else None,
            )
        )
        return result



def register_research_map_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_research_map_tool, retries=1, sequential=True)
    def ask_research_question(
        ctx: RunContext[KnowledgeToolRegistry],
        question: str,
        options: list[str] | None = None,
    ) -> dict[str, object]:
        """请研究者作一项判断；开放问题用空选项，选择问题给 2–4 个具体选项。

        提问后等待下一轮用户回答，不代选、不写入理论决定或文稿。
        """
        question = question.strip()
        if not question or len(question) > 600:
            raise ModelRetry("请提供不超过 600 字的具体问题")
        choices = list(dict.fromkeys(item.strip() for item in options or [] if item.strip()))
        if len(choices) > 4 or any(len(item) > 160 for item in choices):
            raise ModelRetry("最多提供 4 个选项，每项不超过 160 字")
        payload = {"question": question, "options": choices}
        call_id = _tool_call_id(ctx, "ask_research_question")
        for phase in ("started", "finished"):
            runtime.emit(
                AgentToolEvent(
                    tool="ask_research_question",
                    phase=phase,
                    call_id=call_id,
                    input=payload,
                    output=payload if phase == "finished" else None,
                    detail="请你决定研究的下一步",
                )
            )
        return payload

    @runtime.tool(agent, prepare=_prepare_research_map_tool, retries=1, sequential=True)
    def update_research_map(
        ctx: RunContext[KnowledgeToolRegistry],
        nodes: list[ResearchMapNodeInput] | None = None,
        relations: list[ResearchMapRelationInput] | None = None,
        remove_node_ids: list[str] | None = None,
        remove_relation_ids: list[str] | None = None,
        title: str | None = None,
        map_title: str | None = None,
    ) -> dict[str, object]:
        """在研究工作区提交一组可追溯的论证地图增量。

        节点必须提供 id/kind/title，kind 只能是
        question/theory/claim/evidence/gap/synthesis。关系必须提供
        source/target/relation。
        relation 只能是 explains/supports/challenges/derives/refines。
        证据节点的 citation_ids 必须来自本轮知识工具真实返回的证据。
        工具日志和回答文本不应创建节点。
        """
        call_id = _tool_call_id(ctx, "update_research_map")
        node_payload = [node.model_dump(exclude_none=True) for node in nodes or ()]
        relation_payload = [
            relation.model_dump(exclude_none=True) for relation in relations or ()
        ]
        payload = {
            "nodes": node_payload,
            "relations": relation_payload,
            "remove_node_ids": remove_node_ids or [],
            "remove_relation_ids": remove_relation_ids or [],
        }
        resolved_map_title = (map_title or title or "").strip()
        if resolved_map_title:
            payload["map_title"] = resolved_map_title
        runtime.emit(
            AgentToolEvent(
                tool="update_research_map",
                phase="started",
                call_id=call_id,
                input=payload,
                detail="正在组织研究地图",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "update_research_map",
                nodes=node_payload,
                relations=relation_payload,
                remove_node_ids=remove_node_ids,
                remove_relation_ids=remove_relation_ids,
            )
            if resolved_map_title:
                result = {**result, "map_title": resolved_map_title}
        except ValueError as error:
            runtime.emit(
                AgentToolEvent(
                    tool="update_research_map",
                    phase="failed",
                    call_id=call_id,
                    input=payload,
                    detail="研究地图更新未通过校验",
                    error="research_map_invalid_patch",
                )
            )
            raise ModelRetry(str(error)) from error
        except (AgentInterrupted, AgentToolCommitFailure):
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="update_research_map",
                    phase="failed",
                    call_id=call_id,
                    input=payload,
                    detail="研究地图暂时无法更新",
                    error="research_map_unavailable",
                )
            )
            raise
        runtime.emit(
            AgentToolEvent(
                tool="update_research_map",
                phase="finished",
                call_id=call_id,
                input=payload,
                output=result,
                detail=(
                    f"已更新 {len(result.get('nodes', []))} 个研究节点与 "
                    f"{len(result.get('relations', []))} 条关系"
                    + (
                        f"；{len(result['suggested_nodes'])} 条改写建议等待你确认"
                        if result.get("suggested_nodes") else ""
                    )
                ),
            )
        )
        return result
