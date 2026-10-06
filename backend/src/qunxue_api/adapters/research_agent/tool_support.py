"""Bounded tool payloads, availability and evidence projection shared by adapters."""

from collections.abc import Mapping, Sequence

from pydantic_ai import RunContext, ToolDefinition

from qunxue_api.modules.agent_conversation import AgentEvidence, AgentToolContext

from .catalog_tools import KnowledgeToolRegistry

_REPLAYABLE_WRITES = frozenset(
    {
        "propose_analysis_memo",
        "propose_case_comparison",
        "propose_document_revision",
        "propose_document_creation",
        "start_theory_matching",
    }
)


def _trace_items(values, *, limit: int = 4) -> list[dict[str, object]]:
    """Return bounded, user-safe facts for the visible tool trace."""

    items: list[dict[str, object]] = []
    for value in values[:limit]:
        if isinstance(value, AgentEvidence):
            item = {
                "title": value.label,
                "excerpt": _trace_excerpt(value.excerpt),
                "evidence_status": "verified",
            }
            for key, field_value in (
                ("knowledge_id", value.knowledge_id),
                ("material_id", value.material_id),
                ("parse_id", value.parse_id),
                ("segment_id", value.segment_id),
                ("source_id", value.source_id),
                ("source_kind", value.source_kind),
            ):
                if field_value is not None:
                    item[key] = field_value
            if value.locator is not None:
                item["locator"] = dict(value.locator)
        elif isinstance(value, Mapping):
            item = {}
            for key in (
                "url",
                "knowledge_id",
                "material_id",
                "segment_id",
                "source_kind",
                "node_id",
                "source_id",
                "title",
                "excerpt",
                "content_excerpt",
                "evidence_status",
                "verification_status",
                "entry_count",
            ):
                if key in value and value[key] is not None:
                    item[key] = (
                        "verified"
                        if key == "evidence_status"
                        else _trace_excerpt(value[key])
                        if key in {"excerpt", "content_excerpt"}
                        else value[key]
                    )
            nested = value.get("entries")
            if isinstance(nested, list) and nested:
                item["entries"] = _trace_items(nested, limit=3)
        else:
            continue
        if item:
            items.append(item)
    return items


def _trace_excerpt(value: object, *, limit: int = 220) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _trace_detail(
    count: int,
    items: list[dict[str, object]],
) -> str:
    if not items:
        return "没有找到可展示的知识条目"
    labels = []
    for item in items[:3]:
        title = item.get("title") or item.get("knowledge_id") or item.get("node_id")
        excerpt = item.get("excerpt") or item.get("content_excerpt")
        labels.append(f"{title}{f'：{excerpt}' if excerpt else ''}")
    return f"找到 {count} 条可引用证据：{'；'.join(labels)}"


def _material_trace_detail(values: Sequence[Mapping[str, object]]) -> str:
    if not values:
        return "没有找到可展示的个人材料片段"
    labels = []
    for item in values[:3]:
        title = item.get("title") or item.get("material_id") or "个人材料"
        locator = item.get("locator")
        labels.append(f"{title}{f'（{_locator_trace(locator)}）' if locator else ''}")
    return f"找到 {len(values)} 条个人材料证据：{'；'.join(labels)}"


def _locator_trace(value: object) -> str:
    if not isinstance(value, Mapping):
        return "原文位置"
    pieces: list[str] = []
    if value.get("page") is not None:
        pieces.append(f"第{value['page']}页")
    if value.get("paragraph") is not None:
        pieces.append(f"第{value['paragraph']}段")
    if value.get("line_start") is not None:
        end = value.get("line_end") or value["line_start"]
        pieces.append(f"第{value['line_start']}-{end}行")
    return "，".join(pieces) or "原文位置"


def _source_trace_detail(values) -> str:
    items = _trace_items(values)
    labels = [str(item.get("title") or item.get("source_id")) for item in items]
    return f"找到 {len(values)} 个来源" + (f"：{'；'.join(labels)}" if labels else "")


def _directory_trace_detail(values) -> str:
    items = _trace_items(values)
    labels = []
    for item in items[:3]:
        title = item.get("title") or item.get("node_id")
        entries = item.get("entries")
        if entries:
            entry_titles = "、".join(
                str(entry.get("title")) for entry in entries if entry.get("title")
            )
            labels.append(f"{title}（{entry_titles}）")
        else:
            labels.append(str(title))
    return f"找到 {len(values)} 个目录节点" + (f"：{'；'.join(labels)}" if labels else "")


def _prepare_knowledge_tool(ctx: RunContext, definition: ToolDefinition):
    if getattr(ctx.deps, "catalog_available", True) or getattr(ctx.deps, "private_knowledge", None):
        return definition
    return None


