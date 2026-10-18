package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal data class GraphUiState(
    val graph: PersonalGraphResponse? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
    val unresolved: Boolean = false,
)

internal class GraphController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val journal = "graph-refresh:${api.endpoint.origin}:$owner"
    private var refreshKey = store.read(journal)
    private val mutable = MutableStateFlow(GraphUiState(unresolved = refreshKey != null))
    val state = mutable.asStateFlow()
    private var closed = false
    private var visible = false
    private var job: Job? = null
    private var poll: Job? = null
    private var write: Job? = null
    private var generation = 0L

    private fun update(block: (GraphUiState) -> GraphUiState) {
        if (!closed) mutable.update(block)
    }

    fun enter() {
        visible = true
        if (state.value.graph == null) load() else schedule()
    }

    fun leave() {
        visible = false
        poll?.cancel()
        job?.cancel()
    }

    fun close() {
        closed = true
        generation++
        job?.cancel()
        poll?.cancel()
        write?.cancel()
    }

    private fun error(e: Throwable) {
        if (e is CancellationException) throw e
        if (e is ApiFailure && e.status == 401) {
            unauthorized(e)
            throw CancellationException("Session ended", e)
        }
        update { it.copy(loading = false, refreshing = false, error = e.message ?: "图谱暂时无法读取") }
    }

    fun load() {
        job?.cancel()
        poll?.cancel()
        val current = ++generation
        job =
            scope.launch {
                update { it.copy(loading = it.graph == null, error = null) }
                try {
                    val result = api.native.getPersonalGraph()
                    if (current == generation) {
                        update { it.copy(graph = result, loading = false) }
                        schedule()
                    }
                } catch (e: Throwable) {
                    error(e)
                }
            }
    }

    private fun schedule() {
        poll?.cancel()
        if (visible && (state.value.graph?.pendingCount ?: 0) > 0)
            poll =
                scope.launch {
                    delay(2500)
                    if (visible) load()
                }
    }

    fun refresh() {
        if (state.value.refreshing || closed) return
        try {
            if (refreshKey == null) {
                refreshKey = newIntentKey()
                store.write(journal, refreshKey)
            }
        } catch (e: Throwable) {
            refreshKey = null
            update { it.copy(error = "无法安全记录更新请求。") }
            return
        }
        generation++;job?.cancel();poll?.cancel()
        update { it.copy(refreshing = true, error = null, unresolved = true) }
        write =
            scope.launch {
                try {
                    val result = api.native.refreshPersonalGraph(refreshKey!!)
                    store.write(journal, null)
                    refreshKey = null
                    update {
                        it.copy(
                            graph = result,
                            refreshing = false,
                            loading = false,
                            unresolved = false,
                        )
                    }
                    schedule()
                } catch (e: Throwable) {
                    if (e is ApiFailure && e.status in 400..499 && e.status != 408) {
                        store.write(journal, null)
                        refreshKey = null
                        update { it.copy(unresolved = false) }
                    }
                    error(e)
                }
            }
    }
}
