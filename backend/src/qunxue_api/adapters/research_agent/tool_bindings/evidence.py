"""Evidence read bindings with explicit shared-Session and web scheduling."""

from pydantic_ai import RunContext

from qunxue_api.adapters.retrieval.errors import RetrievalPipelineUnavailable
from qunxue_api.modules.agent_conversation import AgentToolEvent
from qunxue_api.modules.shared_knowledge import KnowledgeIndexChoiceRequired

from ..catalog_tools import KnowledgeToolRegistry
from ..tool_runtime import AgentToolRuntime
from ..tool_support import (
    _append_result_evidence,
    _directory_trace_detail,
    _material_trace_detail,
    _prepare_knowledge_tool,
    _prepare_material_tool,
    _prepare_web_read_tool,
    _prepare_web_tool,
    _select_result_evidence,
    _source_trace_detail,
    _tool_call_id,
    _trace_detail,
    _trace_excerpt,
    _trace_items,
)


def register_knowledge_search_tool(agent, runtime: AgentToolRuntime) -> None:
    # These tools share the run's SQLite Session. Pydantic dispatches sync
    # tools in worker threads, so knowledge batches must never race that
    # Session/connection. Pure web-only batches keep their parallel policy.
    @runtime.tool(agent, prepare=_prepare_knowledge_tool, sequential=True)
    def search_knowledge(
        ctx: RunContext[KnowledgeToolRegistry], query: str
    ) -> list[dict[str, object]] | dict[str, object]:
        """按语义问题检索个人知识库。

        基于个人资料的解释、比较或分析默认先调用本工具取得依据，
        由模型根据语义和对话历史决定调用，
        并把问题提炼成真正的问题、概念或研究对象查询；不要检索工具规则、调用策略、
        能力边界、流程控制、问候或针对 Tool 行为的元反馈。空结果会返回模型，
        可在每轮最多 3 次的范围内调整概念查询后继续判断。
        """
        call_id = _tool_call_id(ctx, "search_knowledge")
        runtime.emit(
            AgentToolEvent(
                tool="search_knowledge",
                phase="started",
                call_id=call_id,
                input={"query": query},
                detail="正在检索知识库",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "search_knowledge", query)
        except KnowledgeIndexChoiceRequired as error:
            runtime.emit(AgentToolEvent(
                tool="search_knowledge", phase="finished", call_id=call_id,
                input={"query": query}, output={"knowledge_index_status": error.status},
                detail="资料索引未就绪，等待用户选择",
            ))
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="search_knowledge",
                    phase="failed",
                    call_id=call_id,
                    input={"query": query},
                    detail="知识库检索暂时失败",
                    error="knowledge_search_failed",
                )
            )
            return {
                "error": "knowledge_search_failed",
                "message": (
                    "知识库检索暂时失败，本次没有取得知识库证据。"
                    "请继续判断，并向用户明确说明证据边界。"
                ),
                "retryable": True,
            }
        _select_result_evidence(ctx.deps, result)
        trace_items = _trace_items(result)
        detail = _trace_detail(len(result), trace_items)
        runtime.emit(
            AgentToolEvent(
                tool="search_knowledge",
                phase="finished",
                call_id=call_id,
                input={"query": query},
                output={"result_count": len(result), "items": trace_items,
                        "knowledge_index_coverage": getattr(
                            ctx.deps, "knowledge_index_coverage", None)},
                detail=detail,
            )
        )
        return result



