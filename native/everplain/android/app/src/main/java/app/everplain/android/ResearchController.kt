package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal data class ResearchUiState(
    val projects: List<ResearchTaskNavigationResponse> = emptyList(),
    val selectedId: String? = null,
    val tab: String = "projects",
    val loading: Boolean = true,
    val error: String? = null,
    val files: Map<String, List<ResearchMaterialResponse>> = emptyMap(),
    val fileErrors: Set<String> = emptySet(),
    val filesLoading: Boolean = false,
    val nextCursor: String? = null,
) {
    val selected
        get() = projects.firstOrNull { it.taskId == selectedId }
}

internal class ResearchController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val mutable = MutableStateFlow(ResearchUiState())
    val state = mutable.asStateFlow()
    private var closed = false
    private var loaded = false
    private var visible = false
    private var generation = 0L
    private var job: Job? = null
    private var poll: Job? = null

    private fun update(block: (ResearchUiState) -> ResearchUiState) {
        if (!closed) mutable.update(block)
    }

    private fun check(e: Throwable) {
        if (e is CancellationException) throw e
        if (e is ApiFailure && e.status == 401) {
            unauthorized(e)
            throw CancellationException("Session ended", e)
        }
    }

    fun enter() {
        visible = true
        if (!loaded || state.value.files.isEmpty() && state.value.projects.isNotEmpty()) load()
        else schedule()
    }

    fun leave() {
        visible = false
        poll?.cancel()
    }

    fun close() {
        closed = true
        generation++
        job?.cancel()
        poll?.cancel()
    }

    fun select(id: String?) {
        update { it.copy(selectedId = id, tab = if (id == null) "projects" else "files") }
    }

    fun tab(value: String) {
        if (value in setOf("projects", "files", "memory")) update { it.copy(tab = value) }
    }

    fun load(more: Boolean = false, includeFiles: Boolean = true) {
        job?.cancel()
        poll?.cancel()
        val current = ++generation
        val cursor = if (more) state.value.nextCursor else null
        job =
            scope.launch {
                update { it.copy(loading = true, error = null) }
                try {
                    val response = api.native.listResearchTasks(cursor, 100)
                    val projects =
                        if (more) (state.value.projects + response.items).distinctBy { it.taskId }
                        else response.items
                    if (current != generation) return@launch
                    loaded = true
                    update {
                        it.copy(
                            projects = projects,
                            loading = false,
                            nextCursor = response.nextCursor,
                            filesLoading = includeFiles,
                            fileErrors = emptySet(),
                        )
                    }
                    if (!includeFiles) return@launch
                    val results = coroutineScope {
                        projects
                            .map { project ->
                                async {
                                    try {
                                        project.taskId to
                                            Result.success(
                                                api.native
                                                    .listResearchMaterials(project.taskId)
                                                    .items
                                            )
                                    } catch (e: Throwable) {
                                        check(e)
                                        project.taskId to
                                            Result.failure<List<ResearchMaterialResponse>>(e)
                                    }
                                }
                            }
                            .awaitAll()
                    }
                    if (current != generation) return@launch
                    update {
                        it.copy(
                            files =
                                results
                                    .mapNotNull { (id, value) ->
                                        value.getOrNull()?.let { items -> id to items }
                                    }
                                    .toMap(),
                            fileErrors =
                                results.filter { it.second.isFailure }.map { it.first }.toSet(),
                            filesLoading = false,
                        )
                    }
                    schedule()
                } catch (e: Throwable) {
                    check(e)
                    if (current == generation)
                        update {
                            it.copy(
                                loading = false,
                                filesLoading = false,
                                error = e.message ?: "研究列表暂时无法加载，请稍后重试。",
                            )
                        }
                }
            }
    }

    private fun schedule() {
        poll?.cancel()
        if (
            visible &&
                state.value.files.values.flatten().any {
                    it.ingestionStatus in setOf("queued", "processing")
                }
        )
            poll =
                scope.launch {
                    delay(2500)
                    if (visible) load()
                }
    }
}

internal fun researchTitle(item: ResearchTaskNavigationResponse) =
    item.projectTitle.takeUnless { it.isBlank() || it == "未命名研究" }
        ?: item.phenomenonSummary?.phenomenon?.takeUnless { it == "尚未确认现象" }
        ?: "未命名研究"

internal fun researchStage(item: ResearchTaskNavigationResponse): Int =
    when {
        Regex("写作|文稿|已完成|成果|交付").containsMatchIn(item.stageLabel) -> 3
        Regex("大纲|框架|研究方案|方案确认").containsMatchIn(item.stageLabel) -> 2
        Regex("资料|材料|理论|匹配").containsMatchIn(item.stageLabel) -> 1
        Regex("提问|现象|问题").containsMatchIn(item.stageLabel) -> 0
        else -> -1
    }
