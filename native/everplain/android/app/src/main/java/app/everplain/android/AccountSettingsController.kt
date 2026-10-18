package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.encodeToString

internal data class AccountSettingsState(
    val account: AccountResponse? = null,
    val sessions: List<AccountSessionResponse> = emptyList(),
    val busy: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val conflict: Boolean = false,
    val unknown: Boolean = false,
    val completed: Long = 0,
    val completedAction: String? = null,
    val export: DataExportResponse? = null,
)

/** Passwords and binding grants stay in memory only; there is no automatic mutation replay. */
internal class AccountSettingsController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    initial: AccountResponse?,
    private val accountChanged: (AccountResponse) -> Unit,
    private val accessEnded: () -> Unit,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val mutable = MutableStateFlow(AccountSettingsState(account = initial))
    val state = mutable.asStateFlow()
    private var readJob: Job? = null
    private var writeJob: Job? = null
    private var closed = false
    private var generation = 0L
    private var intent: Triple<String, String, String>? = null

    private fun update(f: (AccountSettingsState) -> AccountSettingsState) {
        if (!closed) mutable.update(f)
    }

    fun close() {
        closed = true
        generation++
        readJob?.cancel()
        writeJob?.cancel()
        intent = null
    }

    fun load() {
        if (state.value.busy || closed) return
        readJob?.cancel()
        val version = ++generation
        readJob =
            scope.launch {
                update { it.copy(loading = true, error = null) }
                try {
                    val account = api.native.getAccount()
                    val sessions = api.native.listAccountSessions().items
                    if (!closed && version == generation) {
                        update { it.copy(account = account, sessions = sessions) }
                        accountChanged(account)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (version == generation) fail(e, false)
                } finally {
                    if (version == generation) update { it.copy(loading = false) }
                }
            }
    }

    private fun preferences(prefs: AccountPreferencesResponse) {
        if (closed) return
        val a = state.value.account ?: return
        val updated = a.copy(preferences = prefs)
        update { it.copy(account = updated) }
        accountChanged(updated)
    }

    private fun fail(e: Exception, writing: Boolean) {
        val f = e as? ApiFailure
        if (f?.status == 401) unauthorized(f)
        val definite = f != null && f.status in 400..499 && f.status !in setOf(408, 409, 429)
        if (writing && definite) intent = null
        update {
            it.copy(
                error = f?.message ?: "连接中断，操作结果尚未确认。",
                conflict = f?.status == 409,
                unknown = writing && !definite,
            )
        }
    }

    private fun perform(
        action: String,
        body: String,
        notice: String,
        work: suspend (String) -> Unit,
    ) {
        if (closed || state.value.busy) return
        val old = intent
        if (old != null && (old.first != action || old.second != body) && state.value.unknown) {
            update { it.copy(error = "上一项操作结果尚未确认。请先重新读取，或明确结束本地等待。") }
            return
        }
        val key = if (old?.first == action && old.second == body) old.third else newIntentKey()
        intent = Triple(action, body, key)
        readJob?.cancel()
        generation++
        update {
            it.copy(busy = true, loading = false, error = null, notice = null, conflict = false)
        }
        writeJob =
            scope.launch {
                try {
                    work(key)
                    if (!closed) {
                        intent = null
                        update {
                            it.copy(
                                unknown = false,
                                notice = it.notice ?: notice,
                                completed = it.completed + 1,
                                completedAction = action,
                            )
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    fail(e, true)
                } finally {
                    update { it.copy(busy = false) }
                }
            }
    }

    /** Explicit acknowledgement only. It does not retract or claim failure of a server mutation. */
    fun endLocalWait() {
        if (state.value.busy) return
        intent = null
        update {
            it.copy(
                unknown = false,
                conflict = false,
                notice = "已结束本地等待。服务器结果仍可能生效，请先重新读取确认。",
                error = null,
            )
        }
    }

    fun savePreferences(locale: String, timezone: String, expected: Long) {
        val prefs = state.value.account?.preferences ?: return
        val body =
            UpdatePreferencesRequest(expected, locale, prefs.researchUpdatesEnabled, timezone)
        perform("preferences", WireJson.encodeToString(body), "偏好已保存。") {
            preferences(api.native.updateAccountPreferences(it, body))
        }
    }

    fun changePassword(current: String, next: String, confirmation: String, revoke: Boolean) {
        if (next.length !in 12..128) {
            update { it.copy(error = "新密码需要 12-128 个字符。") }
            return
        }
        if (next != confirmation) {
            update { it.copy(error = "两次输入的新密码不一致。") }
            return
        }
        if (current.isEmpty()) return
        val body = ChangePasswordRequest(current, next, revoke)
        perform("password", WireJson.encodeToString(body), "密码已更新。") {
            val result = api.native.changeAccountPassword(it, body)
            update { s ->
                s.copy(
                    sessions = if (revoke) s.sessions.filter { it.current } else s.sessions,
                    notice = "密码已更新，已撤销 ${result.revokedSessionCount} 个其他会话。",
                )
            }
        }
    }

    fun revoke(session: AccountSessionResponse) {
        if (session.current) return
        perform("revoke", session.sessionId, "会话已撤销。") { key ->
            api.native.revokeAccountSession(session.sessionId, key)
            update {
                it.copy(
                    sessions = it.sessions.filterNot { row -> row.sessionId == session.sessionId }
                )
            }
        }
    }

    fun modelConsent(allowed: Boolean, expected: Long, policy: String) {
        val body = UpdateModelDataAuthorizationRequest(allowed, expected, policy)
        perform(
            "consent",
            WireJson.encodeToString(body),
            if (allowed) "模型数据授权已开启。" else "模型数据授权已关闭。",
        ) {
            preferences(api.native.updateModelDataAuthorization(it, body))
        }
    }

    fun requestExport() {
        val body = DataExportCreateRequest("json")
        perform("export", WireJson.encodeToString(body), "数据副本状态已更新。") { key ->
            val result = api.native.createAccountDataExport(key, body)
            update { it.copy(export = result) }
        }
    }

    suspend fun saveExport(output: java.io.OutputStream) {
        val export = state.value.export?.takeIf { it.status == "ready" } ?: error("数据副本尚未准备好")
        api.downloadAccountExport(export.exportId, output)
    }

    fun redeem(code: String, onDone: () -> Unit) {
        if (code.trim().isEmpty()) return
        val body = CreditRedemptionRequest(code.trim())
        perform("redeem", WireJson.encodeToString(body), "兑换码已到账。") {
            api.native.redeemAccountCredits(it, body)
            if (!closed) onDone()
        }
    }

    fun deactivate(password: String, reason: String) {
        if (
            state.value.account?.isProtectedAdmin != false || password.isEmpty() || reason.isBlank()
        )
            return
        val body = DeactivateAccountRequest(password, reason.trim())
        perform("deactivate", WireJson.encodeToString(body), "账户已停用。") {
            api.native.deactivateAccount(it, body)
            if (!closed) accessEnded()
        }
    }

    fun delete(password: String, email: String) {
        val account = state.value.account ?: return
        if (
            account.isProtectedAdmin ||
                password.isEmpty() ||
                !email.trim().equals(account.email, true)
        )
            return
        val body = DeleteAccountRequest(email.trim(), password)
        perform("delete", WireJson.encodeToString(body), "账户已永久删除。") {
            api.native.deleteAccount(it, body)
            if (!closed) accessEnded()
        }
    }
}
