package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal fun researchDocumentSections(mode: String) =
    (if (mode == "framework")
            listOf(
                "research_question" to "研究问题",
                "research_object_and_field" to "研究对象与场域",
                "theoretical_perspective" to "理论视角",
                "core_concepts" to "核心概念",
                "mechanisms" to "作用机制",
                "questions_or_hypotheses" to "研究假设与质性问题",
                "methodology" to "研究方法",
                "sample_and_sources" to "样本与资料来源",
                "analysis_steps" to "分析步骤",
                "ethics" to "伦理风险",
                "limitations" to "局限",
                "evidence_gaps" to "证据缺口",
            )
        else
            listOf(
                "research_question" to "研究问题",
                "core_phenomenon" to "核心现象",
                "candidate_theories" to "候选理论",
                "theory_fit" to "理论适配与张力",
                "evidence" to "证据引用",
                "theory_decision" to "我的理论选择",
            ))
        .map { (key, title) ->
            ResearchDocumentSectionContract(
                emptyList(),
                "",
                emptyList(),
                key,
                key,
                "needs_user_decision",
                title,
            )
        }

@Serializable
internal data class ResearchDocumentDraft(
    val documentId: String,
    val version: Long,
    val sections: List<ResearchDocumentSectionContract>,
)

@Serializable
private data class DocumentIntent(
    val action: String,
    val target: String,
    val body: String,
    val key: String = newIntentKey(),
)

internal data class ResearchDocumentState(
    val navigation: ResearchTaskNavigationResponse? = null,
    val document: ResearchDocumentResponse? = null,
    val draft: ResearchDocumentDraft? = null,
    val versions: List<ResearchDocumentResponse> = emptyList(),
    val proposals: List<ResearchDocumentProposalResponse> = emptyList(),
    val gate: ResearchDocumentCompletionGateResponse? = null,
    val formatting: ResearchDocumentFormattingContract? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val unknown: Boolean = false,
    val conflict: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
) {
    val dirty
        get() =
            draft != null &&
                (document == null ||
                    draft.documentId != document.documentId ||
                    draft.sections != document.sections)

    val ready
        get() = !busy && !unknown && !conflict && !dirty && document != null
}

/**
 * Native manuscript state; 900 ms user-edit autosave, immutable CAS intents and retained drafts.
 */
