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
class ResearchDocumentControllerTest {
    @Test
    fun `user edits autosave after 900ms and definitive failure never creates a retry loop`() =
        runTest {
            val api = DocumentApi()
            val c =
                ResearchDocumentController(
                    api,
                    this,
                    MemoryStore(),
                    "owner",
                    "task",
                    "framework",
                ) {}
            c.load()
            advanceUntilIdle()
            assertTrue(api.writes.isEmpty())
            c.edit("question", "我的新判断")
            advanceTimeBy(899)
            runCurrent()
            assertTrue(api.writes.isEmpty())
            advanceTimeBy(1)
            runCurrent()
            advanceUntilIdle()
            assertEquals("我的新判断", api.document.sections.single().content)
            assertFalse(c.state.value.dirty)
            api.definitive = true
            c.edit("question", "服务器暂不接受")
            advanceUntilIdle()
            assertEquals(2, api.writes.size)
            assertTrue(c.state.value.dirty)
            assertFalse(c.state.value.unknown)
            advanceTimeBy(10000)
            runCurrent()
            assertEquals(2, api.writes.size)
            c.close()
        }

    @Test
    fun `typing during a slow save retains latest text and saves a later CAS revision`() = runTest {
        val api = DocumentApi()
        val c =
            ResearchDocumentController(api, this, MemoryStore(), "owner", "task", "framework") {}
        c.load()
        advanceUntilIdle()
        val release = CompletableDeferred<Unit>()
        api.pause = release
        c.edit("question", "第一版")
        advanceTimeBy(900)
        runCurrent()
        assertTrue(c.state.value.busy)
        c.edit("question", "等待时继续输入")
        release.complete(Unit)
        advanceUntilIdle()
        assertEquals(2, api.writes.size)
        val first = WireJson.decodeFromString<UpdateResearchDocumentRequest>(api.writes[0].second)
        val second = WireJson.decodeFromString<UpdateResearchDocumentRequest>(api.writes[1].second)
        assertEquals("第一版", first.sections.single().content)
        assertEquals("等待时继续输入", second.sections.single().content)
        assertEquals(2, second.expectedVersion)
        assertNotEquals(api.writes[0].first, api.writes[1].first)
        assertFalse(c.state.value.dirty)
        c.close()
    }

    @Test
    fun `interrupted manuscript save is durable and recreation never auto replays`() = runTest {
        val api = DocumentApi()
        val store = MemoryStore()
        val c = ResearchDocumentController(api, this, store, "owner", "task", "framework") {}
        c.load()
        advanceUntilIdle()
        api.lose = true
        c.edit("question", "断线前正文")
        advanceUntilIdle()
        assertTrue(c.state.value.unknown)
        c.close()
        val recovered =
            ResearchDocumentController(api, this, store, "owner", "task", "framework") {}
        recovered.load()
        advanceUntilIdle()
        assertEquals(1, api.writes.size)
        assertEquals("断线前正文", recovered.state.value.draft!!.sections.single().content)
        api.lose = false
        recovered.retry()
        advanceUntilIdle()
        assertEquals(api.writes[0], api.writes[1])
        assertFalse(recovered.state.value.unknown)
        recovered.close()
    }

    @Test
    fun `version conflict keeps exact draft and requires explicit rebase`() = runTest {
        val api = DocumentApi()
        val c =
            ResearchDocumentController(api, this, MemoryStore(), "owner", "task", "framework") {}
        c.load()
        advanceUntilIdle()
        api.document = api.document.copy(version = 2)
        c.edit("question", "本机未丢失")
        advanceUntilIdle()
        assertTrue(c.state.value.conflict)
        c.load()
        advanceUntilIdle()
        assertEquals("本机未丢失", c.state.value.draft!!.sections.single().content)
        c.rebase()
        c.save()
        advanceUntilIdle()
        assertEquals(3, api.document.version)
        assertFalse(c.state.value.dirty)
        c.close()
    }
}

private class DocumentApi :
    EverplainApi(Endpoint.parse("https://document-fixture.example.invalid"), MemoryStore()) {
    var document =
        ResearchDocumentResponse(
            actor = "user",
            changeSummary = "合成",
            createdAt = "",
            documentId = "document",
            formatting =
                ResearchDocumentFormattingContract(
                    "china-national-standard-gb-t-7714-2015-author-date",
                    locale = "zh-CN",
                    templateId = "chinese-social-science",
                ),
            knowledgeReleaseId = "release",
            revisionId = "revision",
            sections =
                listOf(
                    ResearchDocumentSectionContract(
                        content = "原文",
                        key = "research_question",
                        sectionId = "question",
                        status = "draft",
                        title = "研究问题",
                    )
                ),
            status = "draft",
            taskId = "task",
            title = "合成文稿",
            version = 1,
        )
    val writes = mutableListOf<Pair<String?, String>>()
    var lose = false
    var definitive = false
    var pause: CompletableDeferred<Unit>? = null

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val value =
            when {
                method == "PATCH" -> {
                    writes += key to body!!
                    pause?.also { pause = null }?.await()
                    if (lose) throw IOException("Synthetic interrupted save")
                    if (definitive)
                        throw ApiFailure(422, "invalid_document", "Synthetic validation error")
                    val b = WireJson.decodeFromString<UpdateResearchDocumentRequest>(body)
                    if (b.expectedVersion != document.version)
                        throw ApiFailure(409, "version_conflict", "Synthetic CAS conflict")
                    document =
                        document.copy(
                            version = document.version + 1,
                            sections = b.sections,
                            formatting = b.formatting ?: document.formatting,
                        )
                    WireJson.encodeToString(document)
                }
                path.endsWith("/navigation") ->
                    """{"adopted_theory_count":0,"allowed_actions":[],"created_at":"","current_stage":"framework","entry_mode":"conversation","entry_type":"phenomenon","next_action_label":"","project_title":"合成","resume_path":"","stage_label":"","status":"active","task_id":"task","updated_at":"","version":1,"current_framework_id":"document"}"""
                path.endsWith("/research-documents") ->
                    WireJson.encodeToString(ResearchDocumentListResponse(listOf(document), "task"))
                path.endsWith("/research-document-proposals") ->
                    WireJson.encodeToString(
                        ResearchTaskDocumentProposalListResponse(emptyList(), "task")
                    )
                path.endsWith("/versions") ->
                    WireJson.encodeToString(
                        ResearchDocumentVersionListResponse("document", listOf(document))
                    )
                path.endsWith("/completion-gate") ->
                    WireJson.encodeToString(
                        ResearchDocumentCompletionGateResponse(
                            emptyList(),
                            emptyList(),
                            "document",
                            0,
                            true,
                            document.version,
                        )
                    )
                else -> error("Unexpected fixture request $method $path")
            }
        return WireJson.decodeFromString(serializer, value)
    }
}
