package app.everplain.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.flow.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android test APK only. All module reads and continuation responses are in-process synthetic data.
 */
@RunWith(AndroidJUnit4::class)
class NativeExpandedFeatureTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun realNativeLibraryGraphFilesAndResearchContinuation() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        inst.uiAutomation.executeShellCommand("settings put global animator_duration_scale 0").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
        val wire =
            inst.context.assets.open("codec.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val session =
            WireJson.decodeFromJsonElement<SessionResponse>(wire.getValue("SessionResponse"))
        val profile =
            WireJson.decodeFromJsonElement<AgentProfileResponse>(
                    wire.getValue("AgentProfileResponse")
                )
                .copy(name = "澄", avatarId = "cheng", color = "#5d8fe6")
        val catalog =
            WireJson.decodeFromJsonElement<AgentModelCatalogResponse>(
                    wire.getValue("AgentModelCatalogResponse")
                )
                .let { c -> c.copy(items = c.items.map { it.copy(label = "测试模型") }) }
        val conversation =
            WireJson.decodeFromJsonElement<AgentConversationResponse>(
                wire.getValue("AgentConversationResponse")
            )
        val api = ExpandedApi(session, conversation)
        lateinit var vm: AppViewModel
        lateinit var mutable: MutableStateFlow<AppState>
        compose.runOnUiThread {
            EncryptedStore(compose.activity).clear()
            vm = ViewModelProvider(compose.activity)[AppViewModel::class.java]
            AppViewModel::class
                .java
                .getDeclaredField("api")
                .apply { isAccessible = true }
                .set(vm, api)
            AppViewModel::class
                .java
                .getDeclaredField("sessionOwner")
                .apply { isAccessible = true }
                .set(vm, session.user.userId)
            @Suppress("UNCHECKED_CAST")
            val data =
                AppViewModel::class
                    .java
                    .getDeclaredField("mutable")
                    .apply { isAccessible = true }
                    .get(vm) as MutableStateFlow<AppState>
            mutable = data
            data.value =
                AppState(
                    starting = false,
                    session = session,
                    profile = profile,
                    catalog = catalog,
                    model = catalog.items.first().modelId,
                    effort = catalog.items.first().defaultReasoningEffort,
                    destination = Destination.Library,
                )
        }
        fun capture(name: String) {
            compose.waitForIdle()
            Thread.sleep(500)
            val dir =
                File(compose.activity.getExternalFilesDir(null), "visual-fixtures").apply {
                    mkdirs()
                }
            File(dir, "android-synthetic-$name.png").outputStream().use { stream ->
                val bitmap = takeScreenshot()
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
                bitmap.recycle()
            }
        }
        compose.waitUntil(30000) { !vm.library().state.value.loading }
        compose.onNodeWithText("读书笔记.md").assertExists()
        capture("library-cards")
        compose.onNodeWithText("读书笔记.md").performClick()
        compose.waitUntil(30000) { vm.library().state.value.source != null }
        capture("library-source")
        compose.onNodeWithContentDescription("关闭读书笔记.md").performClick()
        compose.runOnUiThread { vm.navigate(Destination.Graph) }
        compose.waitUntil(30000) { vm.graph().state.value.graph != null }
        compose.onNodeWithContentDescription("节点式知识图谱，3 个节点，2 个关系").assertExists()
        capture("personal-graph")
        compose.onAllNodesWithText("知识点", useUnmergedTree = true).onFirst().performClick()
        compose.waitForIdle()
        capture("knowledge-points")
        compose.runOnUiThread { vm.navigate(Destination.Files) }
        compose.waitUntil(30000) {
            !vm.materials().state.value.loading && vm.materials().state.value.available.isNotEmpty()
        }
        compose.onNodeWithText("访谈记录.txt").assertExists()
        capture("files")
        compose.onNodeWithText("访谈记录.txt").performClick()
        compose.waitUntil(30000) {
            !vm.materials().state.value.reading && vm.materials().state.value.selected != null
        }
        capture("file-source")
        compose.onNodeWithContentDescription("关闭访谈记录.txt").performClick()
        compose.runOnUiThread {
            vm.newChat()
            mutable.value =
                mutable.value.copy(
                    composerMode = "deep_research",
                    pending =
                        PendingTurn(
                            session.user.userId,
                            "synthetic-research-intent",
                            AgentTurnRequest(
                                message = "比较两种研究解释",
                                mode = "deep_research",
                                workspace = "agent",
                                modelId = catalog.items.first().modelId,
                                reasoningEffort = catalog.items.first().defaultReasoningEffort,
                            ),
                            runId = "synthetic-run",
                            conversationId = conversation.conversationId,
                            outcomeConfirmed = true,
                            origin = api.endpoint.origin,
                            signals =
                                NativeTurnSignals(
                                    research =
                                        NativeResearchProgress(
                                            "planning",
                                            "比较两种研究解释",
                                            listOf("阅读提供的合成材料", "对照证据与限制"),
                                            waitingState = "awaiting_plan_confirmation",
                                        )
                                ),
                        ),
                )
        }
        compose.onNodeWithText("开始深入研究").assertExists()
        capture("research-plan")
        compose.onNodeWithText("开始深入研究").performClick()
        compose.waitUntil(30000) { api.requests.size == 1 && !vm.state.value.streaming }
        assertEquals("confirm", api.requests.single().second.deepResearchAction)
        assertEquals("synthetic-run", api.requests.single().second.deepResearchRunId)
        assertEquals("synthetic-research-intent", api.requests.single().first)
        assertEquals(0, api.productionRequests)
        capture("research-result")
    }
}

