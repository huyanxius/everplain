package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MemoryControllerTest {
    @Test
    fun `empty personal memory avoids model overview and settings preserve independent version`() =
        runTest {
            val api = MemoryApi()
            val c =
                MemoryController(api, this, MemoryStore(), "owner") {
                    fail("Unexpected authentication expiry")
                }
            c.enter()
            advanceUntilIdle()
            assertFalse(c.state.value.loading)
            assertEquals(0, api.summaries)
            c.toggle("learn")
            advanceUntilIdle()
            assertTrue(c.state.value.settings!!.learnMemory)
            assertEquals(8L, c.state.value.settings!!.version)
            assertEquals(0, api.summaries)
        }

    @Test
    fun `UTF8 byte budget and explicit create use actual record key and only one submission`() =
        runTest {
            val api = MemoryApi()
            val c = MemoryController(api, this, MemoryStore(), "owner") {}
            c.enter()
            advanceUntilIdle()
            c.edit()
            c.draft("好".repeat(667))
            c.save()
            advanceUntilIdle()
            assertEquals(0, api.creates)
            c.draft("明确保留的测试记忆")
            c.save()
            c.save()
            advanceUntilIdle()
            assertEquals(1, api.creates)
            assertTrue(api.records.single().key.startsWith("note."))
            assertEquals("明确保留的测试记忆", api.records.single().content)
            assertEquals(1, api.summaries)
            assertNull(c.state.value.editor)
        }

    @Test
    fun `CAS refresh retains draft and requires explicit version acknowledgement`() = runTest {
        val api = MemoryApi().apply { records = listOf(record("旧版", 1)) }
        val c = MemoryController(api, this, MemoryStore(), "owner") {}
        c.enter()
        advanceUntilIdle()
        c.edit(c.state.value.items.single())
        c.draft("我的草稿")
        api.records = listOf(api.records.single().copy(content = "其他设备的新内容", version = 2))
        api.settings = api.settings.copy(version = 8)
        c.save()
        advanceUntilIdle()
        assertNotNull(c.state.value.error)
        assertEquals("我的草稿", c.state.value.draft)
        c.load()
        advanceUntilIdle()
        assertEquals(1L, c.state.value.editorVersion)
        val writes = api.updates
        c.save()
        advanceUntilIdle()
        assertEquals(writes, api.updates)
        c.acknowledgeVersion()
        c.save()
        advanceUntilIdle()
        assertEquals("我的草稿", api.records.single().content)
        assertEquals(3L, api.records.single().version)
    }

    @Test
    fun `ambiguous create is journaled and read reconciliation never replays it`() = runTest {
        val api = MemoryApi().apply { loseCreateReply = true }
        val store = MemoryStore()
        val c = MemoryController(api, this, store, "owner") {}
        c.enter()
        advanceUntilIdle()
        c.edit()
        c.draft("只创建一次")
        c.save()
        advanceUntilIdle()
        assertEquals(1, api.creates)
        assertEquals("只创建一次", c.state.value.draft)
        c.close()
        val resumed = MemoryController(api, this, store, "owner") {}
        assertEquals("只创建一次", resumed.state.value.draft)
        resumed.enter()
        advanceUntilIdle()
        assertEquals(1, api.creates)
        assertNull(resumed.state.value.editor)
        assertEquals("已与服务器记录核对。", resumed.state.value.notice)
        val anotherOwner = MemoryController(api, this, store, "other-owner") {}
        assertEquals("", anotherOwner.state.value.draft)
    }

    @Test
    fun `known validation failure allows corrected content without permanently locking journal`() =
        runTest {
            val api = MemoryApi().apply { validationFailure = true }
            val c = MemoryController(api, this, MemoryStore(), "owner") {}
            c.enter()
            advanceUntilIdle()
            c.edit()
            c.draft("server rejects")
            c.save()
            advanceUntilIdle()
            api.validationFailure = false
            c.draft("corrected")
            c.save()
            advanceUntilIdle()
            assertEquals("corrected", api.records.single().content)
        }

    @Test
    fun `history and delete preserve server identities and expected version`() = runTest {
        val api = MemoryApi().apply { records = listOf(record("record", 4)) }
        val c = MemoryController(api, this, MemoryStore(), "owner") {}
        c.enter()
        advanceUntilIdle()
        val item = c.state.value.items.single()
        c.select(item.memoryId)
        c.history(item)
        advanceUntilIdle()
        assertEquals(4L, c.state.value.revisions!!.single().version)
        c.delete(item)
        advanceUntilIdle()
        assertTrue(api.records.isEmpty())
        assertEquals("4", api.deleteVersion)
    }
}

