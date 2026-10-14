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
import kotlinx.serialization.json.*

@OptIn(ExperimentalCoroutinesApi::class)
class TheoryControllerTest {
    @Test
    fun `all candidates and five relation fields are required before compound decisions`() =
        runTest {
            val api = TheoryApi()
            val c = TheoryController(api, this, MemoryStore(), "owner", "task") {}
            c.load()
            advanceUntilIdle()
            assertTrue(api.writes.isEmpty())
            c.choose("c1", "adopt")
            assertFalse(c.state.value.canSubmit)
            c.choose("c2", "combine")
            assertFalse(c.state.value.canSubmit)
            c.editRelation { TheoryRelationDraft("解释", "前提", "支持", "排除", "区分") }
            assertTrue(c.state.value.canSubmit)
            c.submit()
            advanceUntilIdle()
            val body =
                WireJson.decodeFromString<CreateTheoryDecisionsRequest>(api.writes.single().body)
            assertEquals(listOf("c1", "c2"), body.relations.single().candidateIds)
            assertEquals(listOf("c1"), body.decisions.last().relatedCandidateIds)
            assertEquals("primary", body.useAssignments.first().roleCode)
            c.close()
        }

    @Test
    fun `partial acknowledgement checkpoints before decisions and retry does not repeat the acknowledgement`() =
        runTest {
            val api = TheoryApi()
            api.run =
                api.run.copy(
                    failedCandidateIds = listOf("failed"),
                    partialCompletionAcknowledged = false,
                )
            val store = MemoryStore()
            val c = TheoryController(api, this, store, "owner", "task") {}
            c.load()
            advanceUntilIdle()
            c.choose("c1", "adopt")
            c.choose("c2", "exclude")
            api.loseDecision = true
            c.submit()
            advanceUntilIdle()
            assertEquals(2, api.writes.size)
            assertTrue(api.writes[0].path.endsWith("/partial-completion-acknowledgements"))
            assertEquals(
                2,
                WireJson.decodeFromString<CreateTheoryDecisionsRequest>(api.writes[1].body)
                    .expectedMatchRunVersion,
            )
            assertTrue(c.state.value.unknown)
            c.close()
            val restored = TheoryController(api, this, store, "owner", "task") {}
            restored.load()
            advanceUntilIdle()
            assertEquals(2, api.writes.size)
            api.loseDecision = false
            restored.retry()
            advanceUntilIdle()
            assertEquals(3, api.writes.size)
            assertEquals(api.writes[1], api.writes[2])
            assertFalse(restored.state.value.unknown)
            restored.close()
        }
}

private data class TheoryWrite(val path: String, val key: String?, val body: String)

private class TheoryApi :
    EverplainApi(Endpoint.parse("https://theory-fixture.example.invalid"), MemoryStore()) {
    private val fixtures =
        WireJson.parseToJsonElement(
                File("src/androidTest/assets/research-workspace-fixtures.json").readText()
            )
            .jsonObject
            .getValue("schemas")
            .jsonObject
    var run =
        WireJson.decodeFromJsonElement<MatchRunResponse>(fixtures.getValue("MatchRunResponse"))
    val nav =
        WireJson.decodeFromJsonElement<ResearchTaskNavigationResponse>(
            fixtures.getValue("ResearchTaskNavigationResponse")
        )
    val writes = mutableListOf<TheoryWrite>()
    var loseDecision = false

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val result =
            when {
                method == "GET" && path.endsWith("/navigation") -> WireJson.encodeToString(nav)
                method == "GET" && path.endsWith("/decisions") ->
                    WireJson.encodeToString(
                        TheoryDecisionPageResponse(
                            emptyList(),
                            emptyList(),
                            "release",
                            "run",
                            version = 1,
                        )
                    )
                method == "GET" && path.endsWith("/run") -> WireJson.encodeToString(run)
                method == "POST" -> {
                    writes += TheoryWrite(path, key, body!!)
                    if (path.endsWith("/partial-completion-acknowledgements")) {
                        run =
                            run.copy(
                                version = run.version + 1,
                                partialCompletionAcknowledged = true,
                            )
                        WireJson.encodeToString(run)
                    } else {
                        if (loseDecision) throw IOException("Synthetic unknown decision result")
                        val b = WireJson.decodeFromString<CreateTheoryDecisionsRequest>(body)
                        WireJson.encodeToString(
                            TheoryDecisionSetResponse(
                                emptyList(),
                                b.completionBasis,
                                "decision",
                                b.decisions.map {
                                    TheoryDecisionRecordResponse(
                                        it.action,
                                        it.candidateId,
                                        it.candidateVersion,
                                        "decision:${it.candidateId}",
                                        it.reason,
                                        "",
                                        it.relatedCandidateIds,
                                        it.relatedSourceIds.orEmpty(),
                                    )
                                },
                                1,
                                "release",
                                "run",
                                emptyList(),
                                emptyList(),
                                1,
                            )
                        )
                    }
                }
                else -> error("Unexpected synthetic request $method $path")
            }
        return WireJson.decodeFromString(serializer, result)
    }
}
