package app.everplain.android

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

@Serializable
internal data class AgentDraftData(
    val expectedVersion: Long,
    val name: String,
    val style: String,
    val soul: String,
    val avatar: String,
    val color: String,
)

/**
 * Owned outside a screen's composition. Each edit is immediately backed by encrypted private
 * storage.
 */
internal class AgentSettingsDraft(
    data: AgentDraftData,
    private val persist: (AgentDraftData) -> Unit,
) {
    private val mutable = MutableStateFlow(data)
    val state = mutable.asStateFlow()
    private val storageError = MutableStateFlow<String?>(null)
    val error = storageError.asStateFlow()

    @Synchronized
    fun edit(change: (AgentDraftData) -> AgentDraftData) {
        val next = change(mutable.value)
        if (next == mutable.value) return
        try {
            persist(next)
            storageError.value = null
        } catch (_: Exception) {
            storageError.value = "本机草稿暂未写入安全存储。文字仍保留在当前页面，请不要退出应用。"
        }
        mutable.value = next
    }
}
