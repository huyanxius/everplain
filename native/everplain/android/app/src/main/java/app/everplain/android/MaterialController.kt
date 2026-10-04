package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal data class MaterialUiState(
    val available: List<ResearchMaterialResponse> = emptyList(),
    val attached: List<ResearchMaterialResponse> = emptyList(),
    val loading: Boolean = false,
    val uploading: Boolean = false,
    val error: String? = null,
    val unresolved: Boolean = false,
    val selected: ResearchMaterialResponse? = null,
    val reading: Boolean = false,
    val readError: String? = null,
    val more: Boolean = false,
    val busyId: String? = null,
    val saved: Long = 0,
    val canEndUpload: Boolean = false,
)

@Serializable
internal data class MaterialIntent(
    val action: String,
    val key: String = newIntentKey(),
    val localScope: String,
    val sourceConversationId: String? = null,
    val context: AgentMaterialContextResponse? = null,
    val files: List<LibraryUpload> = emptyList(),
    val completed: Int = 0,
    val taskId: String? = null,
    val materialId: String? = null,
    val attachToComposer: Boolean = true,
    val confirmedFailure: Boolean = false,
)

/**
 * Uses one owner/origin journal; a context switch cannot attach old upload results to the new turn.
 */
internal class MaterialController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    private val onPrepared: (scope: String, context: AgentMaterialContextResponse) -> Unit,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val journal = "material-intent:${api.endpoint.origin}:$owner"
    private var intent =
        store.read(journal)?.let {
            runCatching { WireJson.decodeFromString<MaterialIntent>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            MaterialUiState(
                unresolved = intent != null,
                canEndUpload = intent?.confirmedFailure == true,
            )
        )
    val state = mutable.asStateFlow()
    private var localScope = ""
    private var conversationId: String? = null
    private var taskId: String? = null
    private val selections = mutableMapOf<String, List<ResearchMaterialResponse>>()
    private var closed = false
    private var visible = false
    private var generation = 0L
    private var readerGeneration = 0L
    private var readJob: Job? = null
    private var listJob: Job? = null
    private var writeJob: Job? = null
    private var poll: Job? = null

    private fun update(block: (MaterialUiState) -> MaterialUiState) {
        if (!closed) mutable.update(block)
    }

    private fun check(e: Throwable) {
        if (e is CancellationException) throw e
        if (e is ApiFailure && e.status == 401) {
            unauthorized(e)
            throw CancellationException("Session ended", e)
        }
    }

    fun bind(scopeId: String, conversation: String?, task: String? = null) {
        if (scopeId != localScope) {
            selections[localScope] = state.value.attached
            localScope = scopeId
            generation++
            poll?.cancel()
            update { it.copy(attached = selections[scopeId].orEmpty()) }
        }
        conversationId = conversation
        taskId = task
        visible = true
        schedule()
    }

    fun leave() {
        visible = false
        poll?.cancel()
    }

    fun close() {
        closed = true
        generation++
        readJob?.cancel()
        listJob?.cancel()
        writeJob?.cancel()
        poll?.cancel()
        selections.clear()
    }

    fun load(more: Boolean = false) {
        if (state.value.loading) return
        val offset = if (more) state.value.available.size.toLong() else 0
        update { it.copy(loading = true, error = null) }
        listJob =
            scope.launch {
                try {
                    val items = api.native.listAgentMaterials(limit = 100, offset = offset).items
                    update {
                        it.copy(
                            available =
                                if (more) (it.available + items).distinctBy { m -> m.materialId }
                                else items,
                            loading = false,
                            more = items.size == 100,
                        )
                    }
                } catch (e: Throwable) {
                    check(e)
                    update { it.copy(loading = false, error = e.message ?: "研究材料暂时无法读取") }
                }
            }
    }

    fun toggle(material: ResearchMaterialResponse) {
        if (state.value.uploading || material.status != "ready") return
        val attached = state.value.attached
        if (attached.any { it.materialId == material.materialId }) remove(material.materialId)
        else if (attached.size >= 20) update { it.copy(error = "每轮最多附加 20 份研究材料。") }
        else update { it.copy(attached = it.attached + material, error = null) }
    }

    fun remove(id: String) {
        if (!state.value.uploading)
            update { it.copy(attached = it.attached.filterNot { m -> m.materialId == id }) }
        schedule()
    }

    fun clearAfterSend() {
        selections[localScope] = emptyList()
        update { it.copy(attached = emptyList()) }
        poll?.cancel()
    }

    fun upload(files: List<LibraryUpload>, attachToComposer: Boolean = true) {
        if (files.isEmpty() || state.value.uploading) return
        if (files.size + state.value.attached.size > 20) {
            update { it.copy(error = "每轮最多附加 20 份研究材料。") }
            return
        }
        submit(
            MaterialIntent(
                "upload",
                localScope = localScope,
                sourceConversationId = conversationId,
                context =
                    if (taskId != null && conversationId != null)
                        AgentMaterialContextResponse(conversationId!!, taskId!!)
                    else null,
                files = files,
                taskId = taskId,
                attachToComposer = attachToComposer,
            )
        )
    }

    fun delete(material: ResearchMaterialResponse) =
        submit(
            MaterialIntent(
                "delete",
                localScope = localScope,
                taskId = material.taskId,
                materialId = material.materialId,
            )
        )

    fun reparse(material: ResearchMaterialResponse) =
        submit(
            MaterialIntent(
                "reparse",
                localScope = localScope,
                taskId = material.taskId,
                materialId = material.materialId,
            )
        )

    fun retryOriginal() {
        if (!state.value.uploading && state.value.busyId == null) intent?.let(::execute)
    }

    fun endRejectedUpload() {
        val original = intent ?: return
        if (!original.confirmedFailure || state.value.uploading) return
        store.write(journal, null)
        intent = null
        original.files.forEach { File(it.path).delete() }
        update {
            it.copy(unresolved = false, canEndUpload = false, error = null, saved = it.saved + 1)
        }
    }

    private fun checkpoint(value: MaterialIntent) {
        store.write(journal, WireJson.encodeToString(value))
        intent = value
    }

    private fun submit(value: MaterialIntent) {
        if (closed || state.value.uploading || state.value.busyId != null) return
        if (intent != null) {
            update { it.copy(error = "上次操作结果尚未确认，可重新读取或使用原请求重试。") }
            return
        }
        try {
            checkpoint(value)
        } catch (e: Throwable) {
            update { it.copy(error = "无法安全记录本次操作。") }
            return
        }
        execute(value)
    }

    private fun execute(original: MaterialIntent) {
        if (original.confirmedFailure) checkpoint(original.copy(confirmedFailure = false))
        update {
            it.copy(
                uploading = original.action == "upload",
                busyId = original.materialId,
                error = null,
                unresolved = true,
                canEndUpload = false,
            )
        }
        writeJob =
            scope.launch {
                var value = original.copy(confirmedFailure = false)
                try {
                    when (value.action) {
                        "upload" -> {
                            if (
                                value.taskId == null &&
                                    value.localScope.startsWith("new-project-files")
                            ) {
                                val project =
                                    api.native.createResearchTask(
                                        value.key + "-project",
                                        CreateResearchTaskRequest(
                                            entryMode = "from_scratch",
                                            entryType = "material_input",
                                            projectTitle = value.files.first().filename,
                                        ),
                                    )
                                value = value.copy(taskId = project.taskId)
                                checkpoint(value)
                            }
                            if (value.context == null && value.taskId == null) {
                                val context =
                                    api.native.prepareAgentMaterialContext(
                                        value.key + "-context",
                                        AgentMaterialContextRequest(value.sourceConversationId),
                                    )
                                value = value.copy(context = context)
                                checkpoint(value)
                            }
                            if (localScope == value.localScope && value.context != null) {
                                taskId = value.context!!.taskId
                                conversationId = value.context!!.conversationId
                                onPrepared(localScope, value.context!!)
                            }
                            for (i in value.completed until value.files.size) {
                                currentCoroutineContext().ensureActive()
                                val material =
                                    api.uploadResearchDocument(
                                        (value.taskId ?: value.context!!.taskId),
                                        value.files[i].snapshot(),
                                        value.key + "-$i",
                                    )
                                val target = value.localScope
                                if (target == localScope)
                                    update {
                                        it.copy(
                                            attached =
                                                if (value.attachToComposer)
                                                    (it.attached + material).distinctBy { m ->
                                                        m.materialId
                                                    }
                                                else it.attached,
                                            available =
                                                (listOf(material) + it.available).distinctBy { m ->
                                                    m.materialId
                                                },
                                        )
                                    }
                                else if (value.attachToComposer)
                                    selections[target] =
                                        (selections[target].orEmpty() + material).distinctBy {
                                            it.materialId
                                        }
                                value = value.copy(completed = i + 1)
                                checkpoint(value)
                            }
                        }
                        "delete" -> {
                            api.native.deleteResearchMaterial(
                                value.taskId!!,
                                value.materialId!!,
                                value.key,
                            )
                            update {
                                it.copy(
                                    available =
                                        it.available.filterNot { m ->
                                            m.materialId == value.materialId
                                        },
                                    attached =
                                        it.attached.filterNot { m ->
                                            m.materialId == value.materialId
                                        },
                                    selected =
                                        it.selected?.takeUnless { m ->
                                            m.materialId == value.materialId
                                        },
                                )
                            }
                            selections.replaceAll { _, items ->
                                items.filterNot { it.materialId == value.materialId }
                            }
                        }
                        "reparse" -> {
                            val material =
                                api.native.reparseResearchMaterial(
                                    value.taskId!!,
                                    value.materialId!!,
                                    value.key,
                                )
                            replace(material)
                        }
                    }
                    store.write(journal, null)
                    intent = null
                    value.files.forEach { File(it.path).delete() }
                    update {
                        it.copy(
                            uploading = false,
                            busyId = null,
                            unresolved = false,
                            saved = it.saved + 1,
                        )
                    }
                    schedule()
                } catch (e: Throwable) {
                    check(e)
                    val definite =
                        e is ApiFailure && e.status in 400..499 && e.status !in setOf(408, 409)
                    val partial = value.action == "upload" && value.completed > 0
                    if (definite && partial) checkpoint(value.copy(confirmedFailure = true))
                    else if (definite) {
                        store.write(journal, null)
                        intent = null
                        value.files.forEach { File(it.path).delete() }
                    }
                    update {
                        it.copy(
                            uploading = false,
                            busyId = null,
                            unresolved = !definite || partial,
                            canEndUpload = definite && partial,
                            error = e.message ?: "操作结果尚未确认",
                        )
                    }
                }
            }
    }

    private fun replace(material: ResearchMaterialResponse) {
        update {
            it.copy(
                available =
                    it.available.map { old ->
                        if (old.materialId == material.materialId) material else old
                    },
                attached =
                    it.attached.map { old ->
                        if (old.materialId == material.materialId) material else old
                    },
                selected =
                    if (it.selected?.materialId == material.materialId) material else it.selected,
            )
        }
    }

    private fun schedule() {
        poll?.cancel()
        val pending =
            (state.value.attached + state.value.available)
                .distinctBy { it.materialId }
                .filter { it.ingestionStatus in setOf("queued", "processing") }
        if (!visible || pending.isEmpty() || closed) return
        val current = generation
        poll =
            scope.launch {
                delay(2000)
                try {
                    for (item in pending) {
                        val material = api.native.getResearchMaterial(item.taskId, item.materialId)
                        if (current == generation) replace(material)
                    }
                    if (current == generation) schedule()
                } catch (e: Throwable) {
                    check(e)
                    if (current == generation) update { it.copy(error = e.message ?: "处理状态暂时无法读取") }
                }
            }
    }

    fun open(material: ResearchMaterialResponse, parseId: String? = null) {
        readJob?.cancel()
        val reader = ++readerGeneration
        update { it.copy(selected = material, reading = true, readError = null) }
        readJob =
            scope.launch {
                try {
                    val result =
                        api.native.getResearchMaterial(
                            material.taskId,
                            material.materialId,
                            parseId,
                        )
                    if (
                        reader == readerGeneration &&
                            state.value.selected?.materialId == material.materialId
                    )
                        update { it.copy(selected = result, reading = false) }
                } catch (e: Throwable) {
                    check(e)
                    if (
                        reader == readerGeneration &&
                            state.value.selected?.materialId == material.materialId
                    )
                        update { it.copy(reading = false, readError = e.message ?: "材料暂时无法读取") }
                }
            }
    }

    fun openReference(task: String, id: String, parseId: String? = null) {
        readJob?.cancel()
        val current = ++readerGeneration
        update { it.copy(selected = null, reading = true, readError = null) }
        readJob =
            scope.launch {
                try {
                    val value = api.native.getResearchMaterial(task, id, parseId)
                    if (current == readerGeneration)
                        update { it.copy(selected = value, reading = false) }
                } catch (e: Throwable) {
                    check(e)
                    if (current == readerGeneration)
                        update { it.copy(reading = false, readError = e.message) }
                }
            }
    }

    fun closeReader() {
        readerGeneration++
        readJob?.cancel()
        update { it.copy(selected = null, reading = false, readError = null) }
    }
}
