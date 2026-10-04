package app.everplain.android

import android.graphics.Bitmap
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Isolated production Compose tools, synthetic transport only; project navigation is not claimed.
 */
@RunWith(AndroidJUnit4::class)
class NativeResearchToolsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun methodAnalysisTheoryAndArchiveUseNativeControlsAndTypedRequests() {
        val inst = InstrumentationRegistry.getInstrumentation()
        fun shell(command: String): String =
            inst.uiAutomation.executeShellCommand(command).let {
                android.os.ParcelFileDescriptor.AutoCloseInputStream(it).use { input ->
                    input.bufferedReader().readText()
                }
            }
        val oldScale =
            shell("settings get global animator_duration_scale").trim().takeIf {
                it.toFloatOrNull() != null
            } ?: "0"
        shell("settings put global animator_duration_scale 0")
        HardwareRendererCompat.setDrawingEnabled(true)
        val wire =
            inst.context.assets.open("research-workspace-fixtures.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val api = ResearchToolsDeviceApi(wire)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val store = MemoryStore()
        val method =
            MethodPlanController(api, scope, store, "synthetic-owner", "task") {
                error("Unexpected auth")
            }
        val analysis =
            ResearchAnalysisController(api, scope, store, "synthetic-owner", "task") {
                error("Unexpected auth")
            }
        val archive =
            ResearchArchiveController(api, scope, store, "synthetic-owner", "task") {
                error("Unexpected auth")
            }
        val theory =
            TheoryController(api, scope, store, "synthetic-owner", "task") {
                error("Unexpected auth")
            }
        val tool = mutableStateOf("方法")
        val editorDraft = mutableStateOf("研究😀与**证据**，以及第二段分析。")
        try {
            compose.runOnUiThread {
                compose.activity.setContent {
                    EverplainTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                                Text("合成研究工具验收", Modifier.padding(12.dp))
                                Row {
                                    listOf("方法", "分析", "理论", "归档", "编辑").forEach { label ->
                                        EpButton(
                                            label,
                                            { tool.value = label },
                                            selected = tool.value == label,
                                        )
                                    }
                                }
                                Box(Modifier.weight(1f)) {
                                    when (tool.value) {
                                        "方法" -> MethodPlanScreen(method)
                                        "分析" -> ResearchAnalysisScreen(analysis)
                                        "理论" ->
                                            androidx.compose.foundation.lazy.LazyColumn(
                                                contentPadding = PaddingValues(16.dp)
                                            ) {
                                                item { TheoryCandidates(theory) }
                                            }
                                        "归档" -> ResearchArchiveScreen(archive)
                                        else ->
                                            Column(Modifier.padding(16.dp)) {
                                                Text(
                                                    "原生文稿编辑",
                                                    style = MaterialTheme.typography.headlineSmall,
                                                )
                                                NativeDocumentEditor(
                                                    "synthetic-document:section",
                                                    editorDraft.value,
                                                    { editorDraft.value = it },
                                                )
                                            }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            fun capture(name: String) {
                compose.waitForIdle()
                Thread.sleep(350)
                val bitmap = inst.uiAutomation.takeScreenshot() ?: error("No framebuffer")
                val dir =
                    File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply {
                        mkdirs()
                    }
                File(dir, "android-synthetic-research-tool-$name.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                bitmap.recycle()
            }
            compose.waitUntil(30000) { !method.state.value.loading }
            assertNull(method.state.value.error)
            compose.onNodeWithText("方法设计").assertIsDisplayed()
            compose
                .onNodeWithContentDescription("方法理由")
                .performScrollTo()
                .performTextReplacement("合成研究方法理由")
            compose.onNodeWithText("保存新版本").performScrollTo().performClick()
            compose.waitUntil(30000) { api.methodWrites == 1 && !method.state.value.busy }
            assertEquals("合成研究方法理由", method.state.value.plan!!.rationale)
            compose.onNodeWithText("方法设计").performScrollTo()
            capture("method")

            compose.onNodeWithText("分析", useUnmergedTree = true).performClick()
            compose.waitUntil(30000) { !analysis.state.value.loading }
            assertNull(analysis.state.value.error)
            compose.onNodeWithText("写分析备忘").performClick()
            compose.onNodeWithContentDescription("备忘标题").performScrollTo().performTextInput("观察与判断")
            compose
                .onNodeWithContentDescription("备忘内容")
                .performScrollTo()
                .performTextInput("这是一份合成分析备忘，仅用于原生输入和保存验收。")
            compose.onNodeWithText("保存备忘").performScrollTo().performClick()
            compose.waitUntil(30000) { api.memoWrites == 1 && !analysis.state.value.busy }
            assertEquals("观察与判断", analysis.state.value.snapshot!!.memos.single().title)
            compose.onNodeWithText("研究分析").performScrollTo()
            capture("analysis")

            compose.onNodeWithText("理论", useUnmergedTree = true).performClick()
            compose.waitUntil(30000) { !theory.state.value.loading }
            assertNull(theory.state.value.error)
            compose.onNodeWithText("候选理论").assertIsDisplayed()
            compose.onAllNodesWithText("采用").onFirst().performScrollTo().performClick()
            assertEquals("adopt", theory.state.value.draft.choices["c1"]?.action)
            capture("theory")

            compose.onNodeWithText("归档", useUnmergedTree = true).performClick()
            compose.waitUntil(30000) { !archive.state.value.loading }
            assertNull(archive.state.value.error)
            compose.onNodeWithText("导出研究归档").assertIsDisplayed()
            compose.onNodeWithText("还没有项目交换记录。").performScrollTo().assertIsDisplayed()
            capture("archive")
            compose.onNodeWithText("编辑", useUnmergedTree = true).performClick()
            compose.onNodeWithContentDescription("研究文档正文").performClick().performTextInput("补充判断")
            compose.waitUntil(30000) { editorDraft.value.contains("补充判断") }
            assertTrue(editorDraft.value.contains("研究😀"))
            capture("native-rich-editor")
            assertEquals(2, api.writes)
        } finally {
            compose.runOnUiThread {
                compose.activity.setContent {}
                method.close()
                analysis.close()
                archive.close()
                theory.close()
                scope.cancel()
            }
            shell("settings put global animator_duration_scale $oldScale")
        }
    }
}

private class ResearchToolsDeviceApi(private val wire: JsonObject) :
    NativeFixtureApi(Endpoint.parse("https://research-tools.example.invalid"), MemoryStore()) {
    var methodWrites = 0
    var memoWrites = 0
    var writes = 0
    var method =
        WireJson.decodeFromJsonElement<MethodPlanResponse>(wire.getValue("MethodPlanResponse"))
            .copy(
                taskId = "task",
                planId = "plan",
                methodKind = "undecided",
                status = "draft",
                researchQuestion = "如何记录研究者的观察？",
                rationale = "从当前材料开始",
                sections = listOf(MethodPlanSectionContract("先补充材料", "decision", "system", "路径判断")),
            )

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        if (method != "GET") writes++
        val result =
            when {
                method == "PATCH" && path == "/api/method-plans/plan" -> {
                    val request = WireJson.decodeFromString<UpdateMethodPlanRequest>(body!!)
                    check(request.expectedVersion == this.method.version && key != null)
                    this.method =
                        this.method.copy(
                            version = this.method.version + 1,
                            rationale = request.rationale,
                            sections = request.sections,
                        )
                    methodWrites++
                    WireJson.encodeToString(this.method)
                }
                method == "POST" && path.endsWith("/analysis/memos") -> {
                    val request = WireJson.decodeFromString<CreateAnalysisMemoRequest>(body!!)
                    check(key != null)
                    memoWrites++
                    WireJson.encodeToString(
                        AnalysisMemoResponse(
                            annotationIds = emptyList(),
                            content = request.content,
                            createdAt = "",
                            memoId = "memo",
                            memoKind = request.memoKind,
                            source = "user",
                            status = "confirmed",
                            taskId = "task",
                            title = request.title,
                            version = 1,
                        )
                    )
                }
                method != "GET" -> error("Unexpected synthetic write $method $path")
                path.endsWith("/method-plans/current") -> WireJson.encodeToString(this.method)
                path.endsWith("/versions") ->
                    WireJson.encodeToString(
                        MethodPlanVersionListResponse(listOf(this.method), this.method.planId)
                    )
                path.endsWith("/analysis") ->
                    WireJson.encodeToString(
                        ResearchAnalysisSnapshotResponse(
                            emptyList(),
                            emptyList(),
                            emptyList(),
                            "task",
                        )
                    )
                path.endsWith("/materials") ->
                    WireJson.encodeToString(ResearchMaterialListResponse(emptyList(), "task"))
                path.endsWith("/cycle") -> wire.getValue("ResearchCycleResponse").toString()
                path.endsWith("/navigation") ->
                    wire.getValue("ResearchTaskNavigationResponse").toString()
                path.endsWith("/run") -> wire.getValue("MatchRunResponse").toString()
                path.endsWith("/decisions") ->
                    WireJson.encodeToString(
                        TheoryDecisionPageResponse(
                            emptyList(),
                            emptyList(),
                            "release",
                            "run",
                            version = 1,
                        )
                    )
                path.endsWith("/exchange/audit") ->
                    WireJson.encodeToString(ResearchAuditEventListResponse(emptyList(), "task"))
                else -> error("Unexpected synthetic read $path")
            }
        return WireJson.decodeFromString(serializer, result)
    }
}