private class ExpandedApi(
    private val session: SessionResponse,
    private val conversation: AgentConversationResponse,
) : EverplainApi(Endpoint.parse("https://expanded-fixture.example.invalid"), MemoryStore()) {
    val requests = java.util.concurrent.CopyOnWriteArrayList<Pair<String, AgentTurnRequest>>()
    val productionRequests = 0
    private val document =
        SharedDocumentResponse(
            createdAt = "2026-10-04T00:00:00Z",
            filename = "读书笔记.md",
            id = "doc",
            indexStatus = "ready",
            knowledge =
                CourseKnowledgeResponse(
                    summary = "这份合成资料用于核对原生资料卡片、知识点和原文阅读。",
                    topics =
                        listOf(CourseTopicResponse(listOf("seg"), "不同解释需要回到材料，区分观察与推断。", "解释与证据")),
                ),
            knowledgeStatus = "ready",
            mediaType = "text/markdown",
            parseId = "parse",
            sizeBytes = 1240,
            status = "ready",
        )
    private val library =
        SharedKnowledgeResponse(
            documents = listOf(document),
            id = "kb",
            name = "阅读与方法",
            readyDocumentCount = 1,
            viewerAccess = "owner",
        )
    private val material =
        ResearchMaterialResponse(
            displayName = "访谈记录",
            filename = "访谈记录.txt",
            isCurrentParse = true,
            materialFormat = "text",
            materialId = "material",
            materialKind = "interview_transcript",
            mediaType = "text/plain",
            parseId = "parse",
            parseVersion = 1,
            segmentCount = 1,
            segments =
                listOf(
                    ResearchMaterialSegmentResponse(
                        "text",
                        ResearchMaterialLocatorResponse(sectionPath = emptyList()),
                        "material",
                        0,
                        "parse",
                        "seg",
                        "这是合成访谈段落，仅用于核对原生材料阅读与来源定位。",
                    )
                ),
            sizeBytes = 2400,
            status = "ready",
            taskId = "task",
            updatedAt = "2026-10-04T00:00:00Z",
            version = 1,
        )

    override suspend fun session() = session

    override suspend fun history() = emptyList<AgentConversationSummaryResponse>()

    override fun stream(request: AgentTurnRequest, key: String): Flow<SseFrame> = flow {
        requests += key to request
        emit(
            SseFrame(
                "turn_started",
                """{"run_id":"synthetic-run","conversation_id":"${conversation.conversationId}"}""",
            )
        )
        emit(
            SseFrame(
                "research_result",
                """{"summary":"这是合成研究结论。两种解释都需要原文证据，并保留适用范围。","knowledge_count":1,"web_count":0}""",
            )
        )
        val turn =
            conversation.turns.first().let {
                it.copy(
                    user = it.user.copy(content = request.message),
                    assistant = it.assistant.copy(content = "这是合成研究结论。两种解释都需要原文证据，并保留适用范围。"),
                )
            }
        emit(
            SseFrame(
                "turn_completed",
                buildJsonObject {
                        put(
                            "conversation",
                            WireJson.encodeToJsonElement(conversation.copy(turns = listOf(turn))),
                        )
                    }
                    .toString(),
            )
        )
    }

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        check(method == "GET") { "Unexpected mutation $path" }
        val json =
            when (path) {
                "/api/shared-knowledge-bases" ->
                    WireJson.encodeToString(SharedKnowledgeListResponse(listOf(library)))
                "/api/shared-knowledge-bases/kb" -> WireJson.encodeToString(library)
                "/api/shared-knowledge-bases/kb/documents/doc/source" ->
                    WireJson.encodeToString(
                        SharedDocumentSourceResponse(
                            document,
                            "kb",
                            "阅读与方法",
                            listOf(
                                SharedSourceSegmentResponse(
                                    "text",
                                    ResearchMaterialLocatorResponse(sectionPath = emptyList()),
                                    0,
                                    "parse",
                                    "seg",
                                    "这是合成原文。知识点与解释应由这一段实际提供的来源支持。",
                                )
                            ),
                        )
                    )
                "/api/knowledge-storage" ->
                    WireJson.encodeToString(
                        KnowledgeStorageResponse(1, 10000000, 1000000, 100, 20000000, 10, 3640)
                    )
                "/api/imports" -> WireJson.encodeToString(ImportBatchListResponse(emptyList()))
                "/api/agent/materials" ->
                    WireJson.encodeToString(AgentMaterialListResponse(listOf(material)))
                "/api/research-tasks/task/materials/material" -> WireJson.encodeToString(material)
                "/api/personal-graph" ->
                    WireJson.encodeToString(
                        PersonalGraphResponse(
                            "cheng",
                            "#5d8fe6",
                            1,
                            listOf(
                                PersonalGraphEdge(
                                    "e1",
                                    "directed",
                                    "structure",
                                    "主题",
                                    "self",
                                    "topic",
                                ),
                                PersonalGraphEdge(
                                    "e2",
                                    "directed",
                                    "structure",
                                    "资料",
                                    "topic",
                                    "document",
                                ),
                            ),
                            "semantic",
                            "澄",
                            listOf(
                                PersonalGraphNode("self", "我", 0, "self"),
                                PersonalGraphNode("topic", "研究方法", 1, "topic"),
                                PersonalGraphNode("document", "读书笔记", 2, "document"),
                            ),
                            0,
                            "synthetic",
                            mapOf(
                                "document" to
                                    PersonalGraphSource(
                                        documentId = "doc",
                                        libraryId = "kb",
                                        title = "读书笔记",
                                    )
                            ),
                            1,
                        )
                    )
                else -> error("Unexpected read $path")
            }
        return WireJson.decodeFromString(serializer, json)
    }
}
