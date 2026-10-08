package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(ExperimentalCoroutinesApi::class)
class ResearchArchiveControllerTest {
    @Test
    fun `reading audit never creates an archive and restoring unknown export keeps original key`() =
        runTest {
            val api = ArchiveApi()
            val store = MemoryStore()
            val io = StandardTestDispatcher(testScheduler)
            val c = ResearchArchiveController(api, this, store, "owner", "task", io) {}
            c.load()
            advanceUntilIdle()
            assertTrue(api.keys.isEmpty())
            api.lose = true
            c.export { ByteArrayOutputStream() }
            c.export { ByteArrayOutputStream() }
            advanceUntilIdle()
            assertEquals(1, api.keys.size)
            assertTrue(c.state.value.unknown)
            c.close()
            val restored = ResearchArchiveController(api, this, store, "owner", "task", io) {}
            restored.load()
            advanceUntilIdle()
            assertEquals(1, api.keys.size)
            api.lose = false
            restored.export { ByteArrayOutputStream() }
            advanceUntilIdle()
            assertEquals(api.keys[0], api.keys[1])
            assertFalse(restored.state.value.unknown)
            assertNotNull(restored.state.value.exported)
            restored.export { ByteArrayOutputStream() }
            advanceUntilIdle()
            assertNotEquals(api.keys[1], api.keys[2])
            restored.close()
        }

    @Test
    fun `export scope does not leak across account project or origin`() = runTest {
        val api = ArchiveApi()
        val store = MemoryStore()
        val io = StandardTestDispatcher(testScheduler)
        val c = ResearchArchiveController(api, this, store, "owner", "task", io) {}
        api.lose = true
        c.export { ByteArrayOutputStream() }
        advanceUntilIdle()
        c.close()
        listOf("other" to "task", "owner" to "other").forEach { (owner, task) ->
            val separate = ResearchArchiveController(api, this, store, owner, task, io) {}
            assertFalse(separate.state.value.unknown)
            separate.close()
        }
    }
}

private class ArchiveApi :
    EverplainApi(Endpoint.parse("https://archive-fixture.example.invalid"), MemoryStore()) {
    val keys = mutableListOf<String>()
    var lose = false

    override suspend fun downloadResearchArchive(
        taskId: String,
        key: String,
        output: OutputStream,
        maxBytes: Long,
    ): ResearchArchiveDownload {
        keys += key
        if (lose) throw IOException("Synthetic interrupted response")
        output.write(byteArrayOf(1, 2, 3))
        return ResearchArchiveDownload("research-project.zip", "exchange", "", false, 1, 0, 3)
    }

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        check(method == "GET" && path.endsWith("/exchange/audit"))
        return WireJson.decodeFromString(
            serializer,
            WireJson.encodeToString(ResearchAuditEventListResponse(emptyList(), "task")),
        )
    }
}
