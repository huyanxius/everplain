package app.everplain.android

import kotlin.test.*

class AgentSettingsDraftTest {
    private val original = AgentDraftData(1, "澄", "clear", "合成测试", "cheng", "#5d8fe6")

    @Test
    fun `draft updates are coherent snapshots independent of composition and restore all fields`() {
        val persisted = mutableListOf<AgentDraftData>()
        val draft = AgentSettingsDraft(original) { persisted += it }
        draft.edit { it.copy(name = "保留未保存的草稿", avatar = "you", color = "#ec8a52") }
        assertEquals(1, persisted.size)
        assertEquals(persisted.single(), draft.state.value)
        val restored = AgentSettingsDraft(persisted.single()) { persisted += it }
        assertEquals("保留未保存的草稿", restored.state.value.name)
        assertEquals("you", restored.state.value.avatar)
        restored.edit { it.copy(style = "warm", expectedVersion = 2) }
        assertEquals("保留未保存的草稿", persisted.last().name)
        assertEquals(2, persisted.last().expectedVersion)
    }

    @Test
    fun `storage failure keeps typed text and exposes recovery warning`() {
        val draft = AgentSettingsDraft(original) { error("Synthetic storage failure") }
        draft.edit { it.copy(name = "没有丢失") }
        assertEquals("没有丢失", draft.state.value.name)
        assertNotNull(draft.error.value)
    }
}
