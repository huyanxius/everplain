package app.everplain.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal data class CanvasDraft(
    val conversation: String,
    val original: AgentResearchMapNodeResponse,
    val version: Long,
    val title: String,
    val summary: String,
)

internal data class CanvasEditState(
    val draft: CanvasDraft? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

@Serializable
internal data class CanvasIntent(
    val conversation: String,
    val node: String,
    val request: AgentCanvasNodeEditRequest,
    val key: String = newIntentKey(),
)

internal class CanvasController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    private val saved: (AgentConversationResponse) -> Unit,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val journal = "canvas-edit:${api.endpoint.origin}:$owner"
    private var intent =
        store.read(journal)?.let {
            runCatching { WireJson.decodeFromString<CanvasIntent>(it) }.getOrNull()
        }
    private val mutable = MutableStateFlow(CanvasEditState())
    val state = mutable.asStateFlow()
    private val drafts = mutableMapOf<String, CanvasDraft>()
    private var job: Job? = null
    private var closed = false

    private fun update(block: (CanvasEditState) -> CanvasEditState) {
        if (!closed) mutable.update(block)
    }

    fun close() {
        closed = true
        job?.cancel()
        drafts.clear()
    }

    fun begin(conversation: AgentConversationResponse, node: AgentResearchMapNodeResponse) {
        if (state.value.busy) return
        val key = "${conversation.conversationId}:${node.id}"
        val pending =
            intent?.takeIf { it.conversation == conversation.conversationId && it.node == node.id }
        update {
            it.copy(
                draft =
                    drafts[key]
                        ?: pending?.let { p ->
                            CanvasDraft(
                                p.conversation,
                                node.copy(
                                    title = p.request.expectedTitle,
                                    summary = p.request.expectedSummary,
                                ),
                                p.request.expectedVersion,
                                p.request.title,
                                p.request.summary,
                            )
                        }
                        ?: CanvasDraft(
                            conversation.conversationId,
                            node,
                            conversation.canvasEditVersion ?: 0,
                            node.title,
                            node.summary.orEmpty(),
                        ),
                error = null,
                notice = null,
            )
        }
    }

    fun change(title: String? = null, summary: String? = null) {
        if (state.value.busy) return
        val current = state.value.draft ?: return
        val draft =
            current.copy(
                title = title?.take(240) ?: current.title,
                summary = summary?.take(1200) ?: current.summary,
            )
        drafts["${draft.conversation}:${draft.original.id}"] = draft
        update { it.copy(draft = draft) }
    }

    fun cancel() {
        if (state.value.busy) return
        state.value.draft?.let { drafts.remove("${it.conversation}:${it.original.id}") }
        update { it.copy(draft = null, error = null) }
    }

    private fun check(e: Throwable) {
        if (e is CancellationException) throw e
        if (e is ApiFailure && e.status == 401) {
            unauthorized(e)
            throw CancellationException("Session ended", e)
        }
    }

    fun save() {
        val draft = state.value.draft ?: return
        if (state.value.busy || draft.title.isBlank()) return
        val body =
            AgentCanvasNodeEditRequest(
                draft.original.summary,
                draft.original.title,
                draft.version,
                draft.summary,
                draft.title.trim(),
            )
        val prior = intent
        if (
            prior != null &&
                (prior.conversation != draft.conversation ||
                    prior.node != draft.original.id ||
                    prior.request != body)
        ) {
            update { it.copy(error = "上次卡片保存结果未确认，请先载入最新版本核对；原请求不会被覆盖。") }
            return
        }
        val current = prior ?: CanvasIntent(draft.conversation, draft.original.id, body)
        try {
            store.write(journal, WireJson.encodeToString(current))
            intent = current
        } catch (e: Throwable) {
            update { it.copy(error = "无法安全记录修改。") }
            return
        }
        execute(current)
    }

    fun retryOriginal() {
        if (!state.value.busy) intent?.let(::execute)
    }

    private fun execute(current: CanvasIntent) {
        update { it.copy(busy = true, error = null) }
        job =
            scope.launch {
                try {
                    val result =
                        api.native.editAgentCanvasNode(
                            current.conversation,
                            current.node,
                            current.key,
                            current.request,
                        )
                    store.write(journal, null)
                    intent = null
                    saved(result)
                    val local = state.value.draft
                    val newer =
                        local != null &&
                            (local.title.trim() != current.request.title ||
                                local.summary != current.request.summary)
                    if (newer) {
                        val node = result.researchMap.nodes.firstOrNull { it.id == current.node }
                        val next =
                            local!!.copy(
                                original = node ?: local.original,
                                version = result.canvasEditVersion ?: local.version,
                            )
                        drafts["${current.conversation}:${current.node}"] = next
                        update { it.copy(draft = next, busy = false, notice = "上次修改已确认，新的草稿仍保留。") }
                    } else {
                        drafts.remove("${current.conversation}:${current.node}")
                        update { it.copy(draft = null, busy = false, notice = "已保存，等待进一步验证。") }
                    }
                } catch (e: Throwable) {
                    check(e)
                    if (e is ApiFailure && e.status in 400..499 && e.status != 408) {
                        store.write(journal, null)
                        intent = null
                    }
                    update { it.copy(busy = false, error = e.message ?: "保存失败，请重试。") }
                }
            }
    }

    fun reload() {
        val draft = state.value.draft ?: return
        if (state.value.busy) return
        update { it.copy(busy = true) }
        job =
            scope.launch {
                try {
                    val result = api.native.getAgentConversation(draft.conversation)
                    saved(result)
                    val latest = result.researchMap.nodes.firstOrNull { it.id == draft.original.id }
                    if (latest != null) {
                        val pending = intent
                        if (
                            pending != null &&
                                pending.conversation == draft.conversation &&
                                pending.node == latest.id &&
                                latest.title == pending.request.title &&
                                latest.summary.orEmpty() == pending.request.summary
                        ) {
                            store.write(journal, null)
                            intent = null
                        }
                        val next =
                            draft.copy(original = latest, version = result.canvasEditVersion ?: 0)
                        drafts["${draft.conversation}:${latest.id}"] = next
                        update {
                            it.copy(
                                draft = next,
                                busy = false,
                                error = null,
                                notice = "已载入最新原文。请与下面的草稿核对后再保存。",
                            )
                        }
                    } else update { it.copy(busy = false, error = "此节点已不在当前画布中，草稿仍保留。") }
                } catch (e: Throwable) {
                    check(e)
                    update { it.copy(busy = false, error = "载入失败，草稿仍保留。") }
                }
            }
    }
}