def register_knowledge_read_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_knowledge_tool, sequential=True)
    def read_knowledge_entry(
        ctx: RunContext[KnowledgeToolRegistry], knowledge_id: str
    ) -> dict[str, object]:
        """读取一次检索或目录预览实际返回的知识条目全文。

        只使用工具实际返回的 knowledge_id；不要猜测 ID，也不要把目录 node_id 当成条目 ID。
        """
        call_id = _tool_call_id(ctx, "read_knowledge_entry")
        runtime.emit(
            AgentToolEvent(
                tool="read_knowledge_entry",
                phase="started",
                call_id=call_id,
                input={"knowledge_id": knowledge_id},
                detail="正在读取知识条目",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "read_knowledge_entry", knowledge_id)
        except KnowledgeIndexChoiceRequired as error:
            runtime.emit(AgentToolEvent(
                tool="read_knowledge_entry", phase="finished", call_id=call_id,
                input={"knowledge_id": knowledge_id},
                output={"knowledge_index_status": error.status},
                detail="资料索引未就绪，等待用户选择",
            ))
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="read_knowledge_entry",
                    phase="failed",
                    call_id=call_id,
                    input={"knowledge_id": knowledge_id},
                    detail="知识条目读取暂时失败",
                    error="knowledge_entry_read_failed",
                )
            )
            raise
        found = "error" not in result
        runtime.emit(
            AgentToolEvent(
                tool="read_knowledge_entry",
                phase="finished",
                call_id=call_id,
                input={"knowledge_id": knowledge_id},
                output={
                    "found": found,
                    "knowledge_id": knowledge_id,
                    "title": result.get("title"),
                    "excerpt": _trace_excerpt(result.get("content")),
                    "knowledge_index_coverage": getattr(
                        ctx.deps, "knowledge_index_coverage", None),
                },
                detail=(
                    f"已读取知识条目：{result.get('title', knowledge_id)}"
                    if found
                    else "当前知识库没有这个条目"
                ),
            )
        )
        return result

    @runtime.tool(agent, prepare=_prepare_knowledge_tool, sequential=True)
    def read_sources(
        ctx: RunContext[KnowledgeToolRegistry], source_ids: list[str]
    ) -> list[dict[str, object]] | dict[str, object]:
        """读取当前知识条目已授权的来源信息。

        仅在用户要求出处、原始文献或可核验来源时使用，并且 source_ids 必须来自先前读取的条目。
        """
        call_id = _tool_call_id(ctx, "read_sources")
        safe_source_ids = list(source_ids)
        runtime.emit(
            AgentToolEvent(
                tool="read_sources",
                phase="started",
                call_id=call_id,
                input={"source_ids": safe_source_ids},
                detail="正在读取来源",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "read_sources", source_ids)
        except KnowledgeIndexChoiceRequired as error:
            runtime.emit(AgentToolEvent(
                tool="read_sources", phase="finished", call_id=call_id,
                input={"source_ids": source_ids},
                output={"knowledge_index_status": error.status},
                detail="资料索引未就绪，等待用户选择",
            ))
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="read_sources",
                    phase="failed",
                    call_id=call_id,
                    input={"source_ids": safe_source_ids},
                    detail="来源读取暂时失败",
                    error="source_read_failed",
                )
            )
            raise
        runtime.emit(
            AgentToolEvent(
                tool="read_sources",
                phase="finished",
                call_id=call_id,
                input={"source_ids": safe_source_ids},
                output={
                    "result_count": len(result),
                    "items": _trace_items(result),
                },
                detail=_source_trace_detail(result),
            )
        )
        return result

    @runtime.tool(agent, prepare=_prepare_knowledge_tool, sequential=True)
    def browse_knowledge_directory(
        ctx: RunContext[KnowledgeToolRegistry],
        query: str | None = None,
        limit: int = 24,
    ) -> list[dict[str, object]] | dict[str, object]:
        """浏览当前个人知识库的文件目录。

        适合用户询问知识库有哪些文件或想从目录探索时使用；普通问答优先直接回答，
        已有明确概念时优先 search_knowledge，不要用目录浏览替代检索。传入 query 时只返回
        相关目录；不传 query 时只返回顶层目录。返回的 node_id 不是 knowledge_id。
        """
        call_id = _tool_call_id(ctx, "browse_knowledge_directory")
        safe_limit = max(1, min(limit, 40))
        tool_input: dict[str, object] = {"limit": safe_limit}
        if query is not None:
            tool_input["query"] = query
        runtime.emit(
            AgentToolEvent(
                tool="browse_knowledge_directory",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在浏览知识目录",
            )
        )
        try:
            result = runtime.invoke(
                ctx.deps, "browse_knowledge_directory", query=query, limit=safe_limit,
            )
        except KnowledgeIndexChoiceRequired as error:
            runtime.emit(AgentToolEvent(
                tool="browse_knowledge_directory", phase="finished", call_id=call_id,
                input=tool_input, output={"knowledge_index_status": error.status},
                detail="资料索引未就绪，等待用户选择",
            ))
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="browse_knowledge_directory",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="知识目录读取暂时失败",
                    error="knowledge_directory_browse_failed",
                )
            )
            raise
        runtime.emit(
            AgentToolEvent(
                tool="browse_knowledge_directory",
                phase="finished",
                call_id=call_id,
                input=tool_input,
                output={
                    "result_count": len(result),
                    "items": _trace_items(result),
                },
                detail=_directory_trace_detail(result),
            )
        )
        return result



