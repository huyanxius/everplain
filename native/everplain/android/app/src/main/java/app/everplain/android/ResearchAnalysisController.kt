package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal val memoKinds =
    linkedMapOf(
        "descriptive" to "描述备忘",
        "reflexive" to "反思备忘",
        "analytic" to "分析备忘",
        "methodological" to "方法备忘",
    )
internal val findingKinds =
    linkedMapOf(
        "support" to "支持证据",
        "counterexample" to "反例",
        "contradict" to "矛盾材料",
        "competing_explanation" to "竞争解释",
        "evidence_gap" to "证据缺口",
    )
internal val nextStepKinds =
    linkedMapOf(
        "interview" to "访谈",
        "observation" to "观察",
        "material_collection" to "补充材料",
        "research_question" to "修订研究问题",
    )

@Serializable
internal data class AnalysisMemoDraft(
    val open: Boolean = false,
    val title: String = "",
    val content: String = "",
    val kind: String = "analytic",
    val annotations: List<String> = emptyList(),
) {
    fun request() = CreateAnalysisMemoRequest(annotations, content.trim(), kind, title.trim())

    val ready
        get() = title.isNotBlank() && content.isNotBlank() && kind in memoKinds
}

@Serializable
internal data class AnalysisComparisonDraft(
    val open: Boolean = false,
    val units: List<String> = emptyList(),
    val annotations: List<String> = emptyList(),
    val title: String = "",
    val question: String = "",
    val support: String = "",
    val counterexample: String = "",
    val contradiction: String = "",
    val competing: String = "",
    val gap: String = "",
    val implication: String = "",
    val nextKind: String = "interview",
    val nextAction: String = "",
    val priority: String = "medium",
) {
    val ready
        get() =
            units.size >= 2 &&
                annotations.isNotEmpty() &&
                title.isNotBlank() &&
                question.isNotBlank() &&
                listOf(support, counterexample, contradiction).any { it.isNotBlank() } &&
                implication.isNotBlank()

    fun request(available: List<AnalysisComparisonUnit>): CreateCaseComparisonRequest {
        val selected = available.filter { it.id in units }
        return CreateCaseComparisonRequest(
            selected.map { it.label },
            listOf(competing.trim()).filter { it.isNotBlank() },
            listOf(gap.trim()).filter { it.isNotBlank() },
            listOf(
                    "support" to support,
                    "counterexample" to counterexample,
                    "contradict" to contradiction,
                )
                .filter { it.second.isNotBlank() }
                .map { ComparisonFindingContract(annotations, it.first, it.second.trim()) },
            if (nextAction.isBlank()) emptyList()
            else listOf(NextResearchStepContract(nextAction.trim(), nextKind, priority)),
            question.trim(),
            implication.trim(),
            selected.mapNotNull { it.timeLabel }.distinct(),
            title.trim(),
        )
    }
}

@Serializable
internal data class AnalysisDrafts(
    val memo: AnalysisMemoDraft = AnalysisMemoDraft(),
    val comparison: AnalysisComparisonDraft = AnalysisComparisonDraft(),
)

internal data class AnalysisComparisonUnit(
    val id: String,
    val label: String,
    val timeLabel: String? = null,
)

internal fun comparisonUnits(
    annotations: List<AnalysisAnnotationResponse>,
    names: Map<String, String>,
): List<AnalysisComparisonUnit> {
    val result = linkedMapOf<String, AnalysisComparisonUnit>()
    annotations.forEach { a ->
        a.caseLabel?.let { result["case:$it"] = AnalysisComparisonUnit("case:$it", "案例：$it") }
    }
    annotations.forEach { a ->
        a.observedAt?.let { result["time:$it"] = AnalysisComparisonUnit("time:$it", "时间：$it", it) }
    }
    annotations.forEach { a ->
        result["material:${a.materialId}"] =
            AnalysisComparisonUnit(
                "material:${a.materialId}",
                "材料：${names[a.materialId] ?: a.materialId}",
            )
    }
    return result.values.toList()
}

@Serializable
private data class AnalysisIntent(
    val action: String,
    val body: String,
    val id: String? = null,
    val key: String = newIntentKey(),
)

