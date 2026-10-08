package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.OutputStream
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal data class ResearchArchiveState(
    val events: List<ResearchAuditEventResponse> = emptyList(),
    val loading: Boolean = true,
    val exporting: Boolean = false,
    val unknown: Boolean = false,
    val exported: ResearchArchiveDownload? = null,
    val error: String? = null,
)

internal class ResearchArchiveController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val keyName = "research-archive:${api.endpoint.origin}:$owner:$taskId"
    private var key: String? = store.read(keyName)
    private val mutable = MutableStateFlow(ResearchArchiveState(unknown = key != null))
    val state = mutable.asStateFlow()
    private var closed = false
    private var reader: Job? = null
    private var writer: Job? = null
    private var generation = 0L

    private fun update(f: (ResearchArchiveState) -> ResearchArchiveState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        reader?.cancel()
        writer?.cancel()
    }

    fun load() {
        if (closed) return
        reader?.cancel()
        val g = ++generation
        update { it.copy(loading = true, error = null) }
        reader =
            scope.launch {
                try {
                    val result = api.native.listResearchProjectAuditEvents(taskId)
                    if (g == generation) update { it.copy(events = result.items) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (e is ApiFailure && e.status == 401) unauthorized(e)
                    if (g == generation) update { it.copy(error = e.message ?: "审计记录暂时无法加载。") }
                } finally {
                    if (g == generation) update { it.copy(loading = false) }
                }
            }
    }

    /** The picker must have completed. No archive POST is issued merely by opening this page. */
    fun export(openOutput: () -> OutputStream) {
        if (closed || state.value.exporting) return
        val original =
            key
                ?: newIntentKey().also {
                    store.write(keyName, it)
                    key = it
                }
        update { it.copy(exporting = true, error = null) }
        writer =
            scope.launch {
                try {
                    val result =
                        withContext(io) {
                            openOutput().use { api.downloadResearchArchive(taskId, original, it) }
                        }
                    if (closed) return@launch
                    store.write(keyName, null)
                    key = null
                    update { it.copy(exported = result, unknown = false) }
                    load()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (e is ApiFailure && e.status == 401) unauthorized(e)
                    update {
                        it.copy(
                            unknown = true,
                            error = (e.message ?: "研究归档导出失败。") + " 保存的文件可能不完整。再次导出会恢复原请求，不会自动重发。",
                        )
                    }
                } finally {
                    update { it.copy(exporting = false) }
                }
            }
    }
}
