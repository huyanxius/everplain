package app.everplain.android

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
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
    private fun <T> field(initial: T): MutableState<T> {
        val backing = mutableStateOf(initial)
        return object : MutableState<T> {
            override var value: T
                get() = backing.value
                set(value) {
                    backing.value = value
                    persist(snapshot())
                }

            override fun component1() = value

            override fun component2(): (T) -> Unit = { value = it }
        }
    }

    val expectedVersion = field(data.expectedVersion)
    val name = field(data.name)
    val style = field(data.style)
    val soul = field(data.soul)
    val avatar = field(data.avatar)
    val color = field(data.color)

    private fun snapshot() =
        AgentDraftData(
            expectedVersion.value,
            name.value,
            style.value,
            soul.value,
            avatar.value,
            color.value,
        )
}