def register_web_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_web_tool)
    def search_web(
        ctx: RunContext[KnowledgeToolRegistry], query: str, limit: int = 5
    ) -> list[dict[str, object]] | dict[str, object]:
        """搜索公开网页。

        先把要回答的问题改写成你会输入网页搜索框的短查询；不要把工具反馈、
        元问题或整段聊天原样传入。需要互补角度时，分次调用本工具。
        """

        safe_limit = max(1, min(int(limit), 50))
        call_id = _tool_call_id(ctx, "search_web")
        tool_input = {"query": query, "limit": safe_limit}
        runtime.emit(AgentToolEvent(
            tool="search_web",
            phase="started",
            call_id=call_id,
            input=tool_input,
            detail="正在搜索公开网页",
        ))
        try:
            result = ctx.deps.search_web(query, limit=safe_limit)
        except Exception:
            runtime.emit(AgentToolEvent(
                tool="search_web",
                phase="failed",
                call_id=call_id,
                input=tool_input,
                detail="联网搜索暂时失败",
                error="web_search_failed",
            ))
            return {
                "error": "web_search_failed",
                "message": "联网搜索暂时失败，本轮没有取得网页证据。",
                "retryable": False,
            }
        if isinstance(result, dict):
            runtime.emit(AgentToolEvent(
                tool="search_web",
                phase="failed",
                call_id=call_id,
                input=tool_input,
                detail=str(result.get("message") or "联网搜索未返回网页证据"),
                error=str(result.get("error") or "web_search_failed"),
            ))
            return result
        runtime.emit(AgentToolEvent(
            tool="search_web",
            phase="finished",
            call_id=call_id,
            input=tool_input,
            output={"result_count": len(result), "items": _trace_items(result)},
            detail=f"找到 {len(result)} 个网页结果",
        ))
        return result

    @runtime.tool(agent, prepare=_prepare_web_read_tool)
    def read_web_page(
        ctx: RunContext[KnowledgeToolRegistry], url: str
    ) -> dict[str, object]:
        """直接读取用户提供或检索发现的网页正文，并登记可引用来源。"""

        call_id = _tool_call_id(ctx, "read_web_page")
        tool_input = {"url": url}
        runtime.emit(AgentToolEvent(
            tool="read_web_page",
            phase="started",
            call_id=call_id,
            input=tool_input,
            detail="正在读取网页正文",
        ))
        try:
            result = ctx.deps.read_web_page(url)
        except Exception:
            runtime.emit(AgentToolEvent(
                tool="read_web_page",
                phase="failed",
                call_id=call_id,
                input=tool_input,
                detail="网页正文暂时无法读取",
                error="web_page_read_failed",
            ))
            return {
                "error": "web_page_read_failed",
                "message": "网页正文暂时无法读取，不能把搜索摘要当作原文。",
                "retryable": False,
            }
        _append_result_evidence(ctx.deps, [result])
        runtime.emit(AgentToolEvent(
            tool="read_web_page",
            phase="finished",
            call_id=call_id,
            input=tool_input,
            output={"result_count": 1, "items": _trace_items([result])},
            detail=f"已读取网页：{result.get('title') or url}",
        ))
        return result