internal data class ResearchAnalysisState(
    val snapshot: ResearchAnalysisSnapshotResponse? = null,
    val cycle: ResearchCycleResponse? = null,
    val names: Map<String, String> = emptyMap(),
    val drafts: AnalysisDrafts = AnalysisDrafts(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val unknown: Boolean = false,
    val error: String? = null,
    val cycleError: String? = null,
    val notice: String? = null,
) {
    val units
        get() = comparisonUnits(snapshot?.annotations.orEmpty(), names)
}

internal class ResearchAnalysisController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val prefix = "analysis:${api.endpoint.origin}:$owner:$taskId"
    private var intent =
        store.read("$prefix:intent")?.let {
            runCatching { WireJson.decodeFromString<AnalysisIntent>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            ResearchAnalysisState(
                unknown = intent != null,
                drafts =
                    store.read("$prefix:drafts")?.let {
                        runCatching { WireJson.decodeFromString<AnalysisDrafts>(it) }.getOrNull()
                    } ?: AnalysisDrafts(),
            )
        )
    val state = mutable.asStateFlow()
    private var closed = false
    private var generation = 0L
    private var reader: Job? = null
    private var writer: Job? = null

    private fun update(f: (ResearchAnalysisState) -> ResearchAnalysisState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        reader?.cancel()
        writer?.cancel()
    }

    fun editMemo(f: (AnalysisMemoDraft) -> AnalysisMemoDraft) = edit { it.copy(memo = f(it.memo)) }

    fun editComparison(f: (AnalysisComparisonDraft) -> AnalysisComparisonDraft) = edit {
        it.copy(comparison = f(it.comparison))
    }

    private fun edit(f: (AnalysisDrafts) -> AnalysisDrafts) {
        if (closed || state.value.busy) return
        val next = f(state.value.drafts)
        store.write("$prefix:drafts", WireJson.encodeToString(next))
        update { it.copy(drafts = next) }
    }

    fun load() {
        if (closed || state.value.busy) return
        reader?.cancel()
        val g = ++generation
        update { it.copy(loading = true, error = null) }
        reader =
            scope.launch {
                try {
                    val snapshot = api.native.getResearchAnalysis(taskId)
                    if (g != generation) return@launch
                    update { it.copy(snapshot = snapshot) }
                    try {
                        val names =
                            api.native
                                .listResearchMaterials(taskId)
                                .items
                                .filter { it.status != "deleted" }
                                .associate { it.materialId to it.filename }
                        if (g == generation) update { it.copy(names = names) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        if (e is ApiFailure && e.status == 401) unauthorized(e)
                    }
                    loadCycle(g)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) failure(e, false)
                } finally {
                    if (g == generation) update { it.copy(loading = false) }
                }
            }
    }

    private suspend fun loadCycle(g: Long) {
        try {
            val cycle = api.native.getResearchCycle(taskId)
            check(cycle.schemaVersion == "research-cycle-v1") { "研究循环返回了不受支持的版本。" }
            if (g == generation) update { it.copy(cycle = cycle, cycleError = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiFailure && e.status == 401) unauthorized(e)
            if (g == generation) update { it.copy(cycleError = e.message ?: "研究循环暂时无法加载。") }
        }
    }

    private fun failure(e: Exception, write: Boolean) {
        val f = e as? ApiFailure
        if (f?.status == 401) unauthorized(f)
        val definitive =
            f != null &&
                f.status in 400..499 &&
                f.status !in setOf(408, 429) &&
                (f.status != 409 || f.code?.contains("version") == true)
        if (write && definitive) {
            intent = null
            store.write("$prefix:intent", null)
        }
        update { it.copy(error = e.message ?: "分析记录未保存。", unknown = intent != null) }
    }

    private fun execute(next: AnalysisIntent) {
        if (closed || state.value.busy) return
        if (intent != null && intent != next) {
            update { it.copy(error = "上次操作结果尚未确认，请先重试原请求。") }
            return
        }
        store.write("$prefix:intent", WireJson.encodeToString(next))
        intent = next
        reader?.cancel()
        val g = ++generation
        update { it.copy(busy = true, loading = false, error = null, notice = null) }
        writer =
            scope.launch {
                try {
                    val base =
                        state.value.snapshot
                            ?: ResearchAnalysisSnapshotResponse(
                                emptyList(),
                                emptyList(),
                                emptyList(),
                                taskId,
                            )
                    val updated =
                        when (next.action) {
                            "memo" ->
                                api.native
                                    .createResearchAnalysisMemo(
                                        taskId,
                                        next.key,
                                        WireJson.decodeFromString<CreateAnalysisMemoRequest>(
                                            next.body
                                        ),
                                    )
                                    .let { p ->
                                        base.copy(
                                            memos =
                                                base.memos.filterNot { it.memoId == p.memoId } + p
                                        )
                                    }
                            "memo-decision" ->
                                api.native
                                    .decideResearchAnalysisMemo(
                                        taskId,
                                        next.id!!,
                                        next.key,
                                        WireJson.decodeFromString<DecideAnalysisRecordRequest>(
                                            next.body
                                        ),
                                    )
                                    .let { p ->
                                        base.copy(
                                            memos =
                                                base.memos.map {
                                                    if (it.memoId == p.memoId) p else it
                                                }
                                        )
                                    }
                            "comparison" ->
                                api.native
                                    .createResearchCaseComparison(
                                        taskId,
                                        next.key,
                                        WireJson.decodeFromString<CreateCaseComparisonRequest>(
                                            next.body
                                        ),
                                    )
                                    .let { p ->
                                        base.copy(
                                            comparisons =
                                                base.comparisons.filterNot {
                                                    it.comparisonId == p.comparisonId
                                                } + p
                                        )
                                    }
                            "comparison-decision" ->
                                api.native
                                    .decideResearchCaseComparison(
                                        taskId,
                                        next.id!!,
                                        next.key,
                                        WireJson.decodeFromString<DecideAnalysisRecordRequest>(
                                            next.body
                                        ),
                                    )
                                    .let { p ->
                                        base.copy(
                                            comparisons =
                                                base.comparisons.map {
                                                    if (it.comparisonId == p.comparisonId) p else it
                                                }
                                        )
                                    }
                            else -> error("Unknown analysis intent")
                        }
                    if (closed || g != generation) return@launch
                    val drafts = state.value.drafts
                    val nextDrafts =
                        when {
                            next.action == "memo" &&
                                WireJson.encodeToString(drafts.memo.request()) == next.body ->
                                drafts.copy(memo = AnalysisMemoDraft())
                            next.action == "comparison" &&
                                WireJson.encodeToString(
                                    drafts.comparison.request(state.value.units)
                                ) == next.body ->
                                drafts.copy(comparison = AnalysisComparisonDraft())
                            else -> drafts
                        }
                    store.write("$prefix:drafts", WireJson.encodeToString(nextDrafts))
                    store.write("$prefix:intent", null)
                    intent = null
                    update {
                        it.copy(
                            snapshot = updated,
                            drafts = nextDrafts,
                            unknown = false,
                            notice = if (next.action.startsWith("memo")) "分析备忘已保存。" else "案例比较已保存。",
                        )
                    }
                    loadCycle(g)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) failure(e, true)
                } finally {
                    if (g == generation) update { it.copy(busy = false) }
                }
            }
    }

    fun retry() {
        intent?.let(::execute)
    }

    fun saveMemo() {
        val d = state.value.drafts.memo
        if (!d.ready || state.value.unknown) return
        val allowed = state.value.snapshot?.annotations.orEmpty().map { it.annotationId }.toSet()
        if (d.annotations.any { it !in allowed }) {
            update { it.copy(error = "关联标记已变化，请重新选择。") }
            return
        }
        execute(AnalysisIntent("memo", WireJson.encodeToString(d.request())))
    }

    fun saveComparison() {
        val s = state.value
        val d = s.drafts.comparison
        if (!d.ready || s.unknown) return
        if (
            d.units.any { id -> s.units.none { it.id == id } } ||
                d.annotations.any { id ->
                    s.snapshot?.annotations.orEmpty().none { it.annotationId == id }
                }
        ) {
            update { it.copy(error = "比较单元或原文标记已变化，请重新选择。") }
            return
        }
        execute(AnalysisIntent("comparison", WireJson.encodeToString(d.request(s.units))))
    }

    fun decideMemo(id: String, decision: String, reason: String) {
        val p =
            state.value.snapshot?.memos?.find {
                it.memoId == id && it.source == "agent" && it.status == "candidate"
            } ?: return
        decide("memo-decision", id, p.version, decision, reason)
    }

    fun decideComparison(id: String, decision: String, reason: String) {
        val p =
            state.value.snapshot?.comparisons?.find {
                it.comparisonId == id && it.source == "agent" && it.status == "candidate"
            } ?: return
        decide("comparison-decision", id, p.version, decision, reason)
    }

    private fun decide(
        action: String,
        id: String,
        version: Long,
        decision: String,
        reason: String,
    ) {
        if (decision !in setOf("confirmed", "rejected") || reason.isBlank() || state.value.unknown)
            return
        execute(
            AnalysisIntent(
                action,
                WireJson.encodeToString(
                    DecideAnalysisRecordRequest(decision, version, reason.trim())
                ),
                id,
            )
        )
    }
}
