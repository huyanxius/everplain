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
import androidx.test.uiautomator.*
import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeMaterialAnnotationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun sourceSelectionCreatesTheExactTypedAnnotationAndKeepsNativeKeyboardUsable() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        val device = UiDevice.getInstance(inst)
        val segment =
            ResearchMaterialSegmentResponse(
                "paragraph",
                ResearchMaterialLocatorResponse(page = 1, sectionPath = emptyList()),
                "material",
                0,
                "parse-1",
                "segment-1",
                "甲😀乙，照护安排形成了新的分工。",
            )
        val api = AnnotationDeviceApi(segment)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val c =
            MaterialAnnotationController(api, scope, MemoryStore(), "synthetic-owner", "task") {
                error("Unexpected auth")
            }
        try {
            compose.runOnUiThread {
                compose.activity.setContent {
                    EverplainTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp)) {
                                Text("合成材料标记验收", Modifier.padding(bottom = 28.dp))
                                NativeMaterialPassage(segment, c::select)
                                val state by c.state.collectAsState()
                                if (state.saved != null) Text("片段标记已保存。")
                            }
                        }
                        MaterialAnnotationDrawer(c)
                    }
                }
            }
            compose.waitForIdle()
            val source =
                device.wait(Until.findObject(By.text(segment.text)), 10000)
                    ?: error("Native source TextView unavailable")
            source.longClick()
            var mark = device.wait(Until.findObject(By.text("标记片段")), 3000)
            if (mark == null) {
                device.findObject(By.desc("More options"))?.click()
                mark = device.wait(Until.findObject(By.text("标记片段")), 3000)
            }
            checkNotNull(mark) { "Native selection menu did not expose the annotation action" }
                .click()
            compose.waitUntil(10000) { c.state.value.open }
            val selected = checkNotNull(c.state.value.draft).selection
            assertEquals(
                segment.text.substring(
                    segment.text.offsetByCodePoints(0, selected.start.toInt()),
                    segment.text.offsetByCodePoints(0, selected.end.toInt()),
                ),
                selected.quote,
            )
            compose
                .onNodeWithContentDescription("材料描述")
                .performScrollTo()
                .performTextInput("这里记录研究观察")
            compose
                .onNodeWithContentDescription("研究者反思")
                .performScrollTo()
                .performTextInput("保留对材料解释的警觉")
            fun capture(name: String) {
                compose.waitForIdle()
                Thread.sleep(300)
                val bitmap = inst.uiAutomation.takeScreenshot() ?: error("No framebuffer")
                val dir =
                    File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply {
                        mkdirs()
                    }
                File(dir, "android-synthetic-material-annotation-$name.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                bitmap.recycle()
            }
            capture("keyboard")
            compose.onNodeWithText("保存片段标记").performScrollTo().performClick()
            compose.waitUntil(10000) { !c.state.value.busy && c.state.value.saved != null }
            assertNull(c.state.value.error)
            assertEquals(1, api.writes)
            assertEquals(selected.start, api.request!!.quoteStart)
            assertEquals(selected.end, api.request!!.quoteEnd)
            assertEquals("parse-1", api.request!!.parseId)
            assertEquals("这里记录研究观察", api.request!!.note)
            assertEquals("保留对材料解释的警觉", api.request!!.reflection)
            capture("saved")
        } finally {
            compose.runOnUiThread {
                compose.activity.setContent {}
                c.close()
                scope.cancel()
            }
        }
    }
}

private class AnnotationDeviceApi(private val segment: ResearchMaterialSegmentResponse) :
    EverplainApi(Endpoint.parse("https://annotation-fixture.example.invalid"), MemoryStore()) {
    var writes = 0
    var request: CreateAnalysisAnnotationRequest? = null

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        check(
            path == "/api/research-tasks/task/analysis/annotations" &&
                method == "POST" &&
                key != null
        )
        val b = WireJson.decodeFromString<CreateAnalysisAnnotationRequest>(body!!)
        request = b
        writes++
        val quote =
            segment.text.substring(
                segment.text.offsetByCodePoints(0, b.quoteStart.toInt()),
                segment.text.offsetByCodePoints(0, b.quoteEnd.toInt()),
            )
        val response =
            AnalysisAnnotationResponse(
                annotationId = "annotation",
                annotationKind = b.annotationKind,
                caseLabel = b.caseLabel,
                createdAt = "",
                locator = segment.locator,
                materialId = b.materialId,
                note = b.note,
                observedAt = b.observedAt,
                parseId = b.parseId,
                quote = quote,
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
