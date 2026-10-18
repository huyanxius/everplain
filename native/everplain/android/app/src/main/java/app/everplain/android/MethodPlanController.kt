package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal val methodKinds =
    linkedMapOf(
        "undecided" to "暂缓决定",
        "qualitative" to "质性研究",
        "quantitative" to "定量研究",
        "mixed" to "混合研究",
    )
internal val methodRequired =
    mapOf(
        "undecided" to listOf("decision"),
        "qualitative" to
            listOf(
                "design",
                "research_object",
                "sampling",
                "material_acquisition",
                "analysis",
                "credibility",
                "reflexivity",
                "ethics",
            ),
        "quantitative" to
            listOf(
                "design",
                "operationalization",
                "variables_indicators",
                "hypotheses",
                "measurement",
                "sampling",
                "analysis_plan",
                "conditions",
                "limitations",
                "ethics",
            ),
        "mixed" to
            listOf(
                "design",
                "rationale",
                "sequence",
                "weight",
                "integration",
                "conflict_handling",
                "common_conclusions",
                "ethics",
            ),
    )

@Serializable
internal data class MethodDraft(
    val kind: String = "undecided",
    val rationale: String = "",
    val sections: List<MethodPlanSectionContract> = emptyList(),
    val version: Long = 0,
)

@Serializable
private data class MethodIntent(
    val action: String,
    val body: String,
    val key: String = newIntentKey(),
    val plan: String? = null,
    val review: String? = null,
)

internal data class MethodState(
    val plan: MethodPlanResponse? = null,
    val versions: List<MethodPlanResponse> = emptyList(),
    val draft: MethodDraft = MethodDraft(),
    val dirty: Boolean = false,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val conflict: Boolean = false,
    val unknown: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
) {
    val missing
        get() =
            methodRequired[draft.kind].orEmpty().count { key ->
                draft.sections.none { it.key == key && it.source == "user" }
            }

    val blockers
        get() = plan?.reviews.orEmpty().count { it.blocking && it.resolvedAt == null }

    val locked
        get() = busy || plan?.status in setOf("confirmed", "stale")

    val canConfirm
        get() =
            plan != null &&
                !locked &&
                !dirty &&
                !conflict &&
                !unknown &&
                missing == 0 &&
                blockers == 0
}

