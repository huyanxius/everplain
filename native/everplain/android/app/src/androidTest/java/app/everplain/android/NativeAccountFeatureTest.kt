package app.everplain.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.graphics.HardwareRendererCompat
import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Test APK only. No real account, memory mutation, overview model or subscription request. */
@RunWith(AndroidJUnit4::class)
class NativeAccountFeatureTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun sourceIdentityMenuAndMemoryEditorKeepTheirState() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        inst.uiAutomation
            .executeShellCommand("settings put global animator_duration_scale 0")
            .close()
        val schemas =
            inst.context.assets.open("codec.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val session =
            WireJson.decodeFromJsonElement<SessionResponse>(schemas.getValue("SessionResponse"))
                .let { it.copy(user = it.user.copy(displayName = "演示用户")) }
        val profile =
            WireJson.decodeFromJsonElement<AgentProfileResponse>(
                    schemas.getValue("AgentProfileResponse")
                )
                .copy(
                    name = "澄",
                    avatarId = "cheng",
                    color = "#5d8fe6",
                    soulText = "你是我的阅读伙伴。先听我说完，再提出不同解释。",
                )
        val credits =
            WireJson.decodeFromJsonElement<CreditSummaryResponse>(
                schemas.getValue("CreditSummaryResponse")
            )
        val fake = FeatureApi(session, profile, credits)
        lateinit var vm: AppViewModel
        compose.runOnUiThread {
            EncryptedStore(compose.activity).clear()
            vm = ViewModelProvider(compose.activity)[AppViewModel::class.java]
            AppViewModel::class
                .java
                .getDeclaredField("api")
                .apply { isAccessible = true }
                .set(vm, fake)
            AppViewModel::class
                .java
                .getDeclaredField("sessionOwner")
                .apply { isAccessible = true }
                .set(vm, session.user.userId)
            @Suppress("UNCHECKED_CAST")
            val state =
                AppViewModel::class
                    .java
                    .getDeclaredField("mutable")
                    .apply { isAccessible = true }
                    .get(vm) as MutableStateFlow<AppState>
            state.value =
                AppState(starting = false, session = session, profile = profile, credits = credits)
        }
        fun capture(name: String) {
            compose.runOnUiThread {
                WindowCompat.getInsetsController(
                        compose.activity.window,
                        compose.activity.window.decorView,
                    )
                    .hide(WindowInsetsCompat.Type.ime())
            }
            compose.waitForIdle()
            Thread.sleep(700)
            val dir =
                File(compose.activity.getExternalFilesDir(null), "visual-fixtures").apply {
                    mkdirs()
                }
            File(dir, "android-synthetic-$name.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithContentDescription("打开导航").performClick()
        compose.onNodeWithContentDescription("账户 演示用户").performClick()
        compose.onNodeWithText("Soul · 人格").assertIsDisplayed()
        compose.onNodeWithText("Memory · 记忆").assertIsDisplayed()
        compose.onNodeWithText("升级套餐 · 网页").assertIsDisplayed()
        compose.waitUntil(30000) { !vm.state.value.accountMenuLoading }
        capture("account-menu")
        compose.onNodeWithText("Soul · 人格").performClick()
        compose.onNodeWithText("我的 AI 伙伴").assertIsDisplayed()
        compose.onNodeWithText("角色形象").assertIsDisplayed()
        capture("soul-drawer")
        compose
            .onNodeWithContentDescription("名字")
            .performScrollTo()
            .performTextReplacement("关闭仍保留的草稿")
        compose.onNodeWithContentDescription("关闭角色面板").performClick()
        compose.onNodeWithContentDescription("账户 演示用户").performClick()
        compose.onNodeWithText("Soul · 人格").performClick()
        compose.onNodeWithContentDescription("名字").performScrollTo().assertTextContains("关闭仍保留的草稿")
        compose.onNodeWithText("Memory · 记忆").performClick()
        compose.waitUntil(30000) { !vm.memory().state.value.loading }
        assertEquals(0, fake.overviews)
        capture("memory-empty")
        compose.onNodeWithText("添加记忆").performClick()
        compose
            .onNodeWithContentDescription("希望 Agent 记住什么？")
            .performScrollTo()
            .performTextInput("好".repeat(667))
        compose.onNodeWithText("保存记忆").performScrollTo().assertIsNotEnabled()
        compose
            .onNodeWithContentDescription("希望 Agent 记住什么？")
            .performScrollTo()
            .performTextReplacement("这是一条仅在测试进程内存在的合成记忆。")
        capture("memory-editor")
        compose.onNodeWithText("保存记忆").performScrollTo().performClick()
        compose.waitUntil(30000) {
            vm.memory().state.value.items.size == 1 &&
                !vm.memory().state.value.loading &&
                !vm.memory().state.value.overviewBusy
        }
        assertEquals(1, fake.created)
        assertEquals(1, fake.overviews)
        capture("memory-saved")
        compose.onNodeWithContentDescription("关闭角色面板").performClick()
    }
}

private class FeatureApi(
    private val session: SessionResponse,
    private val profile: AgentProfileResponse,
    private val credits: CreditSummaryResponse,
) : EverplainApi(Endpoint.parse("https://feature-fixture.example.invalid"), MemoryStore()) {
    var records = emptyList<MemoryResponse>()
    var settings = MemorySettings(false, null, true, 1)
    @Volatile var created = 0
    @Volatile var overviews = 0

    override suspend fun session() = session

    override suspend fun profile() = profile

    override suspend fun credits() = credits

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val json =
            when (path) {
                "/api/subscription" ->
                    WireJson.encodeToString(
                        SubscriptionOverviewResponse(
                            false,
                            emptyList(),
                            null,
                            "synthetic unavailable",
                        )
                    )
                "/api/memories/settings" -> WireJson.encodeToString(settings)
                "/api/memories/overview" -> {
                    overviews++
                    WireJson.encodeToString(
                        MemoryOverviewResponse(
                            records.size.toLong(),
                            settings.version,
                            "这段概览仅用于原生界面验收，没有模型调用。",
                        )
                    )
                }
                "/api/memories" ->
                    if (method == "GET")
                        WireJson.encodeToString(MemoryCollection(records, MemoryLimits(2000, 100)))
                    else {
                        created++
                        val request = WireJson.decodeFromString<MemoryCreate>(body!!)
                        val item =
                            MemoryResponse(
                                request.content,
                                "2026-10-04T00:00:00Z",
                                request.key,
                                "00000000-0000-4000-8000-000000000055",
                                "manual",
                                updatedAt = "2026-10-04T00:00:00Z",
                                version = 1,
                            )
                        records = listOf(item)
                        settings = settings.copy(version = 2)
                        WireJson.encodeToString(item)
                    }
                else -> error("Unhandled synthetic $method $path")
            }
        return WireJson.decodeFromString(serializer, json)
    }
}
