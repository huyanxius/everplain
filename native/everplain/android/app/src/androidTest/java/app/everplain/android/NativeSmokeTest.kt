package app.everplain.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.takeScreenshot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.graphics.HardwareRendererCompat
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Native UI only. No server, credentials or paid model calls are used. */
@RunWith(AndroidJUnit4::class)
class NativeSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun loginGateHasAccessibleNativeControls() {
        HardwareRendererCompat.setDrawingEnabled(true)
        fun capture(name: String) {
            compose.runOnUiThread {
                WindowCompat.getInsetsController(
                        compose.activity.window,
                        compose.activity.window.decorView,
                    )
                    .hide(WindowInsetsCompat.Type.ime())
            }
            compose.waitForIdle()
            Thread.sleep(1000)
            val directory =
                File(compose.activity.getExternalFilesDir(null), "visual-fixtures").apply {
                    mkdirs()
                }
            File(directory, "android-synthetic-$name.png").outputStream().use {
                takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText("登录 Everplain").assertIsDisplayed()
        capture("login-email")
        compose.onNodeWithContentDescription("邮箱").assertIsDisplayed()
        compose.onNodeWithText("继续").performClick()
        compose.onNodeWithText("请输入有效的邮箱地址。").assertIsDisplayed()
        compose.onNodeWithContentDescription("邮箱").performTextInput("synthetic@example.invalid")
        compose.onNodeWithText("继续").performClick()
        compose.onNodeWithText("输入密码").assertIsDisplayed()
        compose.onNodeWithContentDescription("密码").assertIsDisplayed()
        capture("login-password")
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("登录 Everplain").assertIsDisplayed()
        compose.onNodeWithContentDescription("邮箱").assertTextContains("synthetic@example.invalid")
        compose.onNodeWithText("创建账号").performClick()
        compose.onNodeWithText("注册").assertIsDisplayed()
        compose.onNodeWithText("发送验证码").assertIsDisplayed()
        capture("register-email")
        compose.onNodeWithText("返回登录").performClick()
    }
}

@RunWith(AndroidJUnit4::class)
class AvatarSmokeTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun avatarUsesCanonicalNativeAsset() {
        compose.setContent { EverplainTheme { AgentAvatar("cheng", "#5d8fe6", "澄", 92) } }
        compose.onNodeWithContentDescription("澄").assertIsDisplayed()
    }
}
