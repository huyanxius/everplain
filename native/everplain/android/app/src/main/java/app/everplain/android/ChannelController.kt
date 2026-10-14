package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal data class ChannelState(
    val gateways: List<ChannelGatewayInfoResponse> = emptyList(),
    val bindings: List<ChannelBindingResponse> = emptyList(),
    val selected: String = "",
    val consent: Boolean = false,
    val grant: ChannelLinkCodeResponse? = null,
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val feedback: String? = null,
    val remaining: Long = 0,
)

internal class ChannelController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val mutable = MutableStateFlow(ChannelState())
    val state = mutable.asStateFlow()
    private var closed = false
    private var visible = false
    private var generation = 0L
    private var readJob: Job? = null
    private var writeJob: Job? = null
    private var pollJob: Job? = null
    private var prior = emptySet<String>()

    private fun update(f: (ChannelState) -> ChannelState) {
        if (!closed) mutable.update(f)
    }

    fun enter() {
        visible = true
        refresh()
    }

    fun leave() {
        visible = false
        generation++
        readJob?.cancel()
        pollJob?.cancel()
        update { it.copy(grant = null, consent = false) }
    }

    fun close() {
        leave()
        closed = true
        writeJob?.cancel()
    }

    private fun failure(e: Exception, write: Boolean) {
        val f = e as? ApiFailure
        if (f?.status == 401) unauthorized(f)
        update {
            it.copy(
                error =
                    if (f?.status == 401) "登录已过期，请重新登录。"
                    else if (write) "操作结果尚未确认。请刷新绑定状态后再操作。" else "暂时无法读取聊天平台，请重试。"
            )
        }
    }

    fun refresh() {
        if (state.value.busy) return
        pollJob?.cancel()
        readJob?.cancel()
        val g = ++generation
        update { it.copy(grant = null, loading = true, error = null) }
        readJob =
            scope.launch {
                try {
                    val options = api.native.listChannelGateways()
                    val rows = api.native.listChannelBindings()
                    if (g == generation)
                        update {
                            it.copy(
                                gateways = options,
                                bindings = rows,
                                selected =
                                    it.selected.takeIf { value ->
                                        options.any { it.gatewayId == value }
                                    } ?: options.firstOrNull()?.gatewayId.orEmpty(),
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

    fun select(id: String) {
        if (state.value.busy || state.value.loading || state.value.gateways.none { it.gatewayId == id }) return
        pollJob?.cancel()
        generation++
        update {
            it.copy(selected = id, consent = false, grant = null, error = null, feedback = null)
        }
    }

    fun consent(value: Boolean) {
        if (!state.value.busy) update { it.copy(consent = value) }
    }

    private fun perform(work: suspend () -> Unit) {
        if (closed || state.value.busy || state.value.loading) return
        generation++
        readJob?.cancel()
        pollJob?.cancel()
        update { it.copy(busy = true, error = null, feedback = null) }
        writeJob =
            scope.launch {
                try {
                    work()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failure(e, true)
                } finally {
                    update { it.copy(busy = false) }
                    poll()
                }
            }
    }

    fun generate() {
        val s = state.value
        if (!s.consent || s.selected.isEmpty()) return
        prior = s.bindings.map { it.bindingId }.toSet()
        perform {
            val requestGeneration = generation
            val grant = api.native.createChannelLinkCode(ChannelLinkCodeRequest(true, s.selected))
            if (visible && requestGeneration == generation)
                update {
                    it.copy(
                        grant = grant,
                        remaining =
                            (grant.expiresAt - System.currentTimeMillis() / 1000).coerceAtLeast(0),
                    )
                }
        }
    }

    fun cancel() {
        val grant = state.value.grant ?: return
        perform {
            api.native.cancelChannelLinkCodes(grant.gatewayId)
            update { it.copy(grant = null, feedback = "绑定码已作废。") }
        }
    }

    fun revoke(id: String) {
        val gateway = state.value.bindings.find { it.bindingId == id }?.gatewayId ?: return
        perform {
            api.native.revokeChannelBinding(id)
            update {
                it.copy(
                    bindings = it.bindings.filterNot { row -> row.bindingId == id },
                    grant = it.grant?.takeUnless { g -> g.gatewayId == gateway },
                    feedback = "已解除绑定，尚未发送的私人回复将停止投递。",
                )
            }
        }
    }

    fun copied() {
        update { it.copy(feedback = "命令已复制。只发送给你选择的机器人私聊。") }
    }

    private fun poll() {
        pollJob?.cancel()
        if (!visible || state.value.grant == null || closed) return
        val g = generation
        pollJob =
            scope.launch {
                var tick = 0
                while (visible && g == generation) {
                    delay(1000)
                    val grant = state.value.grant ?: break
                    val left =
                        (grant.expiresAt - System.currentTimeMillis() / 1000).coerceAtLeast(0)
                    if (left == 0L) {
                        update { it.copy(grant = null, remaining = 0, feedback = "绑定码已过期，请重新生成。") }
                        break
                    }
                    update { it.copy(remaining = left) }
                    tick++
                    if (tick % 3 == 0 && !state.value.busy)
                        try {
                            val rows = api.native.listChannelBindings()
                            if (g != generation) break
                            val bound =
                                rows.any {
                                    it.gatewayId == grant.gatewayId && it.bindingId !in prior
                                }
                            update {
                                it.copy(
                                    bindings = rows,
                                    grant = if (bound) null else it.grant,
                                    feedback = if (bound) "已确认绑定成功，可以去平台私聊了。" else it.feedback,
                                )
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            if ((e as? ApiFailure)?.status == 401) {
                                failure(e, false)
                                break
                            }
                        }
                }
            }
    }
}

