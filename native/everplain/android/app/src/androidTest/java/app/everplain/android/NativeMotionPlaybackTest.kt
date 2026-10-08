package app.everplain.android

import android.graphics.Bitmap
import android.widget.TextView
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
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

    private fun motionScene(content: @Composable () -> Unit, test: (MainActivity) -> Unit) {
        val inst = InstrumentationRegistry.getInstrumentation()
        val original =
            shell("settings get global animator_duration_scale").trim().takeIf {
                it.toFloatOrNull() != null
            } ?: "0"
        HardwareRendererCompat.setDrawingEnabled(true)
        // ActivityScenario itself waits for UI idleness. Acquire/close the Activity only with
        // motion off.
        shell("settings put global animator_duration_scale 0")
        var activity: MainActivity? = null
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(MainActivity::class.java)
            scenario.onActivity {
                activity = it
                it.setContent {}
            }
            val ready = CountDownLatch(1)
            shell("settings put global animator_duration_scale 1")
            inst.runOnMainSync {
                activity!!.setContent {
                    EverplainTheme {
                        Surface(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.fillMaxWidth().safeDrawingPadding().padding(20.dp),
                                verticalArrangement = Arrangement.spacedBy(20.dp),
                            ) {
                                content()
                                LaunchedEffect(Unit) { ready.countDown() }
                            }
                        }
                    }
                }
            }
            assertTrue("Native composition started", ready.await(20, TimeUnit.SECONDS))
            // This callback must never use ActivityScenario.onActivity: its waitForIdleSync blocks
            // a continuously animated frame clock even when frames are rendering correctly.
            test(activity!!)
        } finally {
            inst.runOnMainSync { activity?.setContent {} }
            shell("settings put global animator_duration_scale $original")
            scenario?.close()
        }
    }

    private fun capture(name: String): Bitmap {
        val inst = InstrumentationRegistry.getInstrumentation()
        val dir =
            File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Framebuffer capture unavailable")
        File(dir, "android-synthetic-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        android.util.Log.i("EverplainMotionQA", "Captured $name")
        return bitmap
    }

    @Test(timeout = 60000)
    fun originalPileKeepsCardsMountedAndUsesStaggeredNativeMotion() {
        val open = mutableStateOf(false)
        val bounds = AtomicReference(Rect.Zero)
        val cardY = Array(3) { AtomicReference(Rect.Zero) }
        val coverMounts = AtomicInteger(0)
        val cardMounts = Array(3) { AtomicInteger(0) }
        val navigated = AtomicInteger(-1)
        motionScene(
            content = {
                Text("合成动效验收 · 首页资料牌堆")
                Box(
                    Modifier.fillMaxWidth().onGloballyPositioned { bounds.set(it.boundsInRoot()) }
                ) {
                    HomePile(
                        "deck",
                        3,
                        open.value,
                        { open.value = it },
                        navigated::set,
                        cover = {
                            DisposableEffect(Unit) {
                                coverMounts.incrementAndGet()
                                onDispose {}
                            }
                            Text("3 份资料 · 2 个主题")
                            Text("阅读札记与研究材料")
                        },
                    ) { index, _ ->
                        DisposableEffect(Unit) {
                            cardMounts[index].incrementAndGet()
                            onDispose {}
                        }
                        Text(
                            "合成资料 ${index + 1}",
                            Modifier.onGloballyPositioned { cardY[index].set(it.boundsInRoot()) },
                        )
                        Text("用于核对展开与收起的真实原生帧")
                    }
                }
            }
        ) {
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            Thread.sleep(350)
            val closed = bounds.get()
            val density = it.resources.displayMetrics.density
            assertEquals(152f * density, closed.height, 2f)
            capture("pile-deck-closed").recycle()
            device.click(closed.center.x.toInt(), (closed.top + 28 * density).toInt())
            Thread.sleep(250)
            capture("pile-deck-opening").recycle()
            Thread.sleep(800)
            assertTrue(open.value)
            assertEquals(360f * density, bounds.get().height, 2f)
            assertEquals(124f * density, cardY[1].get().top - cardY[0].get().top, 2f)
            assertEquals(124f * density, cardY[2].get().top - cardY[1].get().top, 2f)
            assertEquals(1, coverMounts.get())
            assertTrue(
                "Card mounts: ${cardMounts.map { count -> count.get() }}",
                cardMounts.all { count -> count.get() == 1 },
            )
            assertEquals(-1, navigated.get())
            capture("pile-deck-open").recycle()
            device.click(
                bounds.get().center.x.toInt(),
                (bounds.get().top + (248 + 55) * density).toInt(),
            )
            Thread.sleep(100)
            assertEquals(2, navigated.get())
            device.pressBack()
            Thread.sleep(250)
            capture("pile-deck-closing").recycle()
            Thread.sleep(800)
            assertFalse(open.value)
            assertEquals(152f * density, bounds.get().height, 2f)
            assertEquals(1, coverMounts.get())
            assertTrue(
                "Card mounts: ${cardMounts.map { count -> count.get() }}",
                cardMounts.all { count -> count.get() == 1 },
            )
            capture("pile-deck-restored").recycle()
        }
    }

    @Test(timeout = 60000)
    fun liquidActuallyRendersDifferentSourceFrames() {
        motionScene(
            content = {
                Text("合成动效验收 · Liquid")
                AgentLiquid()
            }
        ) {
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
    fun originalXiaopingRendersMovesSmilesAndHonorsReducedMotion() {
        val bounds = AtomicReference(Rect.Zero)
        motionScene(
            content = {
                Text("合成动效验收 · Everplain 的小平")
                HomeCompanion(
                    true,
                    Modifier.onGloballyPositioned { bounds.set(it.boundsInRoot()) },
                    narrow = true,
                )
            }
        ) {
            fun body(image: Bitmap): Bitmap {
                val box = bounds.get()
                assertTrue("Original companion is laid out", box.width > 80 && box.height > 80)
                return Bitmap.createBitmap(
                    image,
                    box.left.toInt(),
                    box.top.toInt(),
                    box.width.toInt(),
                    box.height.toInt(),
                )
            }
            Thread.sleep(1700)
            val first = capture("companion-idle-a")
            Thread.sleep(650)
            val second = capture("companion-idle-b")
            val a = body(first)
            val b = body(second)
            assertFalse("Authored hair and breathing really animate", a.sameAs(b))
            a.recycle()
            b.recycle()
            first.recycle()
            second.recycle()
            val box = bounds.get()
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .click(box.center.x.toInt(), box.center.y.toInt())
            Thread.sleep(350)
            capture("companion-happy").recycle()
            Thread.sleep(1700)
            shell("settings put global animator_duration_scale 0")
            Thread.sleep(600)
            val staticA = capture("companion-reduced-a")
            Thread.sleep(300)
            val staticB = capture("companion-reduced-b")
            val stillA = body(staticA)
            val stillB = body(staticB)
            assertTrue("Reduced motion stops the companion clock", stillA.sameAs(stillB))
            stillA.recycle()
            stillB.recycle()
            staticA.recycle()
            staticB.recycle()
        }
    }

    @Test(timeout = 60000)
    fun pacedNativeMarkdownDrainsAfterTerminalSignal() {
        val inst = InstrumentationRegistry.getInstrumentation()
        var answer by mutableStateOf("")
        var streaming by mutableStateOf(true)
        val complete =
            "这是 **逐字显现** 的合成验收。😀 中文与 emoji 不拆开。\n\n`native code` 与 [引用](https://example.invalid) 都是测试文字。"
        motionScene(
            content = {
                Text("合成动效验收 · Markdown")
                val view = rememberPacedText(answer, streaming)
                ThinkingStatus(streaming && view.visible.isEmpty(), "正在核对合成来源")
                if (view.visible.isNotEmpty())
                    NativeMarkdown(
                        view.visible,
                        revealedAt = view.revealedAt,
                        revealColor = "#5d8fe6",
                    )
            }
        ) { activity ->
            inst.runOnMainSync { answer = complete }
            Thread.sleep(350)
            capture("motion-stream-early").recycle()
            inst.runOnMainSync { streaming = false }
            val until = System.currentTimeMillis() + 30000
            var content = ""
            while (System.currentTimeMillis() < until) {
                inst.runOnMainSync {
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
