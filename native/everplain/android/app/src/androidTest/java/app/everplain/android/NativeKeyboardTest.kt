package app.everplain.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.view.KeyEvent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** No Compose test input interceptor: drives the actual Android input method and Back key. */
@RunWith(AndroidJUnit4::class)
class NativeKeyboardTest {
    @Test
    fun actualImeDoesNotCoverComposerAndBackKeepsText() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        val schemas =
            inst.context.assets.open("codec.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val session =
            WireJson.decodeFromJsonElement<SessionResponse>(schemas.getValue("SessionResponse"))
        val profile =
            WireJson.decodeFromJsonElement<AgentProfileResponse>(
                    schemas.getValue("AgentProfileResponse")
                )
                .copy(name = "澄", avatarId = "cheng", color = "#5d8fe6")
        val catalog =
            WireJson.decodeFromJsonElement<AgentModelCatalogResponse>(
                    schemas.getValue("AgentModelCatalogResponse")
                )
                .let { response ->
                    response.copy(items = response.items.map { it.copy(label = "测试模型") })
                }
        Configurator.getInstance().waitForIdleTimeout = 1000
        val device = UiDevice.getInstance(inst)
        val dir =
            File(inst.targetContext.getExternalFilesDir(null), "visual-fixtures").apply { mkdirs() }
        inst.uiAutomation.executeShellCommand("settings put global animator_duration_scale 0").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
        inst.uiAutomation
            .executeShellCommand("settings put secure show_ime_with_hard_keyboard 1")
            .use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var vm: AppViewModel
            scenario.onActivity { activity ->
                vm = ViewModelProvider(activity)[AppViewModel::class.java]
                AppViewModel::class
                    .java
                    .getDeclaredField("api")
                    .apply { isAccessible = true }
                    .set(
                        vm,
                        object :
                            EverplainApi(
                                Endpoint.parse("https://keyboard-fixture.example.invalid"),
                                MemoryStore(),
                            ) {
                            override suspend fun session() = session
                        },
                    )
                AppViewModel::class
                    .java
                    .getDeclaredField("sessionOwner")
                    .apply { isAccessible = true }
                    .set(vm, session.user.userId)
                @Suppress("UNCHECKED_CAST")
                val mutable =
                    AppViewModel::class
                        .java
                        .getDeclaredField("mutable")
                        .apply { isAccessible = true }
                        .get(vm) as MutableStateFlow<AppState>
                mutable.value =
                    AppState(
                        starting = false,
                        session = session,
                        profile = profile,
                        catalog = catalog,
                        model = catalog.items.first().modelId,
                        effort = catalog.items.first().defaultReasoningEffort,
                        destination = Destination.Chat,
                    )
            }
            assertTrue(device.wait(Until.hasObject(By.desc("问一个问题")), 30000))
            device.findObject(By.desc("问一个问题")).click()
            val deadline = System.currentTimeMillis() + 30000
            var visible = false
            while (!visible && System.currentTimeMillis() < deadline) {
                scenario.onActivity {
                    visible =
                        ViewCompat.getRootWindowInsets(it.window.decorView)
                            ?.isVisible(WindowInsetsCompat.Type.ime()) == true
                }
                Thread.sleep(200)
            }
            assertTrue("Real Android IME must be visible", visible)
            scenario.onActivity { activity ->
                (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("synthetic QA", "你好，原生键盘与返回测试。"))
            }
            val now = android.os.SystemClock.uptimeMillis()
            inst.sendKeySync(
                KeyEvent(
                    now,
                    now,
                    KeyEvent.ACTION_DOWN,
                    KeyEvent.KEYCODE_V,
                    0,
                    KeyEvent.META_CTRL_ON,
                )
            )
            inst.sendKeySync(
                KeyEvent(
                    now,
                    android.os.SystemClock.uptimeMillis(),
                    KeyEvent.ACTION_UP,
                    KeyEvent.KEYCODE_V,
                    0,
                    KeyEvent.META_CTRL_ON,
                )
            )
            device.waitForIdle(1000)
            val ime = device.findObject(By.pkg("com.android.inputmethod.latin"))
            val editor = device.findObject(By.desc("问一个问题"))
            if (ime != null)
                assertTrue(
                    "IME must not cover the editable composer",
                    editor.visibleBounds.bottom <= ime.visibleBounds.top,
                )
            File(dir, "android-synthetic-real-ime.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            val before = vm.state.value.draft
            assertEquals("你好，原生键盘与返回测试。", before)
            device.pressBack()
            Thread.sleep(1000)
            assertEquals(before, vm.state.value.draft)
            assertEquals(Destination.Chat, vm.state.value.destination)
            File(dir, "android-synthetic-real-ime-back.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            // Sending from Home moves the same native editor into Chat; its real IME
            // must remain open while the controlled composer ignores edits in flight.
            val conversation =
                WireJson.decodeFromJsonElement<AgentConversationResponse>(
                    schemas.getValue("AgentConversationResponse")
                )
            scenario.onActivity { activity ->
                AppViewModel::class
                    .java
                    .getDeclaredField("api")
                    .apply { isAccessible = true }
                    .set(
                        vm,
                        object :
                            EverplainApi(
                                Endpoint.parse("https://keyboard-fixture.example.invalid"),
                                MemoryStore(),
                            ) {
                            override suspend fun session() = session

                            override suspend fun history() =
                                emptyList<AgentConversationSummaryResponse>()

                            override fun stream(body: AgentTurnRequest, key: String) = flow {
                                emit(
                                    SseFrame(
                                        "turn_started",
                                        "{\"conversation_id\":\"${conversation.conversationId}\",\"run_id\":\"00000000-0000-4000-8000-000000000019\"}",
                                    )
                                )
                                emit(SseFrame("assistant_delta", "{\"delta\":\"原生输入焦点测试回答\"}"))
                                awaitCancellation()
                            }
                        },
                    )
                @Suppress("UNCHECKED_CAST")
                val mutable =
                    AppViewModel::class
                        .java
                        .getDeclaredField("mutable")
                        .apply { isAccessible = true }
                        .get(vm) as MutableStateFlow<AppState>
                mutable.value =
                    AppState(
                        starting = false,
                        session = session,
                        profile = profile,
                        catalog = catalog,
                        model = catalog.items.first().modelId,
                        effort = catalog.items.first().defaultReasoningEffort,
                        destination = Destination.Home,
                    )
            }
            assertTrue(device.wait(Until.hasObject(By.desc("问澄")), 15000))
            device.findObject(By.desc("问澄")).click()
            inst.sendKeySync(
                KeyEvent(
                    android.os.SystemClock.uptimeMillis(),
                    android.os.SystemClock.uptimeMillis(),
                    KeyEvent.ACTION_DOWN,
                    KeyEvent.KEYCODE_V,
                    0,
                    KeyEvent.META_CTRL_ON,
                )
            )
            inst.sendKeySync(
                KeyEvent(
                    android.os.SystemClock.uptimeMillis(),
                    android.os.SystemClock.uptimeMillis(),
                    KeyEvent.ACTION_UP,
                    KeyEvent.KEYCODE_V,
                    0,
                    KeyEvent.META_CTRL_ON,
                )
            )
            device.waitForIdle(1000)
            val homeImeDeadline = System.currentTimeMillis() + 15000
            visible = false
            while (!visible && System.currentTimeMillis() < homeImeDeadline) {
                scenario.onActivity {
                    visible =
                        ViewCompat.getRootWindowInsets(it.window.decorView)
                            ?.isVisible(WindowInsetsCompat.Type.ime()) == true
                }
                Thread.sleep(200)
            }
            assertTrue("Home editor must have a real IME before Send", visible)
            device.findObject(By.desc("发送给 Everplain")).click()
            val sendDeadline = System.currentTimeMillis() + 15000
            while (
                vm.state.value.pending?.runId == null && System.currentTimeMillis() < sendDeadline
            ) Thread.sleep(200)
            assertTrue(vm.state.value.streaming)
            assertNull("Web user bubble has no role heading", device.findObject(By.text("你")))
            assertNull(
                "Web answer uses the Bot avatar, not a name heading",
                device.findObject(By.text("澄")),
            )
            Thread.sleep(1000)
            scenario.onActivity {
                visible =
                    ViewCompat.getRootWindowInsets(it.window.decorView)
                        ?.isVisible(WindowInsetsCompat.Type.ime()) == true
            }
            assertTrue("First Home send must preserve the real IME during streaming", visible)
            val duringStream = vm.state.value.draft
            scenario.onActivity { vm.setDraft("must not edit during streaming") }
            assertEquals(duringStream, vm.state.value.draft)
            File(dir, "android-synthetic-home-send-ime.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            scenario.onActivity {
                vm.endStopWait()
                vm.navigate(Destination.Agent)
            }
            assertTrue(device.wait(Until.hasObject(By.desc("人格描述（Markdown）")), 15000))
            device.findObject(By.desc("人格描述（Markdown）")).click()
            val agentImeDeadline = System.currentTimeMillis() + 15000
            visible = false
            var keyboardHeight = 0
            while (!visible && System.currentTimeMillis() < agentImeDeadline) {
                scenario.onActivity {
                    val insets = ViewCompat.getRootWindowInsets(it.window.decorView)
                    visible = insets?.isVisible(WindowInsetsCompat.Type.ime()) == true
                    keyboardHeight = insets?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
                }
                Thread.sleep(200)
            }
            assertTrue("Agent editor must open the real input method", visible)
            Thread.sleep(500)
            val soulBounds = device.findObject(By.desc("人格描述（Markdown）")).visibleBounds
            assertTrue(
                "Agent editor must remain above the IME",
                soulBounds.bottom <= device.displayHeight - keyboardHeight,
            )
            File(dir, "android-synthetic-agent-ime.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            repeat(4) {
                if (device.findObject(By.text("保存 Agent")) == null)
                    device.findObject(By.scrollable(true))?.scroll(Direction.DOWN, 0.7f)
            }
            val save = device.findObject(By.text("保存 Agent"))
            assertNotNull("Agent Save remains reachable while the keyboard is open", save)
            assertTrue(save.visibleBounds.bottom <= device.displayHeight - keyboardHeight)
            device.pressBack()
            Thread.sleep(500)
            assertEquals(Destination.Agent, vm.state.value.destination)
        }
    }
}
