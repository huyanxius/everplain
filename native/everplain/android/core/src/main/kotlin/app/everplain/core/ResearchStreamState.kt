package app.everplain.core

import app.everplain.shared.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

val researchPhases = listOf("拆解研究问题", "检索知识库与个人材料", "补充并阅读公开网页", "核对来源，整理研究结论")

@Serializable
data class NativeResearchProgress(
    val stage: String = "idle",
    val question: String = "",
    val options: List<String> = emptyList(),
    val step: Int = 0,
    val summary: String? = null,
    val knowledgeCount: Long? = null,
    val webCount: Long? = null,
    val waitingState: String? = null,
)

@Serializable
data class NativeToolActivity(
    val id: String,
    val tool: String,
    val phase: String,
    val detail: String? = null,
    val input: JsonElement? = null,
    val output: JsonElement? = null,
    val error: String? = null,
)

@Serializable
data class NativeTurnSignals(
    val research: NativeResearchProgress = NativeResearchProgress(),
    val tools: List<NativeToolActivity> = emptyList(),
    val citations: List<AgentCitationResponse> = emptyList(),
    val canvas: AgentResearchMapResponse? = null,
)

/** Semantic SSE state, separate from the byte/framing decoder. Unknown events preserve state. */
fun reduceTurnSignals(
    current: NativeTurnSignals,
    event: String,
    payload: JsonObject,
): NativeTurnSignals {
    fun text(key: String) = (payload[key] as? JsonPrimitive)?.contentOrNull
    fun strings(key: String) =
        (payload[key] as? JsonArray)?.mapNotNull {
            (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content
        } ?: emptyList()
    val r = current.research
    return when (event) {
        "research_ask" ->
            if (text("question") != null)
                current.copy(
                    research =
                        r.copy(
                            stage = "clarifying",
                            question = text("question")!!,
                            options = strings("options"),
                            step = 0,
                        )
                )
            else current
        "research_plan" ->
            if (text("title") != null)
                current.copy(
                    research =
                        r.copy(
                            stage = "planning",
                            question = text("title")!!,
                            options = strings("steps"),
                            step = 0,
                        )
                )
            else current
        "research_step" ->
            current.copy(
                research =
                    r.copy(
                        stage = "researching",
                        step = researchPhases.indexOf(text("step")).coerceAtLeast(0),
                        waitingState = null,
                    )
            )
        "research_result" ->
            current.copy(
                research =
                    r.copy(
                        stage = "completed",
                        summary = text("summary"),
                        knowledgeCount = (payload["knowledge_count"] as? JsonPrimitive)?.longOrNull,
                        webCount = (payload["web_count"] as? JsonPrimitive)?.longOrNull,
                        waitingState = null,
                    )
            )
        "research_waiting" ->
            when (text("state")) {
                "awaiting_clarification",
                "awaiting_plan_confirmation" ->
                    current.copy(
                        research =
                            r.copy(
                                stage =
                                    if (text("state") == "awaiting_clarification") "clarifying"
                                    else "planning",
                                question = text("question") ?: text("title") ?: r.question,
                                options =
                                    if (payload.containsKey("options")) strings("options")
                                    else strings("steps"),
                                step = 0,
                                waitingState = text("state"),
                            )
                    )
                else -> current
            }
        "tool_started",
        "tool_finished",
        "tool_failed" -> {
            val tool = text("tool") ?: return current
            val id =
                text("call_id")
                    ?: current.tools.lastOrNull { it.tool == tool && it.phase == "started" }?.id
                    ?: "$tool:${current.tools.size}"
            val old = current.tools.firstOrNull { it.id == id }
            val next =
                NativeToolActivity(
                    id,
                    tool,
                    event.removePrefix("tool_"),
                    text("detail") ?: old?.detail,
                    payload["input"] ?: payload["arguments"] ?: old?.input,
                    payload["output"] ?: old?.output,
                    if (event == "tool_failed")
                        text("message") ?: text("error") ?: text("detail") ?: "工具调用失败"
                    else null,
                )
            current.copy(
                tools =
                    if (old == null) current.tools + next
                    else current.tools.map { if (it.id == id) next else it }
            )
        }
        "citation_added" -> {
            val citation = WireJson.decodeFromJsonElement<AgentCitationResponse>(payload)
            current.copy(
                citations =
                    current.citations.filterNot { it.citationId == citation.citationId } + citation
            )
        }
        "canvas_patch" -> {
            val patch = WireJson.decodeFromJsonElement<AgentResearchMapPatchResponse>(payload)
            val map =
                current.canvas
                    ?: AgentResearchMapResponse(emptyList(), emptyList(), patch.schemaVersion)
            val updated =
                map.copy(
                    schemaVersion = patch.schemaVersion,
                    nodes =
                        map.nodes.filterNot {
                            it.id in patch.removeNodeIds || patch.nodes.any { n -> n.id == it.id }
                        } + patch.nodes,
                    relations =
                        map.relations.filterNot {
                            it.id in patch.removeRelationIds ||
                                patch.relations.any { e -> e.id == it.id }
                        } + patch.relations,
                )
            val ids = updated.nodes.map { it.id }.toSet()
            current.copy(
                canvas =
                    updated.copy(
                        relations =
                            updated.relations.filter { it.source in ids && it.target in ids }
                    )
            )
        }
        else -> current
    }
}

fun recoverySignals(run: AgentRunRecoveryResponse): NativeTurnSignals {
    val traces = run.toolSummary.orEmpty()
    var result = NativeTurnSignals()
    traces
        .filter { (it["tool"] as? JsonPrimitive)?.contentOrNull != null }
        .forEach { trace ->
            val phase = (trace["phase"] as? JsonPrimitive)?.contentOrNull ?: "finished"
            result = reduceTurnSignals(result, "tool_$phase", JsonObject(trace))
        }
    val waiting =
        traces.firstOrNull {
            (it["kind"] as? JsonPrimitive)?.contentOrNull == "deep_research_pending"
        }
    if (waiting != null && run.status.startsWith("awaiting_"))
        result =
            reduceTurnSignals(
                result,
                "research_waiting",
                JsonObject(waiting + mapOf("state" to JsonPrimitive(run.status))),
            )
    return result
}

fun canonicalSignals(turn: AgentTurnResponse): NativeTurnSignals {
    var result = NativeTurnSignals(citations = turn.assistant.citations.orEmpty())
    turn.toolTraces.orEmpty().forEach { trace ->
        if (trace.tool == "deep_research") {
            val output = trace.output as? JsonObject
            if (output?.get("schema_version")?.jsonPrimitive?.longOrNull == 1L)
                result =
                    result.copy(
                        research =
                            NativeResearchProgress(
                                stage = "completed",
                                question = turn.user.content,
                                knowledgeCount =
                                    output["knowledge_count"]?.jsonPrimitive?.longOrNull,
                                webCount = output["web_count"]?.jsonPrimitive?.longOrNull,
                            )
                    )
            return@forEach
        }
        val payload = buildJsonObject {
            put("call_id", trace.callId)
            put("tool", trace.tool)
            trace.detail?.let { put("detail", it) }
            trace.input?.let { put("input", JsonObject(it)) }
            trace.output?.let { put("output", it) }
            trace.error?.let { put("message", it) }
        }
        result = reduceTurnSignals(result, "tool_${trace.phase}", payload)
    }
    return result
}

fun completedSignals(live: NativeTurnSignals, turn: AgentTurnResponse): NativeTurnSignals {
    val canonical = canonicalSignals(turn)
    return canonical.copy(
        tools = canonical.tools.ifEmpty { live.tools },
        canvas = live.canvas,
        research =
            if (canonical.research.stage != "idle") canonical.research
            else if (live.research.stage != "idle")
                live.research.copy(stage = "completed", waitingState = null)
            else live.research,
    )
}