internal class ResearchDocumentController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    val mode: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val prefix = "research-document:${api.endpoint.origin}:$owner:$taskId:$mode"
    private var intent =
        store.read("$prefix:intent")?.let {
            runCatching { WireJson.decodeFromString<DocumentIntent>(it) }.getOrNull()
        }
    private val saved =
        store.read("$prefix:draft")?.let {
            runCatching { WireJson.decodeFromString<ResearchDocumentDraft>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(ResearchDocumentState(draft = saved, unknown = intent != null))
    val state = mutable.asStateFlow()
    private var closed = false
    private var active = true
    private var generation = 0L
    private var reader: Job? = null
    private var writer: Job? = null
    private var autosave: Job? = null

    private fun update(f: (ResearchDocumentState) -> ResearchDocumentState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        reader?.cancel()
        writer?.cancel()
        autosave?.cancel()
    }

    fun leave() {
        active = false
        autosave?.cancel()
    }

    fun enter() {
        active = true
        load()
    }

    private fun draft(p: ResearchDocumentResponse) =
        ResearchDocumentDraft(p.documentId, p.version, p.sections)

    private fun persist(value: ResearchDocumentDraft?) =
        store.write("$prefix:draft", value?.let { WireJson.encodeToString(it) })

    fun edit(sectionId: String, content: String) {
        val s = state.value
        val p = s.document ?: return
        if (closed || (s.draft != null && s.draft.documentId != p.documentId)) return
        val current = s.draft ?: draft(p)
        if (current.sections.none { it.sectionId == sectionId }) return
        val next =
            current.copy(
                sections =
                    current.sections.map {
                        if (it.sectionId == sectionId) it.copy(content = content) else it
                    }
            )
        persist(next)
        update { it.copy(draft = next) }
        scheduleSave()
    }

    fun editFormatting(value: ResearchDocumentFormattingContract) {
        if (closed || state.value.busy) return
        update { it.copy(formatting = value) }
    }

    private fun scheduleSave() {
        autosave?.cancel()
        if (!active || state.value.unknown || state.value.conflict || state.value.busy) return
        autosave =
            scope.launch {
                delay(900)
                save()
            }
    }

    fun load() {
        if (closed || state.value.busy) return
        reader?.cancel()
        val g = ++generation
        update { it.copy(loading = true, error = null) }
        reader =
            scope.launch {
                try {
                    val navigation = api.native.getResearchTaskNavigation(taskId)
                    val documents = api.native.listResearchDocuments(taskId).items
                    val old = state.value.draft?.documentId ?: state.value.document?.documentId
                    val currentId =
                        if (mode == "framework") navigation.currentFrameworkId
                        else navigation.currentTheoryPlanId
                    val p =
                        documents.find { it.documentId == old }
                            ?: documents.find {
                                if (mode == "framework") it.documentId == currentId
                                else it.theoryPlanId == currentId
                            }
                            ?: documents.firstOrNull()
                    val proposals = api.native.listResearchTaskDocumentProposals(taskId).items
                    val versions =
                        p?.let { api.native.listResearchDocumentVersions(it.documentId).items }
                            .orEmpty()
                    if (g != generation) return@launch
                    update { previous ->
                        previous.copy(
                            navigation = navigation,
                            document = p,
                            proposals = proposals,
                            versions = versions,
                            draft =
                                if (
                                    p != null &&
                                        (previous.draft == null ||
                                            (previous.draft.documentId == p.documentId &&
                                                previous.draft.sections == p.sections))
                                )
                                    draft(p)
                                else previous.draft,
                            formatting =
                                if (
                                    previous.formatting == null ||
                                        previous.formatting == previous.document?.formatting
                                )
                                    p?.formatting
                                else previous.formatting,
                            conflict =
                                previous.conflict ||
                                    (previous.draft != null &&
                                        (p == null ||
                                            previous.draft.documentId != p.documentId ||
                                            previous.draft.version != p.version) &&
                                        previous.draft.sections != p?.sections),
                        )
                    }
                    if (p != null) readGate(p, g)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) failure(e, false)
                } finally {
                    if (g == generation) update { it.copy(loading = false) }
                }
            }
    }

    private suspend fun readGate(p: ResearchDocumentResponse, g: Long) {
        try {
            val gate = api.native.getResearchDocumentCompletionGate(p.documentId)
            if (g == generation) update { it.copy(gate = gate) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiFailure && e.status == 401) unauthorized(e)
            if (g == generation) update { it.copy(gate = null) }
        }
    }

    fun rebase() {
        val s = state.value
        val p = s.document ?: return
        val d = s.draft ?: return
        if (s.busy || s.unknown || d.documentId != p.documentId) return
        // Explicit user action; preserve local sections and metadata, never silently overwrite a
        // CAS conflict.
        val next = d.copy(version = p.version)
        persist(next)
        update { it.copy(draft = next, conflict = false, notice = "已保留本机正文，采用最新版本作为保存依据。") }
    }

    fun discard() {
        val s = state.value
        val p = s.document ?: return
        if (s.busy || s.unknown) return
        persist(null)
        update {
            it.copy(draft = draft(p), conflict = false, formatting = p.formatting, error = null)
        }
    }

    private fun failure(e: Exception, write: Boolean) {
        val f = e as? ApiFailure
        if (f?.status == 401) unauthorized(f)
        val conflict = f?.status == 409 && f.code?.contains("version") == true
        val definitive =
            f != null &&
                f.status in 400..499 &&
                f.status !in setOf(408, 429) &&
                (f.status != 409 || conflict)
        if (write && definitive) {
            intent = null
            store.write("$prefix:intent", null)
        }
        update {
            it.copy(
                error = e.message ?: "操作未完成，当前正文仍保留。",
                unknown = intent != null,
                conflict = it.conflict || conflict,
            )
        }
    }

    private fun execute(next: DocumentIntent) {
        if (closed || state.value.busy) return
        if (intent != null && intent != next) {
            update { it.copy(error = "上次正文操作结果尚未确认，请先核对或重试原请求。") }
            return
        }
        store.write("$prefix:intent", WireJson.encodeToString(next))
        intent = next
        reader?.cancel()
        autosave?.cancel()
        val g = ++generation
        update { it.copy(busy = true, loading = false, error = null, notice = null) }
        writer =
            scope.launch {
                var succeeded = false
                try {
                    var proposal: ResearchDocumentProposalResponse? = null
                    val p =
                        when (next.action) {
                            "save",
                            "format" ->
                                api.native.updateResearchDocument(
                                    next.target,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "confirm" ->
                                api.native.confirmResearchDocument(
                                    next.target,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "restore" ->
                                api.native.restoreResearchDocument(
                                    next.target,
                                    next.key,
                                    WireJson.decodeFromString(next.body),
                                )
                            "accept" ->
                                api.native
                                    .acceptResearchDocumentProposal(
                                        next.target,
                                        next.key,
                                        WireJson.decodeFromString(next.body),
                                    )
                                    .let {
                                        proposal = it.proposal
                                        it.document
                                    }
                            "reject" -> {
                                proposal =
                                    api.native.rejectResearchDocumentProposal(
                                        next.target,
                                        next.key,
                                        WireJson.decodeFromString(next.body),
                                    )
                                state.value.document
                            }
                            else -> error("Unknown document intent")
                        }
                    if (closed || g != generation) return@launch
                    val current = state.value.draft
                    val requestSections =
                        if (next.action in setOf("save", "format"))
                            WireJson.decodeFromString<UpdateResearchDocumentRequest>(next.body)
                                .sections
                        else null
                    val keep =
                        (next.action == "reject" && state.value.dirty) ||
                            (requestSections != null &&
                                current?.documentId == p?.documentId &&
                                current?.sections != requestSections)
                    val nextDraft =
                        if (keep && p != null) current?.copy(version = p.version)
                        else p?.let(::draft)
                    persist(if (keep) nextDraft else null)
                    store.write("$prefix:intent", null)
                    intent = null
                    succeeded = true
                    update {
                        it.copy(
                            document = p,
                            draft = nextDraft,
                            unknown = false,
                            conflict = false,
                            formatting =
                                if (next.action == "format") p?.formatting
                                else it.formatting ?: p?.formatting,
                            proposals =
                                if (proposal != null)
                                    it.proposals.map { old ->
                                        if (old.proposalId == proposal!!.proposalId) proposal!!
                                        else old
                                    }
                                else it.proposals,
                            versions =
                                p?.let { latest ->
                                    listOf(latest) +
                                        it.versions.filterNot { old ->
                                            old.version == latest.version &&
                                                old.documentId == latest.documentId
                                        }
                                } ?: it.versions,
                            notice = if (keep) "原操作已确认；仍保留后来编辑的正文。" else "文稿版本已保存。",
                        )
                    }
                    if (p != null) readGate(p, g)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) failure(e, true)
                } finally {
                    if (g == generation) {
                        update { it.copy(busy = false) }
                        if (
                            succeeded &&
                                state.value.dirty &&
                                !state.value.unknown &&
                                !state.value.conflict
                        )
                            scheduleSave()
                    }
                }
            }
    }

    fun retry() {
        intent?.let(::execute)
    }

    fun save() {
        val s = state.value
        val d = s.draft ?: return
        if (!s.dirty || s.unknown || s.conflict || s.document?.documentId != d.documentId) return
        execute(
            DocumentIntent(
                "save",
                d.documentId,
                WireJson.encodeToString(
                    UpdateResearchDocumentRequest(
                        "用户直接编辑正文",
                        d.version,
                        null,
                        d.sections,
                        "user_edit",
                    )
                ),
            )
        )
    }

    fun applyFormatting() {
        val s = state.value
        val p = s.document ?: return
        val f = s.formatting ?: return
        if (!s.ready || f == p.formatting) return
        execute(
            DocumentIntent(
                "format",
                p.documentId,
                WireJson.encodeToString(
                    UpdateResearchDocumentRequest(
                        "切换论文模板与引用格式",
                        p.version,
                        f,
                        p.sections,
                        "user_edit",
                    )
                ),
            )
        )
    }

    fun confirm() {
        val s = state.value
        val p = s.document ?: return
        if (!s.ready || s.gate?.ready != true || s.gate.version != p.version) return
        execute(
            DocumentIntent(
                "confirm",
                p.documentId,
                WireJson.encodeToString(ConfirmResearchDocumentRequest(p.version)),
            )
        )
    }

    fun restore(version: Long) {
        val s = state.value
        val p = s.document ?: return
        if (
            !s.ready ||
                version == p.version ||
                s.versions.none { it.documentId == p.documentId && it.version == version }
        )
            return
        if (
            d.sections.any {
                it.content.isEmpty() || it.content.codePointCount(0, it.content.length) > 100000
            }
        ) {
            update { it.copy(error = "每节正文需要 1–100000 个字符。当前草稿仍然保留。") }
            return
        }
        execute(
            DocumentIntent(
                "restore",
                p.documentId,
                WireJson.encodeToString(
                    RestoreResearchDocumentRequest(p.version, "恢复到第 $version 版", version)
                ),
            )
        )
    }

    fun accept(id: String) {
        val s = state.value
        val p = s.proposals.find { it.proposalId == id && it.status == "pending" } ?: return
        if (
            s.busy ||
                s.unknown ||
                s.dirty ||
                s.conflict ||
                (p.kind != "create" &&
                    (s.document == null || p.baseDocumentVersion != s.document.version))
        )
            return
        execute(
            DocumentIntent(
                "accept",
                id,
                WireJson.encodeToString(
                    AcceptResearchDocumentProposalRequest(
                        if (p.kind == "create") null else s.document?.version
                    )
                ),
            )
        )
    }

    fun reject(id: String) {
        if (
            state.value.proposals.none { it.proposalId == id && it.status == "pending" } ||
                state.value.unknown
        )
            return
        execute(
            DocumentIntent(
                "reject",
                id,
                WireJson.encodeToString(RejectResearchDocumentProposalRequest("用户拒绝本次局部修改建议。")),
            )
        )
    }

    suspend fun export(): ResearchDocumentExportResponse {
        val s = state.value
        val p = s.document ?: error("还没有可导出的研究文稿。")
        check(s.ready) { "请先保存当前正文，再导出。" }
        return api.native.exportResearchDocument(p.documentId, p.version)
    }
}
