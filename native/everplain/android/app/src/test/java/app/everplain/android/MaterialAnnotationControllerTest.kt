package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

private fun segment(text: String) =
    ResearchMaterialSegmentResponse(
        "paragraph",
        ResearchMaterialLocatorResponse(sectionPath = emptyList()),
        "material",
        0,
        "parse-1",
        "segment-1",
        text,
    )

@OptIn(ExperimentalCoroutinesApi::class)
class MaterialAnnotationControllerTest {
    @Test
    fun `selection converts UTF16 and trims like the exact immutable Web source`() {
        val source = segment("甲  😀乙  丙")
        val selection = materialSelection(source, 1, 8)!!
        assertEquals("😀乙", selection.quote)
        assertEquals(3L, selection.start)
        assertEquals(5L, selection.end)
        assertEquals("parse-1", selection.segment.parseId)
    }

    @Test
    fun `split surrogate empty and out of bounds selections are rejected`() {
        val source = segment("甲😀乙")
        assertNull(materialSelection(source, 2, 3))
        assertNull(materialSelection(source, 1, 2))
        assertNull(materialSelection(source, 0, 20))
        assertNull(materialSelection(source, 1, 1))
        assertNull(materialSelection(segment("  \n\uFEFF"), 0, 4))
    }

    @Test
    fun `repeated source quotes retain the selected occurrence rather than searching first match`() {
        val selection = materialSelection(segment("证据 证据"), 3, 5)!!
        assertEquals(3L, selection.start)
        assertEquals(5L, selection.end)
        assertEquals("证据", selection.quote)
        assertFalse(
            MaterialAnnotationDraft(selection, kind = "researcher_reflection", note = "观察").ready
        )
        assertTrue(
            MaterialAnnotationDraft(
                    selection,
                    kind = "researcher_reflection",
                    note = "观察",
                    reflection = "判断",
                )
                .ready
        )
    }

    @Test
    fun `interrupted annotation recreates without auto replay and retries identical key and body`() =
        runTest {
            val api = AnnotationApi()
            val store = MemoryStore()
            val c = MaterialAnnotationController(api, this, store, "owner", "task") {}
            c.select(materialSelection(segment("甲😀乙"), 1, 4)!!)
            c.edit { it.copy(note = "原文材料说明") }
            api.lose = true
            c.save()
            advanceUntilIdle()
            assertTrue(c.state.value.unknown)
            assertEquals(1, api.writes.size)
            c.close()
            val recovered = MaterialAnnotationController(api, this, store, "owner", "task") {}
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertEquals("原文材料说明", recovered.state.value.draft!!.note)
            api.lose = false
            recovered.retry()
            advanceUntilIdle()
            assertEquals(api.writes[0], api.writes[1])
            assertNull(recovered.state.value.draft)
            assertFalse(recovered.state.value.unknown)
            recovered.close()
        }

    @Test
    fun `late typed reflection is retained after older annotation succeeds and owners do not share it`() =
        runTest {
            val api = AnnotationApi()
            val store = MemoryStore()
            val c = MaterialAnnotationController(api, this, store, "owner", "task") {}
            c.select(materialSelection(segment("甲😀乙"), 1, 4)!!)
            c.edit { it.copy(note = "观察") }
            val pause = CompletableDeferred<Unit>()
            api.pause = pause
            c.save()
            runCurrent()
            assertTrue(c.state.value.busy)
            c.edit { it.copy(reflection = "等待时补充的判断") }
            pause.complete(Unit)
            advanceUntilIdle()
            assertEquals("等待时补充的判断", c.state.value.draft!!.reflection)
            assertFalse(c.state.value.unknown)
            assertNotNull(c.state.value.saved)
            val other = MaterialAnnotationController(api, this, store, "other-owner", "task") {}
            assertNull(other.state.value.draft)
            assertEquals(1, api.writes.size)
            other.close()
            c.close()
        }
}

private class AnnotationApi :
    EverplainApi(Endpoint.parse("https://annotation-fixture.example.invalid"), MemoryStore()) {
    val writes = mutableListOf<Pair<String?, String>>()
    var lose = false
    var pause: CompletableDeferred<Unit>? = null

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        check(path == "/api/research-tasks/task/analysis/annotations" && method == "POST")
        writes += key to body!!
        pause?.also { pause = null }?.await()
        if (lose) throw IOException("Synthetic interrupted annotation")
        val b = WireJson.decodeFromString<CreateAnalysisAnnotationRequest>(body)
        val response =
            AnalysisAnnotationResponse(
                annotationId = "annotation",
                annotationKind = b.annotationKind,
                caseLabel = b.caseLabel,
                createdAt = "",
                locator = ResearchMaterialLocatorResponse(sectionPath = emptyList()),
                materialId = b.materialId,
                note = b.note,
                observedAt = b.observedAt,
                parseId = b.parseId,
                quote = "😀乙",
                quoteEnd = b.quoteEnd,
                quoteHash = "a".repeat(64),
                quoteStart = b.quoteStart,
                reflection = b.reflection,
                segmentContentHash = "b".repeat(64),
                segmentId = b.segmentId,
                sourceAvailable = true,
                taskId = "task",
            )
        return WireJson.decodeFromString(serializer, WireJson.encodeToString(response))
    }
}
