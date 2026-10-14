package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable internal data class TheoryChoice(val version: Long, val action: String)

@Serializable
internal data class TheoryRelationDraft(
    val explanation: String = "",
    val premise: String = "",
    val supporting: String = "",
    val excluding: String = "",
    val distinguishing: String = "",
) {
    val ready
        get() =
            listOf(explanation, premise, supporting, excluding, distinguishing).all {
                it.isNotBlank()
            }

    fun request(ids: List<String>) =
        TheoryRelationInput(
            ids,
            listOf(distinguishing.trim()),
            listOf(excluding.trim()),
            explanation.trim(),
            premise.trim(),
            "complementary",
            listOf(supporting.trim()),
        )
}

@Serializable
internal data class TheoryDraft(
    val runId: String? = null,
    val choices: Map<String, TheoryChoice> = emptyMap(),
    val relation: TheoryRelationDraft = TheoryRelationDraft(),
)

@Serializable
private data class TheoryIntent(
    val action: String,
    val target: String,
    val body: String,
    val key: String = newIntentKey(),
    val candidate: String? = null,
    val acknowledgment: String? = null,
    val acknowledgmentKey: String = newIntentKey(),
)

internal data class TheoryState(
    val navigation: ResearchTaskNavigationResponse? = null,
    val run: MatchRunResponse? = null,
    val decision: TheoryDecisionSetResponse? = null,
    val draft: TheoryDraft = TheoryDraft(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val unknown: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
) {
    val adopted
        get() =
            run?.candidatePage
                ?.candidates
                .orEmpty()
                .filter { draft.choices[it.candidateId]?.action in setOf("adopt", "combine") }
                .map { it.candidateId }

    val canSubmit
        get() =
            !busy &&
                !unknown &&
                run != null &&
                draft.runId == run.matchRunId &&
                run.candidatePage.candidates.isNotEmpty() &&
                run.candidatePage.nextCursor == null &&
                run.candidatePage.candidates.all {
                    draft.choices[it.candidateId]?.let { choice ->
                        choice.version == it.version &&
                            choice.action in setOf("adopt", "combine", "retain", "exclude")
                    } == true
                } &&
                (adopted.size < 2 || draft.relation.ready)

    fun request(): CreateTheoryDecisionsRequest {
        val r = requireNotNull(run)
        return CreateTheoryDecisionsRequest(
            if (r.failedCandidateIds.isEmpty()) "complete" else "partial_with_user_ack",
            r.candidatePage.candidates.map { candidate ->
                val choice = requireNotNull(draft.choices[candidate.candidateId])
                TheoryDecisionInput(
                    choice.action,
                    candidate.candidateId,
                    choice.version,
                    "用户在理论判断工作台确认。",
                    if (choice.action == "combine")
                        adopted.filterNot { it == candidate.candidateId }
                    else emptyList(),
                    emptyList(),
                )
            },
            null,
            r.version,
            if (adopted.size > 1) listOf(draft.relation.request(adopted)) else emptyList(),
            r.candidatePage.candidates
                .filter {
                    draft.choices[it.candidateId]?.action in setOf("adopt", "retain", "combine")
                }
                .map { candidate ->
                    val primary = draft.choices[candidate.candidateId]?.action == "adopt"
                    TheoryUseAssignmentInput(
                        candidate.candidateId,
                        if (primary) "核心解释视角" else "补充解释视角",
                        if (primary) "primary" else "secondary",
                    )
                },
        )
    }
}

internal class TheoryController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val prefix = "theory:${api.endpoint.origin}:$owner:$taskId"
    private var intent =
        store.read("$prefix:intent")?.let {
            runCatching { WireJson.decodeFromString<TheoryIntent>(it) }.getOrNull()
        }
    private val initial =
        store.read("$prefix:draft")?.let {
            runCatching { WireJson.decodeFromString<TheoryDraft>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(TheoryState(draft = initial ?: TheoryDraft(), unknown = intent != null))
    val state = mutable.asStateFlow()
    private var closed = false
    private var reader: Job? = null
    private var writer: Job? = null
    private var generation = 0L

    private fun update(f: (TheoryState) -> TheoryState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        reader?.cancel()
        writer?.cancel()
    }

    private fun persist(d: TheoryDraft) {
        store.write("$prefix:draft", WireJson.encodeToString(d))
        update { it.copy(draft = d) }
    }

    fun choose(id: String, action: String) {
        val s = state.value
        val r = s.run ?: return
        val candidate = r.candidatePage.candidates.find { it.candidateId == id } ?: return
        if (closed || s.busy || action !in setOf("adopt", "combine", "retain", "exclude")) return
        if (s.draft.runId != null && s.draft.runId != r.matchRunId) return
        persist(
            s.draft.copy(
                runId = r.matchRunId,
                choices = s.draft.choices + (id to TheoryChoice(candidate.version, action)),
            )
        )
    }

    fun editRelation(f: (TheoryRelationDraft) -> TheoryRelationDraft) {
        if (!closed && !state.value.busy)
            persist(state.value.draft.copy(relation = f(state.value.draft.relation)))
    }

    fun startNewDraft() {
        if (closed || state.value.busy || state.value.unknown) return
        val old = state.value.draft
        old.runId?.let { store.write("$prefix:previous:$it", WireJson.encodeToString(old)) }
        persist(TheoryDraft(runId = state.value.run?.matchRunId))
    }

    fun load() {
        if (closed || state.value.busy) return
        reader?.cancel()
        val g = ++generation
        update { it.copy(loading = true, error = null) }
        reader =
            scope.launch {
                try {
                    val nav = api.native.getResearchTaskNavigation(taskId)
                    val run = nav.currentMatchRunId?.let { api.native.getMatchRun(it) }
                    val decision =
                        run?.let {
                            api.native.listTheoryDecisions(it.matchRunId).decisionSets.firstOrNull()
                        }
                    if (g != generation) return@launch
                    update {
                        it.copy(
                            navigation = nav,
                            run = run,
                            decision = decision,
                            draft =
                                if (it.draft.runId == null && decision != null)
                                    TheoryDraft(
                                        run?.matchRunId,
                                        decision.decisions.associate { d ->
                                            d.candidateId to
                                                TheoryChoice(d.candidateVersion, d.action)
                                        },
                                        decision.relations.firstOrNull()?.let { r ->
                                            TheoryRelationDraft(
                                                r.explanation,
                                                r.premiseCompatibility,
                                                r.supportingEvidence.joinToString("\n"),
                                                r.excludingEvidence.joinToString("\n"),
                                                r.distinguishingEvidence.joinToString("\n"),
                                            )
                                        } ?: TheoryRelationDraft(),
                                    )
                                else it.draft,
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
        update { it.copy(error = e.message ?: "理论判断操作未完成。", unknown = intent != null) }
    }

    private fun checkpoint(value: TheoryIntent) {
        store.write("$prefix:intent", WireJson.encodeToString(value))
        intent = value
    }

    private fun execute(original: TheoryIntent) {
        if (closed || state.value.busy) return
        if (intent != null && intent != original) {
            update { it.copy(error = "上次理论操作结果尚未确认，请重试原请求。") }
            return
        }
        checkpoint(original)
        reader?.cancel()
        val g = ++generation
        update { it.copy(busy = true, loading = false, error = null, notice = null) }
        writer =
            scope.launch {
                try {
                    var next = original
                    if (next.action == "submit" && next.acknowledgment != null) {
                        val acknowledged =
                            api.native.acknowledgePartialMatch(
                                next.target,
                                next.acknowledgmentKey,
                                WireJson.decodeFromString(next.acknowledgment!!),
                            )
                        if (g != generation || closed) return@launch
                        val request =
                            WireJson.decodeFromString<CreateTheoryDecisionsRequest>(next.body)
                                .copy(expectedMatchRunVersion = acknowledged.version)
                        next =
                            next.copy(
                                body = WireJson.encodeToString(request),
                                acknowledgment = null,
                            )
                        checkpoint(next)
                        update { it.copy(run = acknowledged) }
                    }
                    when (next.action) {
                        "start" -> {
                            val run =
                                api.native.createMatchRun(
                                    taskId,
                                    next.key,
                                    WireJson.decodeFromString<CreateMatchRunRequest>(next.body),
                                )
                            if (g == generation) {
                                val old = state.value.draft
                                old.runId?.let {
                                    store.write(
                                        "$prefix:previous:$it",
                                        WireJson.encodeToString(old),
                                    )
                                }
                                persist(TheoryDraft(runId = run.matchRunId))
                                update { it.copy(run = run, decision = null) }
                            }
                        }
                        "candidate" -> {
                            val run =
                                api.native.retryMatchCandidate(
                                    next.target,
                                    next.candidate!!,
                                    next.key,
                                    WireJson.decodeFromString<RetryMatchCandidateRequest>(next.body),
                                )
                            if (g == generation) update { it.copy(run = run) }
                        }
                        "submit" -> {
                            val decision =
                                api.native.createTheoryDecisions(
                                    next.target,
                                    next.key,
                                    WireJson.decodeFromString<CreateTheoryDecisionsRequest>(
                                        next.body
                                    ),
                                )
                            if (g == generation) update { it.copy(decision = decision) }
                        }
                        "confirm" -> {
                            api.native.confirmTheoryPlan(
                                next.target,
                                next.key,
                                WireJson.decodeFromString<ConfirmTheoryPlanRequest>(next.body),
                            )
                            if (g == generation) update { it.copy(decision = null) }
                        }
                        else -> error("Unknown theory intent")
                    }
                    if (closed || g != generation) return@launch
                    store.write("$prefix:intent", null)
                    intent = null
                    update { it.copy(unknown = false, notice = "理论判断已保存。") }
                    // Read-only refresh cannot turn a successful write into an ambiguous duplicate.
                    try {
                        val nav = api.native.getResearchTaskNavigation(taskId)
                        val run = state.value.run?.let { api.native.getMatchRun(it.matchRunId) }
                        if (g == generation) update { it.copy(navigation = nav, run = run) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        if (g == generation) failure(e, false)
                    }
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

    fun start() {
        val s = state.value
        val n = s.navigation ?: return
        val p = n.phenomenonSummary ?: return
        if (s.unknown || "start_matching" !in n.allowedActions || n.knowledgeReleaseId == null)
            return
        execute(
            TheoryIntent(
                "start",
                taskId,
                WireJson.encodeToString(
                    CreateMatchRunRequest(
                        n.version,
                        n.knowledgeReleaseId,
                        p.phenomenonQueryId,
                        p.version,
                    )
                ),
            )
        )
    }

    fun retryCandidate(id: String) {
        val s = state.value
        val r = s.run ?: return
        val p = r.failedCandidates.find { it.candidateId == id && it.retryable } ?: return
        if (s.unknown) return
        execute(
            TheoryIntent(
                "candidate",
                r.matchRunId,
                WireJson.encodeToString(RetryMatchCandidateRequest(p.version, r.version)),
                candidate = id,
            )
        )
    }

    fun submit() {
        val s = state.value
        if (!s.canSubmit) return
        val r = s.run!!
        val acknowledgment =
            if (r.failedCandidateIds.isNotEmpty() && !r.partialCompletionAcknowledged)
                WireJson.encodeToString(
                    AcknowledgePartialMatchRequest(
                        r.candidatePage.candidates.map { it.candidateId },
                        r.version,
                        r.failedCandidateIds,
                        "用户确认以当前可用候选继续理论判断。",
                    )
                )
            else null
        execute(
            TheoryIntent(
                "submit",
                r.matchRunId,
                WireJson.encodeToString(s.request()),
                acknowledgment = acknowledgment,
            )
        )
    }

    fun confirm() {
        val s = state.value
        val d = s.decision ?: return
        if (
            s.unknown ||
                "confirm_theory_plan" !in d.allowedActions ||
                d.decisions.any {
                    s.draft.choices[it.candidateId] != TheoryChoice(it.candidateVersion, it.action)
                }
        )
            return
        execute(
            TheoryIntent(
                "confirm",
                d.decisionSetId,
                WireJson.encodeToString(ConfirmTheoryPlanRequest(d.version)),
            )
        )
    }
}