def register_material_tools(agent, runtime: AgentToolRuntime) -> None:
    @runtime.tool(agent, prepare=_prepare_material_tool, sequential=True)
    def search_research_materials(
        ctx: RunContext[KnowledgeToolRegistry], query: str, limit: int = 5
    ) -> list[dict[str, object]] | dict[str, object]:
        """检索当前研究任务中用户上传且仍有效的个人材料片段。

        结果总是带有 ``research_material`` 类型、稳定 segment locator 和
        ``personal_material`` 来源标记；工具不会访问其他任务或已删除正文。
        """
        safe_limit = max(1, min(int(limit), 50))
        call_id = _tool_call_id(ctx, "search_research_materials")
        tool_input = {"query": query, "limit": safe_limit}
        runtime.emit(
            AgentToolEvent(
                tool="search_research_materials",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在检索个人研究材料",
            )
        )
        try:
            result = runtime.invoke(ctx.deps, "search_research_materials", query, limit=safe_limit)
        except RetrievalPipelineUnavailable:
            runtime.emit(
                AgentToolEvent(
                    tool="search_research_materials",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="个人材料检索暂时失败",
                    error="research_material_search_failed",
                )
            )
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="search_research_materials",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="个人材料检索暂时失败",
                    error="research_material_search_failed",
                )
            )
            return {
                "error": "research_material_search_failed",
                "message": "个人研究材料检索暂时失败，请继续判断证据边界。",
                "retryable": True,
            }
        if isinstance(result, list):
            if result:
                _append_result_evidence(ctx.deps, result)
            count = len(result)
            output = {"result_count": count, "items": _trace_items(result)}
            detail = _material_trace_detail(result)
        else:
            output = result
            detail = str(result.get("message", "当前没有绑定个人研究材料"))
        runtime.emit(
            AgentToolEvent(
                tool="search_research_materials",
                phase="finished" if isinstance(result, list) else "failed",
                call_id=call_id,
                input=tool_input,
                output=output,
                detail=detail,
                error=None if isinstance(result, list) else str(result.get("error")),
            )
        )
        return result

    @runtime.tool(agent, prepare=_prepare_material_tool, sequential=True)
    def read_research_material_context(
        ctx: RunContext[KnowledgeToolRegistry],
        material_id: str,
        segment_id: str | None = None,
        parse_id: str | None = None,
        before: int = 2,
        after: int = 2,
    ) -> dict[str, object]:
        """用 material_id 直接打开文件；省略 segment_id 从正文开头读，无需先搜索。

        长文件可用结果中的 next_segment_id 继续读取后文。
        重解析后重新打开历史引用时，必须把引用携带的 ``parse_id``
        一并传入；省略它只读取材料当前解析版本。
        """
        safe_before = max(0, min(int(before), 4))
        safe_after = max(0, min(int(after), 4))
        call_id = _tool_call_id(ctx, "read_research_material_context")
        tool_input = {
            "material_id": material_id,
            "segment_id": segment_id,
            "parse_id": parse_id,
            "before": safe_before,
            "after": safe_after,
        }
        runtime.emit(
            AgentToolEvent(
                tool="read_research_material_context",
                phase="started",
                call_id=call_id,
                input=tool_input,
                detail="正在读取个人材料原文上下文",
            )
        )
        try:
            if parse_id is None:
                # Keep the call compatible with older test doubles and
                # adapters while the optional argument rolls out.
                result = runtime.invoke(ctx.deps, "read_research_material_context",
                    material_id,
                    segment_id,
                    before=safe_before,
                    after=safe_after,
                )
            else:
                result = runtime.invoke(ctx.deps, "read_research_material_context",
                    material_id,
                    segment_id,
                    parse_id=parse_id,
                    before=safe_before,
                    after=safe_after,
                )
        except RetrievalPipelineUnavailable:
            runtime.emit(
                AgentToolEvent(
                    tool="read_research_material_context",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="个人材料原文读取暂时失败",
                    error="research_material_context_failed",
                )
            )
            raise
        except Exception:
            runtime.emit(
                AgentToolEvent(
                    tool="read_research_material_context",
                    phase="failed",
                    call_id=call_id,
                    input=tool_input,
                    detail="个人材料原文读取暂时失败",
                    error="research_material_context_failed",
                )
            )
            return {
                "error": "research_material_context_failed",
                "material_id": material_id,
                "segment_id": segment_id,
            }
        found = "error" not in result
        if found:
            # Consecutive file reads contribute to one comparison's evidence.
            _append_result_evidence(ctx.deps, [result])
        runtime.emit(
            AgentToolEvent(
                tool="read_research_material_context",
                phase="finished" if found else "failed",
                call_id=call_id,
                input=tool_input,
                output={
                    "found": found,
                    "material_id": material_id,
                    "segment_id": segment_id,
                    "locator": result.get("locator"),
                    "context_count": len(result.get("context", []))
                    if isinstance(result.get("context"), list)
                    else 0,
                },
                detail="已读取个人材料原文上下文" if found else "没有找到当前材料片段",
                error=None if found else str(result.get("error")),
            )
        )
        return result
