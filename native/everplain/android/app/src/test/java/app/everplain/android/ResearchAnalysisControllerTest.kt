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
class ResearchAnalysisControllerTest {
    @Test
    fun `load is read only and empty drafts cannot submit`() = runTest {
        val api = AnalysisApi()
        val c = ResearchAnalysisController(api, this, MemoryStore(), "owner", "task") {}
        c.load()
        advanceUntilIdle()
        c.saveMemo()
        c.saveComparison()
        advanceUntilIdle()
        assertTrue(api.writes.isEmpty())
        assertNotNull(c.state.value.snapshot)
        assertNotNull(c.state.value.cycleError)
        assertNull(c.state.value.error)
        c.close()
    }

    @Test
    fun `original memo retry keeps later draft and does not auto replay after recreation`() =
        runTest {
            val api = AnalysisApi()
            val store = MemoryStore()
            val c = ResearchAnalysisController(api, this, store, "owner", "task") {}
            c.load()
            advanceUntilIdle()
            c.editMemo { it.copy(open = true, title = "原题", content = "原分析") }
            api.lose = true
            c.saveMemo()
            c.saveMemo()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            c.editMemo { it.copy(content = "后来修改") }
            c.close()
            val restored = ResearchAnalysisController(api, this, store, "owner", "task") {}
            restored.load()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertTrue(restored.state.value.unknown)
            api.lose = false
            restored.retry()
            advanceUntilIdle()
            assertEquals(api.writes[0], api.writes[1])
            assertEquals("原分析", restored.state.value.snapshot!!.memos.single().content)
            assertEquals("后来修改", restored.state.value.drafts.memo.content)
            assertTrue(restored.state.value.drafts.memo.open)
            restored.saveMemo()
            advanceUntilIdle()
            assertFalse(restored.state.value.drafts.memo.open)
            assertNotEquals(api.writes[1].first, api.writes[2].first)
            restored.close()
        }

    @Test
    fun `decisions require an actual agent candidate and nonblank reason with current version`() =
        runTest {
            val api = AnalysisApi()
            api.snapshot =
                api.snapshot.copy(
                    memos =
                        listOf(api.memo.copy(source = "agent", status = "candidate", version = 7))
                )
            val c = ResearchAnalysisController(api, this, MemoryStore(), "owner", "task") {}
            c.load()
            advanceUntilIdle()
            c.decideMemo("memo", "confirmed", " ")
            c.decideMemo("missing", "confirmed", "理由")
            advanceUntilIdle()
            assertTrue(api.writes.isEmpty())
            c.decideMemo("memo", "confirmed", "核对了原文")
            advanceUntilIdle()
            val body =
                WireJson.decodeFromString<DecideAnalysisRecordRequest>(api.writes.single().second)
            assertEquals(7, body.expectedVersion)
            assertEquals("confirmed", c.state.value.snapshot!!.memos.single().status)
            c.decideMemo("memo", "rejected", "再按一次")
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            c.close()
        }
}

private class AnalysisApi :
    EverplainApi(Endpoint.parse("https://analysis-fixture.example.invalid"), MemoryStore()) {
    val memo =
        AnalysisMemoResponse(
            annotationIds = emptyList(),
            content = "合成分析",
            createdAt = "",
            memoId = "memo",
            memoKind = "analytic",
            source = "user",
            status = "confirmed",
            taskId = "task",
            title = "合成标题",
            version = 1,
        )
    var snapshot = ResearchAnalysisSnapshotResponse(emptyList(), emptyList(), emptyList(), "task")
    val writes = mutableListOf<Pair<String?, String>>()
    var lose = false

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val data =
            when {
                method == "GET" && path.endsWith("/analysis") -> WireJson.encodeToString(snapshot)
                method == "GET" && path.endsWith("/materials") ->
                    WireJson.encodeToString(ResearchMaterialListResponse(emptyList(), "task"))
                method == "GET" && path.endsWith("/cycle") ->
                    throw ApiFailure(
                        501,
                        "fixture_cycle_unavailable",
                        "Synthetic cycle unavailable",
                    )
                method == "POST" -> {
                    writes += key to body!!
                    if (lose) throw IOException("Synthetic interrupted memo")
                    val result =
                        if (path.endsWith("/decision")) {
                            val b = WireJson.decodeFromString<DecideAnalysisRecordRequest>(body)
                            memo.copy(
                                status = b.decision,
                                version = b.expectedVersion + 1,
                                decisionReason = b.reason,
                            )
                        } else {
                            val b = WireJson.decodeFromString<CreateAnalysisMemoRequest>(body)
                            memo.copy(
                                title = b.title,
                                content = b.content,
                                memoKind = b.memoKind,
                                annotationIds = b.annotationIds.orEmpty(),
                            )
                        }
                    snapshot = snapshot.copy(memos = listOf(result))
                    WireJson.encodeToString(result)
                }
                else -> error("Unexpected fixture request $method $path")
            }
        return WireJson.decodeFromString(serializer, data)
    }
}
