package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(ExperimentalCoroutinesApi::class)
class CanvasControllerTest {
    @Test
    fun `node save uses expected original fields version and does not remove citations`() =
        runTest {
            val api = CanvasApi()
            var saved: AgentConversationResponse? = null
            val c = CanvasController(api, this, MemoryStore(), "owner", { saved = it }, {})
            c.begin(api.conversation, api.node)
            c.change(title = "用户的新标题", summary = "用户说明")
            c.save()
            c.save()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertEquals(1, api.writes.single().second.expectedVersion)
            assertEquals("原标题", api.writes.single().second.expectedTitle)
            assertEquals(listOf("citation"), saved!!.researchMap.nodes.single().citationIds)
            assertEquals("用户的新标题", saved!!.researchMap.nodes.single().title)
            assertNull(c.state.value.draft)
            c.close()
        }

    @Test
    fun `409 keeps draft and read only reload rebases original without sending`() = runTest {
        val api = CanvasApi()
        val c = CanvasController(api, this, MemoryStore(), "owner", {}, {})
        c.begin(api.conversation, api.node)
        c.change(title = "我的修改")
        api.conversation =
            api.conversation.copy(
                canvasEditVersion = 2,
                researchMap =
                    api.conversation.researchMap.copy(
                        nodes = listOf(api.node.copy(title = "其他设备修改"))
                    ),
            )
        c.save()
        advanceUntilIdle()
        assertEquals("我的修改", c.state.value.draft!!.title)
        assertNotNull(c.state.value.error)
        c.reload()
        advanceUntilIdle()
        assertEquals(1, api.writes.size)
        assertEquals(2, c.state.value.draft!!.version)
        c.save()
        advanceUntilIdle()
        assertEquals("我的修改", api.conversation.researchMap.nodes.single().title)
        c.close()
    }

    @Test
    fun `lost successful reply reconciles canonical desired values without another write`() =
        runTest {
            val api = CanvasApi().apply { loseReply = true }
            val c = CanvasController(api, this, MemoryStore(), "owner", {}, {})
            c.begin(api.conversation, api.node)
            c.change(summary = "明确的新说明")
            c.save()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertNotNull(c.state.value.error)
            c.reload()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertEquals("明确的新说明", c.state.value.draft!!.summary)
            assertEquals(2, c.state.value.draft!!.version)
            c.close()
        }
}

private class CanvasApi :
    EverplainApi(Endpoint.parse("https://canvas-fixture.example.invalid"), MemoryStore()) {
    val node =
        AgentResearchMapNodeResponse(
            listOf("citation"),
            "node",
            "claim",
            "developing",
            "原说明",
            "原标题",
            false,
        )
    var conversation =
        AgentConversationResponse(
            canvasEditVersion = 1,
            conversationId = "conversation",
            createdAt = "",
            researchMap = AgentResearchMapResponse(listOf(node), emptyList(), 1),
            title = "合成研究",
            turnCount = 0,
            turns = emptyList(),
            updatedAt = "",
        )
    var loseReply = false
    val writes = mutableListOf<Pair<String?, AgentCanvasNodeEditRequest>>()

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        if (method == "PATCH") {
            val request = WireJson.decodeFromString<AgentCanvasNodeEditRequest>(body!!)
            writes += key to request
            if (request.expectedVersion != conversation.canvasEditVersion)
                throw ApiFailure(409, "version_conflict", "changed")
            conversation =
                conversation.copy(
                    canvasEditVersion = (conversation.canvasEditVersion ?: 0) + 1,
                    researchMap =
                        conversation.researchMap.copy(
                            nodes =
                                listOf(
                                    node.copy(
                                        title = request.title,
                                        summary = request.summary,
                                        userEdited = true,
                                    )
                                )
                        ),
                )
            if (loseReply) throw IOException("Lost reply")
        } else assertEquals("GET", method)
        return WireJson.decodeFromString(serializer, WireJson.encodeToString(conversation))
    }
}
