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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Test APK only. Account/consent/password/channel mutations are in-process fixtures, never real
 * services.
 */
@RunWith(AndroidJUnit4::class)
class NativeAccountSettingsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun realControlsValidateRetainDraftAndUseTypedAccountRequests() {
        val inst = InstrumentationRegistry.getInstrumentation()
        HardwareRendererCompat.setDrawingEnabled(true)
        inst.uiAutomation.executeShellCommand("settings put global animator_duration_scale 0").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
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
        val account =
            WireJson.decodeFromJsonElement<AccountResponse>(schemas.getValue("AccountResponse"))
                .copy(
                    displayName = "合成验收用户",
                    email = "fixture@example.invalid",
                    isProtectedAdmin = false,
                )
        val api = SettingsDeviceApi(account)
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
            val state =
                AppViewModel::class
                    .java
                    .getDeclaredField("mutable")
                    .apply { isAccessible = true }
                    .get(vm) as MutableStateFlow<AppState>
            mutable = state
            state.value =
                AppState(
                    starting = false,
                    session = session,
                    profile = profile,
                    account = account,
                    destination = Destination.Account,
                    accountSection = "使用偏好",
                )
        }
        fun section(value: String) {
            compose.runOnUiThread { mutable.value = mutable.value.copy(accountSection = value) }
            compose.waitForIdle()
        }
        fun capture(name: String) {
            compose.waitForIdle()
            Thread.sleep(500)
            val dir =
                File(compose.activity.getExternalFilesDir(null), "visual-fixtures").apply {
                    mkdirs()
                }
            val bitmap = takeScreenshot()
            File(dir, "android-synthetic-settings-$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        compose.waitUntil(30000) { !vm.accountSettings().state.value.loading }
        compose.onNodeWithContentDescription("时区").performScrollTo().performClick()
        compose.onNodeWithText("协调世界时").performClick()
        compose.onNodeWithText("保存偏好").performScrollTo().performClick()
        compose.waitUntil(30000) { api.preferencesWrites == 1 }
        assertEquals("UTC", api.current.preferences.timezone)
        capture("preferences")
        section("安全")
        compose
            .onNodeWithContentDescription("当前密码")
            .performScrollTo()
            .performTextInput("synthetic-current")
        compose.onNodeWithContentDescription("新密码").performScrollTo().performTextInput("short")
        compose.onNodeWithContentDescription("确认新密码").performScrollTo().performTextInput("short")
        compose.onNodeWithText("更新密码").performScrollTo().performClick()
        assertEquals(0, api.passwordWrites)
        compose
            .onNodeWithContentDescription("新密码")
            .performScrollTo()
            .performTextReplacement("synthetic-new-password")
        compose
            .onNodeWithContentDescription("确认新密码")
            .performScrollTo()
            .performTextReplacement("synthetic-new-password")
        compose.onNodeWithText("更新密码").performScrollTo().performClick()
        compose.waitUntil(30000) { api.passwordWrites == 1 }
        compose.onNodeWithContentDescription("当前密码").performScrollTo().assertTextEquals("")
        inst.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        capture("security")
        section("数据与隐私")
        capture("privacy")
        section("账户状态")
        compose.onNodeWithText("永久删除账户").performScrollTo().performClick()
        compose.onNodeWithText("确认永久删除").assertIsNotEnabled()
        compose.onNodeWithText("取消").performClick()
        assertEquals(0, api.destructiveWrites)
        capture("account-status")
        section("聊天平台")
        compose.waitUntil(30000) { !vm.channels().state.value.loading }
        compose.onNodeWithText("生成一次性绑定码").performScrollTo().assertIsNotEnabled()
        capture("channels")
    }
}

private class SettingsDeviceApi(var current: AccountResponse) :
    NativeFixtureApi(Endpoint.parse("https://settings-device.example.invalid"), MemoryStore()) {
    var preferencesWrites = 0
    var passwordWrites = 0
    var destructiveWrites = 0

    override suspend fun account() = current

    override suspend fun sessions() =
        AccountSessionPageResponse(
            listOf(AccountSessionResponse("", true, "合成 Android 设备", "", null, "", "session"))
        )

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val json =
            when {
                method == "PATCH" && path == "/api/account/preferences" -> {
                    val request = WireJson.decodeFromString<UpdatePreferencesRequest>(body!!)
                    check(request.expectedVersion == current.preferences.version)
                    preferencesWrites++
                    current =
                        current.copy(
                            preferences =
                                current.preferences.copy(
                                    locale = request.locale,
                                    timezone = request.timezone,
                                    version = current.preferences.version + 1,
                                )
                        )
                    WireJson.encodeToString(current.preferences)
                }
                method == "POST" && path.endsWith("/password/change") -> {
                    check(key != null)
                    passwordWrites++
                    WireJson.encodeToString(ChangePasswordResponse(0))
                }
                path == "/api/channels/gateways" ->
                    WireJson.encodeToString(
                        listOf(
                            ChannelGatewayInfoResponse(null, "synthetic-bot", "合成测试机器人", "telegram")
                        )
                    )
                path == "/api/channels/bindings" -> "[]"
                method == "POST" && (path.endsWith("/delete") || path.endsWith("/deactivate")) -> {
                    destructiveWrites++
                    error("Must never submit destructive fixture without confirmation")
                }
                else -> return super.contractJson(serializer, path, method, body, key, query)
            }
        return WireJson.decodeFromString(serializer, json)
    }
}
