package app.everplain.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import app.everplain.core.Endpoint
import app.everplain.core.MemoryStore
import app.everplain.core.WireJson
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** ONLY in the instrumentation APK. These are synthetic UI fixtures, not live account proof. */
@RunWith(AndroidJUnit4::class)
class ScreenshotFixtureTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun renderNativePagesUsingExplicitSyntheticFixtures() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        instrumentation.uiAutomation
            .executeShellCommand("settings put global animator_duration_scale 0")
            .close()
        val schemas =
            instrumentation.context.assets.open("codec.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val session =
            WireJson.decodeFromJsonElement<SessionResponse>(schemas.getValue("SessionResponse"))
        val profile =
            WireJson.decodeFromJsonElement<AgentProfileResponse>(
                    schemas.getValue("AgentProfileResponse")
                )
                .copy(
                    name = "澄",
                    color = "#5d8fe6",
                    avatarId = "cheng",
                    speakingStyle = "clear",
                    soulText = "你是我的阅读伙伴。先听我说完，再提出不同解释；有疑问时坦诚说明。",
                )
        val catalog =
            WireJson.decodeFromJsonElement<AgentModelCatalogResponse>(
                schemas.getValue("AgentModelCatalogResponse")
            )
        val account =
            WireJson.decodeFromJsonElement<AccountResponse>(schemas.getValue("AccountResponse"))
                .copy(displayName = "演示用户", email = "qa@example.invalid")
        val credits =
            WireJson.decodeFromJsonElement<CreditSummaryResponse>(
                schemas.getValue("CreditSummaryResponse")
            )
        val base =
            AppState(
                starting = false,
                origin = "https://qa.example.invalid/",
                session = session,
                profile = profile,
                catalog = catalog.copy(items = catalog.items.map { it.copy(label = "测试模型") }),
                model = catalog.items.first().modelId,
                effort = catalog.items.first().defaultReasoningEffort,
                account = account,
                credits = credits,
            )
        lateinit var mutable: MutableStateFlow<AppState>
        lateinit var fixtureViewModel: AppViewModel
        compose.runOnUiThread {
            val vm = ViewModelProvider(compose.activity)[AppViewModel::class.java]
            fixtureViewModel = vm
            AppViewModel::class
                .java
                .getDeclaredField("api")
                .apply { isAccessible = true }
                .set(
                    vm,
                    object :
                        NativeFixtureApi(
                            Endpoint.parse("https://qa.example.invalid"),
                            MemoryStore(),
                        ) {
                        override suspend fun session() = session

                        override suspend fun profile() = profile

                        override suspend fun models() = catalog

                        override suspend fun history() =
                            emptyList<AgentConversationSummaryResponse>()

                        override suspend fun account() = account

                        override suspend fun credits() = credits

                        override suspend fun sessions() = AccountSessionPageResponse(emptyList())
                    },
                )
            AppViewModel::class
                .java
                .getDeclaredField("sessionOwner")
                .apply { isAccessible = true }
                .set(vm, session.user.userId)
            val field =
                AppViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            mutable = field.get(vm) as MutableStateFlow<AppState>
        }
        val directory =
            File(instrumentation.targetContext.getExternalFilesDir(null), "visual-fixtures").apply {
                mkdirs()
            }
        listOf(
                "home" to Destination.Home,
                "new-chat" to Destination.Chat,
                "account" to Destination.Account,
                "agent-settings" to Destination.Agent,
            )
            .forEach { (name, destination) ->
                compose.runOnUiThread { mutable.value = base.copy(destination = destination) }
                compose.waitForIdle()
                Thread.sleep(800)
                val bitmap = takeScreenshot()
                File(directory, "android-synthetic-$name.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            }
        fun capture(name: String) {
            compose.waitForIdle()
            Thread.sleep(800)
            val bitmap = takeScreenshot()
            File(directory, "android-synthetic-$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.runOnUiThread { mutable.value = base.copy(destination = Destination.Chat) }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("模型与思考强度", substring = true).performClick()
        compose.onNodeWithText("思考强度").assertIsDisplayed()
        capture("model-settings")
        instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.runOnUiThread { mutable.value = base.copy(destination = Destination.Agent) }
        compose.waitForIdle()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("保存 Agent"))
        compose.onNodeWithText("保存 Agent").assertIsDisplayed()
        capture("agent-save-visible")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasContentDescription("名字"))
        compose.onNodeWithContentDescription("名字").performTextReplacement("保留未保存的草稿")
        compose.waitForIdle()
        compose.onNodeWithContentDescription("名字").assertTextContains("保留未保存的草稿")
        lateinit var retainedDraft: AgentSettingsDraft
        compose.runOnUiThread {
            retainedDraft = fixtureViewModel.agentDraft(profile)
            org.junit.Assert.assertEquals("保留未保存的草稿", retainedDraft.state.value.name)
            val saved =
                EncryptedStore(compose.activity)
                    .read("agent-settings-draft:${base.origin}:${session.user.userId}")
            org.junit.Assert.assertEquals(
                "保留未保存的草稿",
                WireJson.decodeFromString<AgentDraftData>(saved!!).name,
            )
        }
        compose.runOnUiThread { mutable.value = base.copy(destination = Destination.Home) }
        compose.waitForIdle()
        compose.runOnUiThread { mutable.value = base.copy(destination = Destination.Agent) }
        compose.waitForIdle()
        compose.runOnUiThread {
            org.junit.Assert.assertSame(retainedDraft, fixtureViewModel.agentDraft(profile))
            org.junit.Assert.assertEquals("保留未保存的草稿", retainedDraft.state.value.name)
        }
        compose.onNodeWithContentDescription("名字").assertTextContains("保留未保存的草稿")
        compose.onNodeWithContentDescription("名字").performTextReplacement("澄")
        compose.runOnUiThread { mutable.value = base.copy(destination = Destination.Chat) }
        compose.waitForIdle()
        instrumentation.uiAutomation
            .executeShellCommand("settings put secure show_ime_with_hard_keyboard 1")
            .close()
        compose
            .onNodeWithContentDescription("问一个问题")
            .performClick()
            .performTextInput("你好，保留这段未发送的中文。")
        compose.onNodeWithContentDescription("问一个问题").assertTextContains("你好，保留这段未发送的中文。")
        capture("keyboard-chinese-text")
        instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        capture("keyboard-dismissed")
        compose.onNodeWithContentDescription("打开导航").performClick()
        compose.onNodeWithText("最近对话").assertIsDisplayed()
        capture("navigation-drawer")
        instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.runOnUiThread {
            mutable.value = base.copy(destination = Destination.Home, appearance = "dark")
        }
        capture("dark-home")
        compose.runOnUiThread {
            mutable.value = base.copy(destination = Destination.Agent, appearance = "dark")
        }
        compose.waitForIdle()
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        capture("dark-agent-settings")
        instrumentation.uiAutomation
            .executeShellCommand("settings put system font_scale 1.5")
            .close()
        Thread.sleep(1200)
        capture("large-font-agent-settings")
        instrumentation.uiAutomation
            .executeShellCommand("settings put system font_scale 1.0")
            .close()
        instrumentation.uiAutomation.executeShellCommand("wm size 320x844").close()
        Thread.sleep(1200)
        capture("narrow-agent-settings")
        instrumentation.uiAutomation.executeShellCommand("wm size 390x844").close()
        val conversation =
            WireJson.decodeFromJsonElement<app.everplain.shared.AgentConversationResponse>(
                schemas.getValue("AgentConversationResponse")
            )
        val markdown =
            "## 原生排版验收\n\n**重点**和普通中文正文。\n\n- 第一个项目\n- 第二个项目\n\n> 保留引用层级。\n\n```kotlin\nval value = 1\n```\n\n[参考链接](https://example.invalid)"
        compose.runOnUiThread {
            mutable.value =
                base.copy(
                    destination = Destination.Chat,
                    conversation =
                        conversation.copy(
                            turns =
                                conversation.turns.take(1).map {
                                    it.copy(
                                        user = it.user.copy(content = "请演示原生 Markdown 排版。"),
                                        assistant = it.assistant.copy(content = markdown),
                                    )
                                }
                        ),
                )
        }
        compose.waitForIdle()
        compose.runOnUiThread {
            fun findText(view: android.view.View): android.widget.TextView? {
                if (view is android.widget.TextView) return view
                if (view is android.view.ViewGroup)
                    for (index in 0 until view.childCount) {
                        findText(view.getChildAt(index))?.let {
                            return it
                        }
                    }
                return null
            }
            val nativeText = requireNotNull(findText(compose.activity.window.decorView))
            val rendered = nativeText.text as android.text.Spanned
            org.junit.Assert.assertFalse(rendered.toString().contains("**重点**"))
            org.junit.Assert.assertFalse(rendered.toString().contains("```"))
            org.junit.Assert.assertTrue(rendered.toString().contains("原生排版验收"))
            org.junit.Assert.assertTrue(
                rendered.getSpans(0, rendered.length, Any::class.java).isNotEmpty()
            )
            org.junit.Assert.assertTrue(nativeText.isTextSelectable)
        }
        capture("markdown-answer")
        instrumentation.uiAutomation
            .executeShellCommand("settings put global animator_duration_scale 1")
            .close()
        File(directory, "README.txt")
            .writeText(
                "Actual Android 35 AOSP software-emulator framebuffer captures. Native Compose APK. All displayed account, model, quota and profile values are synthetic instrumentation fixtures; these images do not verify live login/backend/model behavior. No production account was used."
            )
    }
}