private fun record(content: String, version: Long) =
    MemoryResponse(
        content,
        "2026-10-04T00:00:00Z",
        "note.synthetic",
        "00000000-0000-4000-8000-000000000041",
        "manual",
        updatedAt = "2026-10-04T00:00:00Z",
        version = version,
    )

private class MemoryApi :
    EverplainApi(Endpoint.parse("https://memory-fixture.example.invalid"), MemoryStore()) {
    var records = listOf<MemoryResponse>()
    var settings = MemorySettings(false, null, true, 7)
    var summaries = 0
    var creates = 0
    var updates = 0
    var loseCreateReply = false
    var validationFailure = false
    var deleteVersion: String? = null

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val response =
            when {
                path == "/api/memories" && method == "GET" ->
                    WireJson.encodeToString(MemoryCollection(records, MemoryLimits(2000, 100)))
                path == "/api/memories/settings" && method == "GET" ->
                    WireJson.encodeToString(settings)
                path == "/api/memories/settings" && method == "PATCH" -> {
                    val update = WireJson.decodeFromString<MemorySettingsUpdate>(body!!)
                    assertEquals(settings.version, update.expectedVersion)
                    settings =
                        settings.copy(
                            version = settings.version + 1,
                            useMemory = update.useMemory,
                            learnMemory = update.learnMemory,
                        )
                    WireJson.encodeToString(settings)
                }
                path == "/api/memories/overview" -> {
                    summaries++
                    WireJson.encodeToString(
                        MemoryOverviewResponse(
                            records.size.toLong(),
                            settings.version,
                            "Synthetic overview",
                        )
                    )
                }
                path == "/api/memories" && method == "POST" -> {
                    assertFalse(key.isNullOrBlank())
                    creates++
                    if (validationFailure) throw ApiFailure(422, "validation", "合成校验失败")
                    val request = WireJson.decodeFromString<MemoryCreate>(body!!)
                    val created = record(request.content, 1).copy(key = request.key)
                    records = records + created
                    settings = settings.copy(version = settings.version + 1)
                    if (loseCreateReply) throw IOException("Synthetic lost response")
                    WireJson.encodeToString(created)
                }
                path.endsWith("/revisions") -> WireJson.encodeToString(MemoryList(records))
                method == "PATCH" -> {
                    updates++
                    val request = WireJson.decodeFromString<MemoryUpdate>(body!!)
                    val current = records.single()
                    if (request.expectedVersion != current.version)
                        throw ApiFailure(409, "conflict", "Conflict")
                    val next =
                        current.copy(content = request.content, version = current.version + 1)
                    records = listOf(next)
                    settings = settings.copy(version = settings.version + 1)
                    WireJson.encodeToString(next)
                }
                else -> error("Unhandled synthetic request $method $path")
            }
        return WireJson.decodeFromString(serializer, response)
    }

    override suspend fun contractUnit(
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ) {
        assertEquals("DELETE", method)
        assertTrue(path.endsWith(records.single().memoryId))
        assertFalse(key.isNullOrBlank())
        deleteVersion = query["expected_version"]?.single()
        assertEquals(records.single().version.toString(), deleteVersion)
        records = emptyList()
        settings = settings.copy(version = settings.version + 1)
    }
}