def _prepare_research_map_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Hide the research mutation tool completely from ordinary `/agent` turns."""

    return definition if getattr(ctx.deps, "research_map_enabled", False) else None


def _prepare_research_handoff_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Expose only the approval-gated, non-task-creating handoff outside research."""

    return (
        definition
        if getattr(ctx.deps, "research_handoff_tools_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _prepare_writing_tool(ctx: RunContext, definition: ToolDefinition):
    return definition if (
        getattr(ctx.deps, "writing_tools_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
    ) else None


def _prepare_document_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Expose document tools only when the scoped registry implements them."""

    if (
        not getattr(ctx.deps, "catalog_available", True)
        and definition.name in {"start_theory_matching", "save_confirmed_theory_plan"}
    ):
        return None
    return (
        definition
        if getattr(ctx.deps, "research_document_tools_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _prepare_web_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Expose open-web tools only when the user enables them for this turn."""

    return (
        definition
        if getattr(ctx.deps, "web_search_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _prepare_web_read_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    return (
        definition
        if getattr(ctx.deps, "web_read_enabled", getattr(ctx.deps, "web_search_enabled", False))
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _prepare_material_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Expose personal-material tools only for an authorized bound task."""

    return (
        definition
        if getattr(ctx.deps, "research_material_tools_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _prepare_analysis_tool(
    ctx: RunContext[KnowledgeToolRegistry],
    definition: ToolDefinition,
) -> ToolDefinition | None:
    """Expose only approval-gated analysis tools with complete run provenance."""

    return (
        definition
        if getattr(ctx.deps, "research_analysis_tools_enabled", False)
        and callable(getattr(ctx.deps, definition.name, None))
        else None
    )


def _select_result_evidence(
    tools: AgentToolContext,
    results: Sequence[Mapping[str, object]],
) -> None:
    citation_ids: list[str] = []
    for result in results:
        citation_id = result.get("citation_id")
        if isinstance(citation_id, str):
            citation_ids.append(citation_id)
        source_ids = result.get("source_citation_ids")
        if isinstance(source_ids, list):
            citation_ids.extend(value for value in source_ids if isinstance(value, str))
    incoming = tuple(dict.fromkeys(citation_ids))
    if not incoming:
        _set_selected_evidence(
            tools,
            tuple(
                key
                for key in getattr(tools, "selected_evidence_ids", ())
                if _evidence_source_bucket(tools, key) == "shared"
            ),
        )
        return

    # A research turn may deliberately combine a public concept with a
    # task-scoped personal excerpt.  Keep both source kinds in that case;
    # repeated searches within one source still replace the previous closed
    # set, preserving the existing reformulation behavior.
    existing = tuple(getattr(tools, "selected_evidence_ids", ()))
    incoming_kinds = {_evidence_source_bucket(tools, citation_id) for citation_id in incoming}
    if existing and len(incoming_kinds) == 1:
        # A reformulation replaces candidates from its own evidence pool while
        # retaining knowledge, personal material, and web evidence from the
        # other pools used in the same answer.
        incoming_bucket = next(iter(incoming_kinds))
        preserved = tuple(
            citation_id
            for citation_id in existing
            if _evidence_source_bucket(tools, citation_id) != incoming_bucket
        )
        selected = tuple(dict.fromkeys((*preserved, *incoming)))
    else:
        selected = incoming
    _set_selected_evidence(tools, selected)


def _append_result_evidence(
    tools: AgentToolContext,
    results: Sequence[Mapping[str, object]],
) -> None:
    """Accumulate successfully read web pages without dropping prior evidence."""

    citation_ids: list[str] = []
    for result in results:
        citation_id = result.get("citation_id")
        if isinstance(citation_id, str):
            citation_ids.append(citation_id)
    incoming = tuple(dict.fromkeys(citation_ids))
    if not incoming:
        return
    existing = tuple(getattr(tools, "selected_evidence_ids", ()))
    _set_selected_evidence(tools, tuple(dict.fromkeys((*existing, *incoming))))


def _set_selected_evidence(tools: AgentToolContext, citation_ids: Sequence[str]) -> None:
    """Keep partial test/tool contexts compatible with the evidence protocol.

    Production registries expose ``select_evidence`` so the closed citation set
    is persisted in the run context.  A few lightweight deterministic runner
    fixtures intentionally provide only search and evidence maps; preserving
    their selected ids locally keeps those fixtures useful without weakening
    the production protocol.
    """

    selector = getattr(tools, "select_evidence", None)
    if callable(selector):
        selector(citation_ids)
        return
    try:
        tools.selected_evidence_ids = tuple(citation_ids)  # type: ignore[attr-defined]
    except (AttributeError, TypeError):
        # Immutable partial contexts cannot retain selection, but they can
        # still produce the deterministic answer and trace.
        return


def _evidence_source_bucket(tools: AgentToolContext, citation_id: str) -> str:
    evidence = tools.evidence.get(citation_id)
    source_kind = getattr(evidence, "source_kind", None)
    if source_kind == "personal_material":
        return "personal"
    if source_kind == "shared_material":
        return "shared"
    if source_kind == "web":
        return "web"
    return "public"


def _tool_call_id(ctx: RunContext[KnowledgeToolRegistry], tool: str) -> str:
    return ctx.tool_call_id or f"{ctx.run_id or 'agent-run'}:{ctx.run_step}:{tool}"


def _completed_write_result(tools, tool_name: str, payload: dict[str, object]):
    if tool_name not in _REPLAYABLE_WRITES:
        return None
    checkpoint = getattr(tools, "agent_run_checkpoint", {})
    for entry in reversed(checkpoint.get("tool_summary", [])):
        output = entry.get("output")
        if (entry.get("tool") == tool_name and entry.get("phase") == "finished"
            and entry.get("input") == payload and isinstance(output, dict)
            and not output.get("error")):
            return dict(output)
    return None