internal class MethodPlanController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val prefix = "method:${api.endpoint.origin}:$owner:$taskId"
    private var intent =
        store.read("$prefix:intent")?.let {
            runCatching { WireJson.decodeFromString<MethodIntent>(it) }.getOrNull()
        }
    private val savedDraft =
        store.read("$prefix:draft")?.let {
            runCatching { WireJson.decodeFromString<MethodDraft>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            MethodState(
                draft = savedDraft ?: MethodDraft(),
                dirty = savedDraft != null,
                unknown = intent != null,
            )
        )
    val state = mutable.asStateFlow()
    private var closed = false
    private var generation = 0L
    private var reader: Job? = null
    private var writer: Job? = null

    private fun update(f: (MethodState) -> MethodState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        reader?.cancel()
        writer?.cancel()
    }

    private fun draft(p: MethodPlanResponse) =
        MethodDraft(p.methodKind, p.rationale, p.sections, p.version)

    fun edit(
        kind: String? = null,
        rationale: String? = null,
        index: Int? = null,
        content: String? = null,
    ) {
        if (state.value.locked) return
        val old = state.value.draft
        val next =
            old.copy(
                kind = kind?.takeIf { it in methodKinds } ?: old.kind,
                rationale = rationale ?: old.rationale,
                sections =
                    if (index != null && content != null)
                        old.sections.mapIndexed { i, s ->
                            if (i == index) s.copy(content = content, source = "user") else s
                        }
                    else old.sections,
            )
        store.write("$prefix:draft", WireJson.encodeToString(next))
        update { it.copy(draft = next, dirty = true) }
    }

    fun load() {
        if (closed || state.value.busy) return
        reader?.cancel()
        val g = ++generation
        update { it.copy(loading = true, error = null) }
        reader =
            scope.launch {
                try {
                    val p = api.native.getCurrentMethodPlan(taskId)
                    val versions =
                        p?.let { api.native.listMethodPlanVersions(it.planId).items }.orEmpty()
                    if (g != generation) return@launch
                    update {
                        it.copy(
                            plan = p,
                            versions = versions,
                            draft = if (!it.dirty && p != null) draft(p) else it.draft,
                            conflict =
                                it.conflict ||
                                    (it.dirty &&
                                        p != null &&
                                        it.draft.version != 0L &&
                                        it.draft.version != p.version),
                        )
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) failure(e, false)
                } finally {
                    if (g == generation) update { it.copy(loading = false) }
                }
            }
    }

    fun rebase() {
        val p = state.value.plan ?: return
        if (state.value.busy || state.value.unknown) return
        clearIntent()
        val d = state.value.draft.copy(version = p.version)
        store.write("$prefix:draft", WireJson.encodeToString(d))
        update {
            it.copy(draft = d, conflict = false, unknown = false, notice = "已保留你的修改，采用最新版本作为保存依据。")
        }
    }

    fun discard() {
        val p = state.value.plan ?: return
        if (state.value.busy || state.value.unknown) return
        store.write("$prefix:draft", null)
        update { it.copy(draft = draft(p), dirty = false, conflict = false, error = null) }
    }

    private fun clearIntent() {
        intent = null
        store.write("$prefix:intent", null)
    }

    private fun failure(e: Exception, write: Boolean) {
        val f = e as? ApiFailure
        if (f?.status == 401) unauthorized(f)
        val conflict = f?.status == 409 && f.code?.contains("version") == true
        val known =
            f != null &&
                f.status in 400..499 &&
                f.status !in setOf(408, 429) &&
                (f.status != 409 || conflict)
        if (write && known) clearIntent()
        update {
            it.copy(
                error = f?.message ?: e.message ?: "方法计划请求未完成。结果未确认时不会自动重发。",
                conflict = conflict || it.conflict,
                unknown = if (write) !known else intent != null || it.unknown,
            )
        }
    }

    private fun execute(next: MethodIntent) {
        if (closed || state.value.busy) return
        if (intent != null && intent != next) {
            update { it.copy(error = "上次操作结果尚未确认，请先读取或重试原请求。") }
            return
        }
        store.write("$prefix:intent", WireJson.encodeToString(next))
        intent = next
        reader?.cancel()
        generation++
        update { it.copy(busy = true, loading = false, error = null, notice = null) }
        writer =
            scope.launch {
                try {
                    val p =
                        when (next.action) {
                            "create" ->
                                api.native.createMethodPlan(
                                    taskId,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "save" ->
                                api.native.updateMethodPlan(
                                    next.plan!!,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "confirm" ->
                                api.native.confirmMethodPlan(
                                    next.plan!!,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "review" ->
                                api.native.reviewMethodPlan(
                                    next.plan!!,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "resolve" ->
                                api.native.resolveMethodPlanReview(
                                    next.plan!!,
                                    next.review!!,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "restore" ->
                                api.native.restoreMethodPlan(
                                    next.plan!!,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            else -> error("Unknown local method action")
                        }
                    if (!closed) {
                        val currentDraft = state.value.draft
                        val keepDraft =
                            when (next.action) {
                                "save" ->
                                    WireJson.decodeFromString<UpdateMethodPlanRequest>(next.body)
                                        .let {
                                            currentDraft.kind != it.methodKind ||
                                                currentDraft.rationale != it.rationale ||
                                                currentDraft.sections != it.sections
                                        }
                                "create" ->
                                    currentDraft.kind !=
                                        WireJson.decodeFromString<CreateMethodPlanRequest>(
                                                next.body
                                            )
                                            .methodKind
                                "review",
                                "resolve" -> state.value.dirty
                                else -> false
                            }
                        val resultDraft =
                            if (keepDraft) currentDraft.copy(version = p.version) else draft(p)
                        clearIntent()
                        store.write(
                            "$prefix:draft",
                            if (keepDraft) WireJson.encodeToString(resultDraft) else null,
                        )
                        update {
                            it.copy(
                                plan = p,
                                draft = resultDraft,
                                dirty = keepDraft,
                                unknown = false,
                                conflict = false,
                                versions =
                                    listOf(p) +
                                        it.versions.filterNot { v -> v.version == p.version },
                                notice = if (keepDraft) "原操作已确认；仍保留你后来编辑的草稿。" else "方法计划已更新。",
                            )
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failure(e, true)
                } finally {
                    update { it.copy(busy = false) }
                }
            }
    }

    fun retry() {
        intent?.let(::execute)
    }

    fun create() {
        if (closed || state.value.busy || intent != null) return
        update { it.copy(busy = true, error = null) }
        writer =
            scope.launch {
                try {
                    val nav = api.native.getResearchTaskNavigation(taskId)
                    val framework = nav.currentFrameworkId ?: error("请先确认研究框架与理论方案。")
                    val theory = nav.currentTheoryPlanId ?: error("请先确认研究框架与理论方案。")
                    val next =
                        MethodIntent(
                            "create",
                            WireJson.encodeToString(
                                CreateMethodPlanRequest(framework, state.value.draft.kind, theory)
                            ),
                        )
                    update { it.copy(busy = false) }
                    execute(next)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failure(e, false)
                    update { it.copy(busy = false) }
                }
            }
    }

    fun save() {
        val s = state.value
        val p = s.plan ?: return
        if (s.locked || s.conflict || s.unknown) return
        execute(
            MethodIntent(
                "save",
                WireJson.encodeToString(
                    UpdateMethodPlanRequest(
                        "用户编辑方法计划",
                        s.draft.version,
                        s.draft.kind,
                        s.draft.rationale,
                        s.draft.sections,
                    )
                ),
                plan = p.planId,
            )
        )
    }

    fun confirm() {
        val s = state.value
        val p = s.plan ?: return
        if (!s.canConfirm) return
        execute(
            MethodIntent(
                "confirm",
                WireJson.encodeToString(ConfirmMethodPlanRequest(p.version, "用户确认方法计划")),
                plan = p.planId,
            )
        )
    }

    fun review(note: String, blocking: Boolean) {
        val s = state.value
        val p = s.plan ?: return
        if (s.locked || note.isBlank() || s.unknown) return
        execute(
            MethodIntent(
                "review",
                WireJson.encodeToString(ReviewMethodPlanRequest(blocking, p.version, note.trim())),
                plan = p.planId,
            )
        )
    }

    fun resolve(review: String) {
        val s = state.value
        val p = s.plan ?: return
        if (s.busy || p.status == "stale" || s.unknown) return
        execute(
            MethodIntent(
                "resolve",
                WireJson.encodeToString(ResolveMethodPlanReviewRequest(p.version, "已处理审校意见")),
                plan = p.planId,
                review = review,
            )
        )
    }

    fun restore(version: Long) {
        val s = state.value
        val p = s.plan ?: return
        if (s.busy || p.status == "stale" || s.unknown) return
        execute(
            MethodIntent(
                "restore",
                WireJson.encodeToString(
                    RestoreMethodPlanRequest(p.version, "恢复版本 $version", version)
                ),
                plan = p.planId,
            )
        )
    }
}
