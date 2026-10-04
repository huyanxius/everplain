package app.everplain.android

import android.graphics.Bitmap
import android.widget.TextView
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real frame-clock component playback. Test APK only; no Web pixel-diff claim. */
@RunWith(AndroidJUnit4::class)
class NativeMotionPlaybackTest {
    private fun shell(command: String): String {
        val fd =
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return android.os.ParcelFileDescriptor.AutoCloseInputStream(fd).use {
            it.bufferedReader().readText()
        }
    }

    private fun withMotion(test: () -> Unit) {
        val original =
            shell("settings get global animator_duration_scale").trim().takeIf {
                it.toFloatOrNull() != null
            } ?: "0"
        HardwareRendererCompat.setDrawingEnabled(true)
        shell("settings put global animator_duration_scale 1")
        try {
            test()
        } finally {
            shell("settings put global animator_duration_scale $original")
        }
    }

    private fun capture(name: String): Bitmap {
        val inst = InstrumentationRegistry.getInstrumentation()
        val dir =
            File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply { mkdirs() }
        val bitmap = takeScreenshot()
        File(dir, "android-synthetic-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        android.util.Log.i("EverplainMotionQA", "Captured $name")
        return bitmap
    }

    @Test(timeout = 60000)
    fun liquidActuallyRendersDifferentSourceFrames() = withMotion {
        val ready = CountDownLatch(1)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.setContent {
                    EverplainTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.fillMaxWidth().safeDrawingPadding().padding(20.dp),
                                verticalArrangement = Arrangement.spacedBy(20.dp),
                            ) {
                                Text("合成动效验收 · Liquid")
                                AgentLiquid()
                                LaunchedEffect(Unit) { ready.countDown() }
                            }
                        }
                    }
                }
            }
            // Never ask UiAutomator to wait for accessibility idleness during an infinite
            // animation.
            assertTrue("Native composition started", ready.await(20, TimeUnit.SECONDS))
            Thread.sleep(500)
            val first = capture("motion-liquid-a")
            Thread.sleep(760)
            val second = capture("motion-liquid-b")
            try {
                assertFalse("Authentic Liquid contour must animate", first.sameAs(second))
            } finally {
                first.recycle()
                second.recycle()
            }
        }
    }

    @Test(timeout = 60000)
    fun pacedNativeMarkdownDrainsAfterTerminalSignal() = withMotion {
        val ready = CountDownLatch(1)
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
                                Text("合成动效验收 · Markdown")
                                val view = rememberPacedText(answer, streaming)
                                ThinkingStatus(streaming && view.visible.isEmpty(), "正在核对合成来源")
                                if (view.visible.isNotEmpty())
                                    NativeMarkdown(
                                        view.visible,
                                        revealedAt = view.revealedAt,
                                        revealColor = "#5d8fe6",
                                    )
                                LaunchedEffect(Unit) { ready.countDown() }
                            }
                        }
                    }
                }
            }
            assertTrue("Native composition started", ready.await(20, TimeUnit.SECONDS))
            scenario.onActivity { answer = complete }
            Thread.sleep(350)
            capture("motion-stream-early").recycle()
            scenario.onActivity { streaming = false }
            val until = System.currentTimeMillis() + 30000
            var content = ""
            while (System.currentTimeMillis() < until) {
                scenario.onActivity { activity ->
                    fun texts(view: android.view.View): List<TextView> =
                        when (view) {
                            is TextView -> listOf(view)
                            is android.view.ViewGroup ->
                                (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
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
            capture("motion-stream-settled").recycle()
            assertEquals(complete, answer)
        }
    }
}
