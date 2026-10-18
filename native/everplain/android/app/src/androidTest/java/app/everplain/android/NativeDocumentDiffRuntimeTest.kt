package app.everplain.android

import android.graphics.Bitmap
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import java.io.File
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Actual isolated Android JavaScript calculation with synthetic strings, no UI or network. */
@RunWith(AndroidJUnit4::class)
class NativeDocumentDiffRuntimeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun exactWebChineseAndEnglishRichTextGoldens() =
        runBlocking<Unit> {
            assertEquals(
                listOf(
                    NativeDiffPart("unchanged", "迁移后的照护主要由"),
                    NativeDiffPart("deleted", "母亲"),
                    NativeDiffPart("inserted", "祖辈"),
                    NativeDiffPart("unchanged", "承担"),
                    NativeDiffPart("inserted", "，并依赖邻里互助"),
                    NativeDiffPart("unchanged", "。"),
                ),
                NativeDocumentDiff.compute(
                    context,
                    "迁移后的照护主要由**母亲**承担。",
                    "迁移后的照护主要由**祖辈**承担，并依赖邻里互助。",
                ),
            )
            val english =
                NativeDocumentDiff.compute(
                    context,
                    "## Findings\n\n- Grandparents provide daily care.\n- Mothers coordinate remotely.",
                    "## Findings\n\n- Grandparents provide daily care.\n- Parents coordinate remotely.",
                )
            assertEquals(
                listOf(NativeDiffPart("deleted", "Mothers"), NativeDiffPart("inserted", "Parents")),
                english.filter { it.kind != "unchanged" },
            )
        }

    @Test
    fun nativeDifferenceRendersWholeEmojiAndLocalChineseChanges() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        compose.runOnUiThread {
            compose.activity.setContent {
                EverplainTheme {
                    Surface(Modifier.fillMaxSize()) {
                        Column(
                            Modifier.safeDrawingPadding().padding(24.dp),
                            verticalArrangement = Arrangement.spacedBy(28.dp),
                        ) {
                            Text("合成文稿差异验收")
                            Text("Agent 修订建议", style = MaterialTheme.typography.headlineSmall)
                            NativeDocumentDifference(
                                LocalContext.current,
                                "迁移后的照护主要由**母亲**承担。",
                                "迁移后的照护主要由**祖辈**承担，并依赖邻里互助。",
                            )
                            NativeDocumentDifference(LocalContext.current, "😀", "😃")
                        }
                    }
                }
            }
        }
        compose.waitUntil(30000) {
            compose.onAllNodesWithText("😀😃").fetchSemanticsNodes().size == 1
        }
        compose.onNodeWithText("😀😃").assertIsDisplayed()
        compose.onNodeWithText("迁移后的照护主要由母亲祖辈承担，并依赖邻里互助。").assertIsDisplayed()
        compose.waitForIdle()
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("No native framebuffer")
        val dir =
            File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply { mkdirs() }
        File(dir, "android-synthetic-document-diff.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    @Test
    fun namedUtf8DataKeepsEmojiAndNeverEvaluatesDocumentContent() =
        runBlocking<Unit> {
            val payload = "研究😀与\\'\";throw new Error('injected');\\n后续中文"
            val result = NativeDocumentDiff.compute(context, payload, payload)
            assertEquals(1, result.size)
            assertEquals("unchanged", result.single().kind)
            assertTrue(result.single().text.contains("研究😀"))
            assertTrue(result.single().text.contains("throw new Error"))
            assertTrue(result.single().text.contains("后续中文"))
        }

    @Test
    fun cancellationReleasesConnectionBeforeAnotherCalculation() =
        runBlocking<Unit> {
            val interrupted =
                launch(Dispatchers.Default) {
                    NativeDocumentDiff.compute(context, "前文".repeat(40000), "后文".repeat(40000))
                }
            delay(10)
            interrupted.cancelAndJoin()
            assertEquals(
                listOf(NativeDiffPart("unchanged", "可以继续计算")),
                NativeDocumentDiff.compute(context, "可以继续计算", "可以继续计算"),
            )
        }
}
