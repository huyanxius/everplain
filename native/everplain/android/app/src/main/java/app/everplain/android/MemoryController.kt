package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable
internal data class MemoryIntent(
    val action: String,
    val key: String,
    val content: String = "",
    val memoryId: String? = null,
    val expectedVersion: Long? = null,
    val noteKey: String = "note.${newIntentKey()}",
)

internal data class MemoryUiState(
    val items: List<MemoryResponse> = emptyList(),
    val limits: MemoryLimits? = null,
    val settings: MemorySettings? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val overview: String = "",
    val overviewBusy: Boolean = false,
    val overviewError: String? = null,
    val error: String? = null,
    val notice: String? = null,
    val details: Boolean = false,
    val selected: String? = null,
    val editor: String? = null,
    val editorVersion: Long? = null,
    val draft: String = "",
    val revisions: List<MemoryResponse>? = null,
    val historyBusy: Boolean = false,
)

/** Session/origin-bound memory feature. Writes use caller-owned stable keys and server CAS. */
internal class MemoryController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    private val taskId: String? = null,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val journal = "memory-intent:${api.endpoint.origin}:$owner:${taskId ?: "personal"}"
    private var intent =
        store.read(journal)?.let {
            runCatching { WireJson.decodeFromString<MemoryIntent>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            MemoryUiState().let { state ->
                intent?.let {
                    state.copy(
                        editor = if (it.action == "create") "new" else it.memoryId,
                        editorVersion = it.expectedVersion,
                        draft = it.content,
                        details = true,
                        notice = "上次保存尚未确认。请先核对服务器记录；不会自动重发。",
                    )
                } ?: state
            }
        )
    val state = mutable.asStateFlow()
    private var loadJob: Job? = null
    private var summaryJob: Job? = null
    private var writeJob: Job? = null
    private var historyJob: Job? = null
    private var settingsIntent: Pair<MemorySettingsUpdate, String>? = null
    private var closed = false
    private var snapshot = 0L
    private var loaded = false
    private var visible = false

    fun enter() {
        visible = true
        if (!loaded) load()
    }

    fun leave() {
        visible = false
        pauseOverview()
    }

    private fun update(block: (MemoryUiState) -> MemoryUiState) {
        if (!closed) mutable.update(block)
    }

    fun close() {
        closed = true
        loadJob?.cancel()
        summaryJob?.cancel()
        writeJob?.cancel()
        historyJob?.cancel()
    }

    fun pauseOverview() {
        val interrupted = summaryJob?.isActive == true
        summaryJob?.cancel()
        update {
            it.copy(
                overviewBusy = false,
                overviewError = if (interrupted) "概览暂未生成，你仍可查看和编辑记忆明细。" else it.overviewError,
            )
        }
    }

    fun details(value: Boolean) = update { it.copy(details = value) }

    fun select(id: String) {
        historyJob?.cancel()
        if (!state.value.busy)
            update { it.copy(selected = id, editor = null, revisions = null, error = null) }
    }

    fun edit(item: MemoryResponse? = null) {
        if (state.value.busy) return
        update {
            it.copy(
                details = true,
                selected = item?.memoryId,
                editor = item?.memoryId ?: "new",
                editorVersion = item?.version,
                draft = item?.content.orEmpty(),
                error = null,
                notice = null,
                revisions = null,
            )
        }
    }

    fun draft(value: String) {
        if (!state.value.busy) update { it.copy(draft = value) }
    }

    fun cancelEditor() {
        if (!state.value.busy) update { it.copy(editor = null) }
    }

    fun closeDetail() {
        if (!state.value.busy) update { it.copy(editor = null, selected = null, revisions = null) }
    }

    fun acknowledgeVersion() {
        val current = state.value.items.find { it.memoryId == state.value.editor } ?: return
        update { it.copy(editorVersion = current.version, error = null) }
        intent = null
        store.write(journal, null)
    }

    private fun failure(e: Exception) {
        if (e is CancellationException) throw e
        if (e is ApiFailure && e.status == 401) {
            unauthorized(e)
            return
        }
        update {
            it.copy(
                error =
                    if (e is ApiFailure && e.status == 409) "这条记录已在别处更新，请刷新后核对；你的草稿仍保留。"
                    else e.message ?: "记忆暂时无法保存或读取，请稍后重试。"
            )
        }
    }

    fun load() {
        if (closed || state.value.busy) return
        loadJob?.cancel()
        summaryJob?.cancel()
        val generation = ++snapshot
        update {
            it.copy(
                loading = true,
                error = null,
                overview = "",
                overviewBusy = false,
                overviewError = null,
                revisions = null,
            )
        }
        loadJob =
            scope.launch {
                try {
                    val (collection, settings) =
                        coroutineScope {
                            val records = async { api.native.listMemories(taskId) }
                            val prefs = async { api.native.getMemorySettings(taskId) }
                            records.await() to prefs.await()
                        }
                    if (generation != snapshot || closed) return@launch
                    val unresolved = intent
                    val confirmed =
                        unresolved != null &&
                            when (unresolved.action) {
                                "create" ->
                                    collection.items.any {
                                        it.key == unresolved.noteKey &&
                                            it.content == unresolved.content
                                    }
                                "update" ->
                                    collection.items.any {
                                        it.memoryId == unresolved.memoryId &&
                                            it.content == unresolved.content &&
                                            it.version > (unresolved.expectedVersion ?: 0)
                                    }
                                "delete" ->
                                    collection.items.none { it.memoryId == unresolved.memoryId }
                                else -> false
                            }
                    if (confirmed) {
                        intent = null
                        store.write(journal, null)
                    }
                    loaded = true
                    update {
                        it.copy(
                            items = collection.items,
                            limits = collection.limits,
                            settings = settings,
                            loading = false,
                            notice = if (confirmed) "已与服务器记录核对。" else it.notice,
                            editor =
                                if (confirmed && it.draft.trim() == unresolved?.content) null
                                else it.editor,
                        )
                    }
                    // Actual Web overview is a POST only for a known, nonempty snapshot.
                    if (collection.items.isNotEmpty() && visible)
                        overview(settings.version, generation)
                    else if (collection.items.isNotEmpty())
                        update { it.copy(overviewError = "概览暂未生成，你仍可查看和编辑记忆明细。") }
                } catch (e: Exception) {
                    if (generation == snapshot) failure(e)
                } finally {
                    if (generation == snapshot) update { it.copy(loading = false) }
                }
            }
    }

    private fun overview(version: Long, generation: Long) {
        summaryJob =
            scope.launch {
                update { it.copy(overviewBusy = true, overviewError = null) }
                try {
                    val result =
                        api.native.summarizeMemory(
                            newIntentKey(),
                            MemoryOverviewRequest(version, taskId),
                        )
                    if (generation == snapshot) update { it.copy(overview = result.summary) }
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (e is ApiFailure && e.status == 401) unauthorized(e)
                    else if (generation == snapshot)
                        update {
                            it.copy(
                                overviewError =
                                    when ((e as? ApiFailure)?.status) {
                                        409 -> "记忆已更新，请刷新记录后重新整理。"
                                        429 -> "正在整理记忆，请稍后重试。"
                                        else -> "概览暂未生成，你仍可查看和编辑记忆明细。"
                                    }
                            )
                        }
                } finally {
                    if (generation == snapshot) update { it.copy(overviewBusy = false) }
                }
            }
    }

    fun save() {
        val s = state.value
        val editor = s.editor ?: return
        val limits = s.limits ?: return
        val body = s.draft.trim()
        if (
            s.busy ||
                s.loading ||
                body.isEmpty() ||
                body.toByteArray(Charsets.UTF_8).size > limits.maxContentBytes
        )
            return
        if (editor == "new" && s.items.size >= limits.maxEntries) return
        val current = s.items.find { it.memoryId == editor }
        if (editor != "new" && (current == null || current.version != s.editorVersion)) return
        val action = if (editor == "new") "create" else "update"
        val stable =
            intent?.takeIf {
                it.action == action &&
                    it.content == body &&
                    it.memoryId == current?.memoryId &&
                    it.expectedVersion == s.editorVersion
            } ?: MemoryIntent(action, newIntentKey(), body, current?.memoryId, s.editorVersion)
        if (intent != null && intent != stable) {
            update { it.copy(error = "上一笔保存结果尚未确认，请先刷新记录核对。") }
            return
        }
        intent = stable
        store.write(journal, WireJson.encodeToString(stable))
        write(stable) {
            if (action == "create")
                api.native.createMemory(stable.key, MemoryCreate(body, stable.noteKey, taskId))
            else
                api.native.updateMemory(
                    current!!.memoryId,
                    stable.key,
                    MemoryUpdate(body, current.version),
                )
        }
    }

    fun delete(item: MemoryResponse) {
        if (state.value.busy) return
        val stable =
            intent?.takeIf {
                it.action == "delete" &&
                    it.memoryId == item.memoryId &&
                    it.expectedVersion == item.version
            }
                ?: MemoryIntent(
                    "delete",
                    newIntentKey(),
                    memoryId = item.memoryId,
                    expectedVersion = item.version,
                )
        if (intent != null && intent != stable) {
            update { it.copy(error = "上一笔保存结果尚未确认，请先刷新记录核对。") }
            return
        }
        intent = stable
        store.write(journal, WireJson.encodeToString(stable))
        write(stable) { api.native.deleteMemory(item.memoryId, item.version, stable.key) }
    }

    private fun write(stable: MemoryIntent, action: suspend () -> Unit) {
        update { it.copy(busy = true, error = null, notice = null) }
        writeJob =
            scope.launch {
                var successful = false
                try {
                    action()
                    successful = true
                    if (intent == stable) {
                        intent = null
                        store.write(journal, null)
                    }
                    summaryJob?.cancel()
                    ++snapshot
                    update {
                        it.copy(
                            editor = null,
                            selected = null,
                            draft = "",
                            overview = "",
                            overviewBusy = false,
                            notice = if (stable.action == "delete") "已删除记忆。" else "已保存记忆。",
                        )
                    }
                } catch (e: Exception) {
                    if (
                        e is ApiFailure &&
                            e.status in 400..499 &&
                            e.status != 408 &&
                            intent == stable
                    ) {
                        intent = null
                        store.write(journal, null)
                    }
                    failure(e)
                } finally {
                    update { it.copy(busy = false) }
                    if (successful && !closed) load()
                }
            }
    }

    fun toggle(field: String) {
        val s = state.value
        val old = s.settings ?: return
        if (s.busy) return
        val body =
            MemorySettingsUpdate(
                old.version,
                if (field == "learn") !old.learnMemory else old.learnMemory,
                if (field == "use") !old.useMemory else old.useMemory,
            )
        val key =
            settingsIntent?.takeIf { it.first == body }?.second
                ?: newIntentKey().also { settingsIntent = body to it }
        update { it.copy(busy = true, error = null) }
        writeJob =
            scope.launch {
                try {
                    val next = api.native.updateMemorySettings(taskId, key, body)
                    settingsIntent = null
                    update { it.copy(settings = next) }
                } catch (e: Exception) {
                    failure(e)
                } finally {
                    update { it.copy(busy = false) }
                }
            }
    }

    fun history(item: MemoryResponse) {
        if (state.value.historyBusy) return
        update { it.copy(historyBusy = true, revisions = null) }
        historyJob =
            scope.launch {
                try {
                    val result = api.native.listMemoryRevisions(item.memoryId)
                    if (state.value.selected == item.memoryId)
                        update {
                            it.copy(revisions = result.items.sortedByDescending { r -> r.version })
                        }
                } catch (e: Exception) {
                    failure(e)
                } finally {
                    update { it.copy(historyBusy = false) }
                }
            }
    }
}
