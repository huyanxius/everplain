package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(ExperimentalCoroutinesApi::class)
class MaterialControllerTest {
    @Test
    fun `upload keeps original keys through a lost response and never auto replays`() = runTest {
        val api = MaterialsApi().apply { lose = true }
        val store = MemoryStore()
        val contexts = mutableListOf<AgentMaterialContextResponse>()
        val controller =
            MaterialController(api, this, store, "owner", { _, c -> contexts += c }, {})
        controller.bind("draft", null)
        val file = File.createTempFile("ep-material", ".txt").apply { writeText("synthetic") }
        try {
            controller.upload(
                listOf(LibraryUpload(file.absolutePath, "note.txt", "text/plain", 100))
            )
            advanceUntilIdle()
            assertEquals(1, api.prepared)
            assertEquals(1, api.uploadKeys.size)
            assertTrue(controller.state.value.unresolved)
            val first = api.uploadKeys.single()
            controller.close()
            val restored = MaterialController(api, this, store, "owner", { _, _ -> }, {})
            restored.bind("replacement", null)
            restored.load()
            advanceUntilIdle()
            assertEquals(1, api.uploadKeys.size)
            api.lose = false
            restored.retryOriginal()
            advanceUntilIdle()
            assertEquals(listOf(first, first), api.uploadKeys)
            assertEquals(1, api.prepared)
            assertTrue(restored.state.value.attached.isEmpty())
            assertFalse(restored.state.value.unresolved)
            restored.close()
        } finally {
            file.delete()
        }
    }

    @Test
    fun `selection is ready only limited to twenty and removal does not delete server file`() =
        runTest {
            val api = MaterialsApi()
            val c = MaterialController(api, this, MemoryStore(), "owner", { _, _ -> }, {})
            c.bind("one", null)
            c.toggle(material("pending", status = "processing"))
            assertTrue(c.state.value.attached.isEmpty())
            repeat(21) { c.toggle(material(it.toString())) }
            assertEquals(20, c.state.value.attached.size)
            c.remove("0")
            assertEquals(19, c.state.value.attached.size)
            assertEquals(0, api.deletes)
            c.bind("two", null)
            assertTrue(c.state.value.attached.isEmpty())
            c.bind("one", null)
            assertEquals(19, c.state.value.attached.size)
            c.close()
        }

    @Test
    fun `reader and reparse preserve task and material identities`() = runTest {
        val api = MaterialsApi()
        val c = MaterialController(api, this, MemoryStore(), "owner", { _, _ -> }, {})
        c.load()
        advanceUntilIdle()
        c.open(c.state.value.available.single())
        advanceUntilIdle()
        assertEquals("material", c.state.value.selected!!.materialId)
        c.reparse(c.state.value.selected!!)
        advanceUntilIdle()
        assertEquals(1, api.reparses)
        c.delete(c.state.value.available.single())
        advanceUntilIdle()
        assertEquals(1, api.deletes)
        assertTrue(c.state.value.available.isEmpty())
        c.close()
    }
}

private fun material(id: String = "material", status: String = "ready") =
    ResearchMaterialResponse(
        displayName = "合成文件",
        filename = "note.txt",
        isCurrentParse = true,
        materialFormat = "text",
        materialId = id,
        materialKind = "other",
        mediaType = "text/plain",
        segmentCount = 0,
        sizeBytes = 9,
        status = status,
        taskId = "task",
        updatedAt = "2026-10-04T00:00:00Z",
        version = 1,
    )

private class MaterialsApi :
    EverplainApi(Endpoint.parse("https://material-fixture.example.invalid"), MemoryStore()) {
    var lose = false
    var prepared = 0
    var reparses = 0
    var deletes = 0
    val uploadKeys = mutableListOf<String>()

    override suspend fun uploadResearchDocument(
        taskId: String,
        file: UploadSnapshot,
        key: String,
    ): ResearchMaterialResponse {
        uploadKeys += key
        if (lose) throw IOException("Lost response")
        return material()
    }

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val json =
            when {
                path == "/api/agent/material-context" -> {
                    prepared++
                    WireJson.encodeToString(AgentMaterialContextResponse("conversation", "task"))
                }
                path == "/api/agent/materials" ->
                    WireJson.encodeToString(AgentMaterialListResponse(listOf(material())))
                path.endsWith("/reparse") -> {
                    reparses++
                    WireJson.encodeToString(material())
                }
                path.endsWith("/material") -> WireJson.encodeToString(material())
                else -> error("Unexpected $method $path")
            }
        return WireJson.decodeFromString(serializer, json)
    }

    override suspend fun contractUnit(
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ) {
        assertEquals("DELETE", method)
        deletes++
    }
}