@Composable
internal fun CanvasNodeEditor(s: AppState, vm: AppViewModel, node: AgentResearchMapNodeResponse) {
    val conversation = s.conversation ?: return
    val controller = vm.canvas()
    val value by controller.state.collectAsStateWithLifecycle()
    val draft =
        value.draft?.takeIf {
            it.conversation == conversation.conversationId && it.original.id == node.id
        }
    if (draft == null)
        EpButton(
            "编辑卡片",
            { controller.begin(conversation, node) },
            enabled = !s.streaming && !value.busy,
        )
    else
        Column {
            EpField("标题", draft.title, { controller.change(title = it) }, enabled = !value.busy)
            EpField(
                "说明",
                draft.summary,
                { controller.change(summary = it) },
                multiline = true,
                minLines = 6,
                monospace = false,
                enabled = !value.busy,
            )
            Text(
                "引用保留；改写后的判断需要重新验证。",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row {
                EpButton(
                    if (value.busy) "正在保存…" else "保存修改",
                    controller::save,
                    primary = true,
                    enabled = !value.busy && draft.title.isNotBlank(),
                )
                EpButton("取消", controller::cancel, enabled = !value.busy)
            }
        }
    value.error?.let {
        LibraryNotice(it, true, "载入最新版本，保留草稿", controller::reload)
        EpButton("使用原请求重试", controller::retryOriginal, enabled = !value.busy)
    }
    value.notice?.let { LibraryNotice(it) }
}
