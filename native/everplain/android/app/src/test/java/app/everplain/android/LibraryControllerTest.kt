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
class LibraryControllerTest {
    @Test
    fun `catalog keeps successful libraries when another is temporarily unavailable`() = runTest {
        val api = LibraryApi().apply { failLibrary = "second" }
        val c = LibraryController(api, this, MemoryStore(), "owner") {}
        c.enter()
        advanceUntilIdle()
        assertFalse(c.state.value.loading)
        assertEquals(1, c.state.value.materials.size)
        assertNotNull(c.state.value.catalogError)
        assertEquals(0, api.writes.size)
        c.close()
    }

    @Test
    fun `uncertain create persists exact original body and no automatic replay after reopen`() =
        runTest {
            val api = LibraryApi().apply { loseCreate = true }
            val store = MemoryStore()
            val c = LibraryController(api, this, store, "owner") {}
            c.saveLibrary(null, "测试知识库", "说明")
            advanceUntilIdle()
            assertTrue(c.state.value.unresolved)
            val original = api.writes.single()
            c.close()
            val fresh = LibraryController(api, this, store, "owner") {}
            fresh.enter()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            fresh.saveLibrary(null, "different", "never sent")
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            api.loseCreate = false
            fresh.retryOriginal()
            advanceUntilIdle()
            assertEquals(original, api.writes.last())
            assertFalse(fresh.state.value.unresolved)
            val other = LibraryController(api, this, store, "other-owner") {}
            assertFalse(other.state.value.unresolved)
            fresh.close()
            other.close()
        }

    @Test
    fun `processing uses read only lifecycle polling and stops when hidden`() = runTest {
        val api = LibraryApi().apply { processing = true }
        val c = LibraryController(api, this, MemoryStore(), "owner") {}
        c.enter()
        runCurrent()
        val reads = api.reads
        advanceTimeBy(3001)
        runCurrent()
        assertTrue(api.reads > reads)
        assertTrue(api.writes.isEmpty())
        c.leave()
        val stopped = api.reads
        advanceTimeBy(10000)
        runCurrent()
        assertEquals(stopped, api.reads)
        c.close()
    }

    @Test
    fun `known validation failure permits corrected library name`() = runTest {
        val api = LibraryApi().apply { rejectCreate = true }
        val c = LibraryController(api, this, MemoryStore(), "owner") {}
        c.saveLibrary(null, "rejected", "")
        advanceUntilIdle()
        assertFalse(c.state.value.unresolved)
        api.rejectCreate = false
        c.saveLibrary(null, "corrected", "")
        advanceUntilIdle()
        assertEquals(2, api.writes.size)
        assertNotEquals(api.writes.first().second, api.writes.last().second)
        c.close()
    }

    @Test
    fun `read only membership source preserves identifiers and never invokes organize`() = runTest {
        val api = LibraryApi()
        val c = LibraryController(api, this, MemoryStore(), "owner") {}
        c.source("first", "doc")
        advanceUntilIdle()
        assertEquals("first", c.state.value.source!!.knowledgeBaseId)
        assertEquals("source text", c.state.value.source!!.segments.single().text)
        assertTrue(api.writes.isEmpty())
        c.close()
    }
}

private class LibraryApi :
    EverplainApi(Endpoint.parse("https://library-fixture.example.invalid"), MemoryStore()) {
    var failLibrary: String? = null
    var loseCreate = false
    var rejectCreate = false
    var processing = false
    var reads = 0
    val writes = mutableListOf<Triple<String, String?, String?>>()

    private fun document() =
        SharedDocumentResponse(
            "2026-10-04T00:00:00Z",
            filename = "合成笔记.txt",
            id = "doc",
            indexStatus = "ready",
            knowledgeStatus = "ready",
            mediaType = "text/plain",
            parseId = "parse",
            sizeBytes = 10,
            status = if (processing) "processing" else "ready",
        )

    private fun library(id: String) =
        SharedKnowledgeResponse(
            documents = listOf(document()),
            id = id,
            name = id,
            viewerAccess = "owner",
        )

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val json =
            if (method == "GET") {
                reads++
                when {
                    path == "/api/shared-knowledge-bases" ->
                        WireJson.encodeToString(
                            SharedKnowledgeListResponse(listOf(library("first"), library("second")))
                        )
                    path == "/api/knowledge-storage" ->
                        WireJson.encodeToString(
                            KnowledgeStorageResponse(2, 100000, 100000, 100, 10000, 10, 100)
                        )
                    path == "/api/imports" ->
                        WireJson.encodeToString(ImportBatchListResponse(emptyList()))
                    path.endsWith("/source") ->
                        """{"document":${WireJson.encodeToString(document())},"knowledge_base_id":"first","knowledge_base_name":"first","segments":[{"kind":"text","locator":{"section_path":[]},"ordinal":0,"parse_id":"parse","segment_id":"segment","text":"source text"}]}"""
                    path.startsWith("/api/shared-knowledge-bases/") -> {
                        val id = path.substringAfterLast('/')
                        if (id == failLibrary) throw IOException("Synthetic unavailable")
                        WireJson.encodeToString(library(id))
                    }
                    else -> error("Unexpected read $path")
                }
            } else {
                writes += Triple(path, key, body)
                if (loseCreate) throw IOException("Reply lost")
                if (rejectCreate) throw ApiFailure(422, "invalid", "Synthetic validation")
                WireJson.encodeToString(library("created"))
            }
        return WireJson.decodeFromString(serializer, json)
    }
}
