package app.everplain.android

import android.graphics.Bitmap
import android.widget.TextView
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real frame-clock component playback. Synthetic content only; not a claim of Web pixel diff. */
@RunWith(AndroidJUnit4::class)
class NativeMotionPlaybackTest {
    @Test
    fun liquidAndPacedNativeMarkdownActuallyRenderWithMotionEnabled() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(inst)
        HardwareRendererCompat.setDrawingEnabled(true)
        inst.uiAutomation.executeShellCommand("settings put global animator_duration_scale 1").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
        val dir =
            File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply { mkdirs() }
        fun capture(name: String): Bitmap {
            val bitmap = takeScreenshot()
            File(dir, "android-synthetic-$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            return bitmap
        }
        var answer by mutableStateOf("")
        var streaming by mutableStateOf(true)
        val complete =
            "这是 **逐字显现** 的合成验收。😀 中文与 emoji 不拆开。\n\n`native code` 与 [引用](https://example.invalid) 都是测试文字。"
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.setContent {
                    EverplainTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.fillMaxWidth().safeDrawingPadding().padding(20.dp),
                                verticalArrangement = Arrangement.spacedBy(20.dp),
                            ) {
                                Text("合成动效验收", Modifier.semantics { contentDescription = "合成动效验收" })
                                AgentLiquid()
                                val view = rememberPacedText(answer, streaming)
                                ThinkingStatus(streaming && view.visible.isEmpty(), "正在核对合成来源")
                                if (view.visible.isNotEmpty())
                                    NativeMarkdown(
                                        view.visible,
                                        revealedAt = view.revealedAt,
                                        revealColor = "#5d8fe6",
                                    )
                            }
                        }
                    }
                }
            }
            assertTrue(device.wait(Until.hasObject(By.desc("合成动效验收")), 60000))
            Thread.sleep(500)
            val first = capture("motion-liquid-a")
            Thread.sleep(760)
            val second = capture("motion-liquid-b")
            assertFalse("Authentic Liquid contour must animate", first.sameAs(second))
            scenario.onActivity { answer = complete }
            Thread.sleep(350)
            capture("motion-stream-early")
            scenario.onActivity { streaming = false }
            val until = System.currentTimeMillis() + 30000
            var content = ""
            while (System.currentTimeMillis() < until) {
                scenario.onActivity { activity ->
                    fun texts(v: android.view.View): List<TextView> =
                        when (v) {
                            is TextView -> listOf(v)
                            is android.view.ViewGroup ->
                                (0 until v.childCount).flatMap { texts(v.getChildAt(it)) }
                            else -> emptyList()
                        }
                    content =
                        texts(activity.window.decorView).joinToString("\n") { it.text.toString() }
                }
                if (content.contains("都是测试文字。")) break
                Thread.sleep(100)
            }
            assertTrue("Completion drains paced backlog", content.contains("都是测试文字。"))
            assertTrue(content.contains("😀"))
            assertFalse(content.contains("**"))
            Thread.sleep(1200)
            capture("motion-stream-settled")
            assertEquals(complete, answer) // Display pacing never mutates the authoritative answer.
        }
        inst.uiAutomation.executeShellCommand("settings put global animator_duration_scale 0").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
    }
}
