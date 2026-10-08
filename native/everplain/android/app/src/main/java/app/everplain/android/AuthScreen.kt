package app.everplain.android

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.everplain.shared.EverplainTokens
import kotlinx.coroutines.delay

/** Native implementation of AccountPages / useAuthFlow / auth-flow.css. */
@Composable
internal fun AuthScreen(s: AppState, vm: AppViewModel) {
    var register by rememberSaveable { mutableStateOf(false) }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var email by rememberSaveable { mutableStateOf("") }
    // Credentials are never saveable, persisted, logged, or used outside explicit submission.
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    val code = s.registrationCodeDraft
    var visible by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var origin by rememberSaveable { mutableStateOf(s.origin) }
    var serviceSettings by rememberSaveable { mutableStateOf(false) }
    var seenCodeSequence by rememberSaveable { mutableLongStateOf(s.registrationCodeSequence) }
    var resend by remember { mutableLongStateOf(0) }
    val context = LocalContext.current
    fun clear() {
        error = null
        vm.clearError()
    }
    fun back() {
        if (s.busy) return
        clear()
        visible = false
        if (register && step == 1) vm.setRegistrationCodeDraft("")
        step = (step - 1).coerceAtLeast(0)
    }
    fun validEmail() =
        email.length <= 320 && Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email.trim())
    fun sendCode() {
        clear()
        if (!validEmail()) error = "请输入有效的邮箱地址。"
        else {
            email = email.trim()
            vm.sendRegistrationCode(origin, email)
        }
    }
    fun submit() {
        if (s.busy) return
        clear()
        when {
            step == 0 ->
                if (register) sendCode()
                else {
                    if (!validEmail()) error = "请输入有效的邮箱地址。"
                    else {
                        email = email.trim()
                        step = 1
                    }
                }
            register && step == 1 -> {
                if (!Regex("[0-9]{6}").matches(code)) error = "请输入邮件中的 6 位验证码。" else step = 2
            }
            password.length !in 8..128 ->
                error = if (register) "密码需要 8-128 个字符。" else "请检查邮箱格式，密码需要 8-128 个字符。"
            register && password != confirmation -> error = "两次输入的密码不一致。"
            register ->
                if (!Regex("[0-9]{6}").matches(code)) {
                    step = 1
                    error = "请输入邮件中的 6 位验证码。"
                } else vm.register(origin, email, password, code)
            else -> vm.login(origin, email, password)
        }
    }
    LaunchedEffect(Unit) { if (register && step == 2 && code.isEmpty()) step = 1 }
    LaunchedEffect(s.registrationCodeSequence) {
        if (s.registrationCodeSequence > seenCodeSequence) {
            seenCodeSequence = s.registrationCodeSequence
            if (register && email == s.registrationEmail) step = 1
        }
    }
    LaunchedEffect(s.registrationResendUntil) {
        do {
            resend =
                ((s.registrationResendUntil - android.os.SystemClock.elapsedRealtime() + 999) /
                        1000)
                    .coerceAtLeast(0)
            if (resend > 0) delay(1000)
        } while (resend > 0)
    }
    BackHandler(step > 0 && !serviceSettings) { back() }
    if (serviceSettings) {
        var edited by remember { mutableStateOf(origin) }
        AlertDialog(
            onDismissRequest = { serviceSettings = false },
            title = { Text("服务地址") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("默认连接 Everplain。自托管部署可使用自己的 HTTPS 服务地址。")
                    OutlinedTextField(
                        edited,
                        { edited = it },
                        label = { Text("HTTPS 服务地址") },
                        singleLine = true,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val parsed =
                            runCatching { app.everplain.core.Endpoint.parse(edited) }.getOrNull()
                        if (parsed != null) {
                            origin = parsed.origin
                            step = 0
                            password = ""
                            confirmation = ""
                            vm.resetRegistrationFlow()
                            clear()
                            serviceSettings = false
                        } else error = "请输入有效的 HTTPS 服务地址。"
                    }
                ) {
                    Text("使用此服务")
                }
            },
            dismissButton = { TextButton(onClick = { serviceSettings = false }) { Text("取消") } },
        )
    }
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        val stageHeight = maxHeight
        val crowdScale = ((maxWidth.value - 32f) / 384f).coerceAtMost(1f)
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = stageHeight)
                .padding(horizontal = 16.dp, vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Row(
                Modifier.clearAndSetSemantics {},
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                avatarNames.forEachIndexed { index, (id, name) ->
                    AgentAvatar(
                        id,
                        null,
                        name,
                        ((if (index == 3) 72 else 48) * crowdScale).toInt(),
                        if (index == 3) "greet" else "idle",
                        offsetSeconds = index * .7f,
                        decorative = true,
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
            Text(
                if (!register) if (step == 0) "登录 Everplain" else "输入密码"
                else
                    when (step) {
                        0 -> "注册"
                        1 -> "查看你的邮箱"
                        else -> "设置密码"
                    },
                fontFamily = FontFamily.Serif,
                fontSize = EverplainTokens.textDisplay.sp,
                lineHeight =
                    (EverplainTokens.textDisplay * EverplainTokens.textDisplayLineHeight).sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            if (register) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.semantics { contentDescription = "第 ${step + 1} 步，共 3 步" },
                ) {
                    repeat(3) { n ->
                        Box(
                            Modifier.width(if (step == n) 48.dp else 28.dp)
                                .height(6.dp)
                                .clip(CircleShape)
                                .background(
                                    if (n <= step) MaterialTheme.colorScheme.onSurface
                                    else MaterialTheme.colorScheme.outlineVariant
                                )
                        )
                    }
                }
                Text(
                    "第 ${step + 1} 步，共 3 步",
                    Modifier.padding(top = 8.dp, bottom = 24.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (step > 0) {
                Text(
                    email,
                    Modifier.widthIn(max = 400.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                if (register)
                    TextButton(onClick = ::back, enabled = !s.busy) {
                        Text(if (step == 1) "修改邮箱" else "返回验证码")
                    }
                Spacer(Modifier.height(24.dp))
            }
            Column(
                Modifier.widthIn(max = 400.dp).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when {
                    step == 0 ->
                        AuthInput(
                            email,
                            {
                                email = it.take(320)
                                password = ""
                            },
                            "邮箱",
                            "邮箱地址",
                            KeyboardType.Email,
                            !s.busy,
                            submit = ::submit,
                        )
                    register && step == 1 ->
                        AuthInput(
                            code,
                            { vm.setRegistrationCodeDraft(it) },
                            "验证码",
                            "6 位验证码",
                            KeyboardType.NumberPassword,
                            !s.busy,
                            centered = true,
                            submit = ::submit,
                        )
                    else -> {
                        AuthInput(
                            password,
                            { password = it.take(128) },
                            "密码",
                            "密码",
                            KeyboardType.Password,
                            !s.busy,
                            masked = !visible,
                            toggle =
                                if (register) null
                                else {
                                    { visible = !visible }
                                },
                            submit = ::submit,
                        )
                        if (register) {
                            AuthInput(
                                confirmation,
                                { confirmation = it.take(128) },
                                "确认密码",
                                "再输入一次密码",
                                KeyboardType.Password,
                                !s.busy,
                                masked = true,
                                autoFocus = false,
                                submit = ::submit,
                            )
                            Text(
                                "8-128 个字符。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                (error ?: s.error)?.let {
                    Text(
                        it,
                        Modifier.fillMaxWidth()
                            .semantics { liveRegion = LiveRegionMode.Polite }
                            .background(MaterialTheme.colorScheme.errorContainer, CircleShape)
                            .padding(16.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Button(
                    onClick = ::submit,
                    enabled = !s.busy,
                    shape = CircleShape,
                    modifier =
                        Modifier.fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .alpha(if (s.busy) .45f else 1f),
                    colors =
                        ButtonDefaults.buttonColors(
                            disabledContainerColor = MaterialTheme.colorScheme.primary,
                            disabledContentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                ) {
                    Text(
                        if (!register) if (step == 0) "继续" else if (s.busy) "正在登录…" else "登录并继续"
                        else
                            when (step) {
                                0 -> if (s.busy) "正在发送…" else "发送验证码"
                                1 -> "继续设置密码"
                                else -> if (s.busy) "正在创建…" else "创建账号"
                            },
                        fontSize = 16.sp,
                        fontWeight = FontWeight(550),
                    )
                }
                if (register && step == 1)
                    TextButton(onClick = ::sendCode, enabled = !s.busy && resend == 0L) {
                        Text(if (resend > 0) "$resend 秒后可重新发送" else "重新发送验证码")
                    }
            }
            Spacer(Modifier.height(48.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (register) "已有账号？ " else "还没有账号？ ",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        if (register) "返回登录" else "创建账号",
                        Modifier.clickable(enabled = !s.busy) {
                                register = !register
                                step = 0
                                vm.resetRegistrationFlow()
                                password = ""
                                confirmation = ""
                                visible = false
                                clear()
                            }
                            .semantics { role = Role.Button },
                        style = MaterialTheme.typography.bodySmall,
                        textDecoration = TextDecoration.Underline,
                    )
                }
                Text(
                    "Everplain 首页",
                    Modifier.clickable {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(origin)))
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (step > 0)
            IconButton(
                onClick = ::back,
                enabled = !s.busy,
                modifier =
                    Modifier.padding(16.dp)
                        .size(40.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
            ) {
                Icon(EpIcons.ArrowLeft, "返回", Modifier.size(20.dp))
            }
        IconButton(
            onClick = { serviceSettings = true },
            enabled = !s.busy,
            modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
        ) {
            Icon(
                NavIcons.Settings,
                "服务地址设置",
                Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AuthInput(
    value: String,
    change: (String) -> Unit,
    label: String,
    placeholder: String,
    keyboard: KeyboardType,
    enabled: Boolean,
    masked: Boolean = false,
    centered: Boolean = false,
    autoFocus: Boolean = true,
    toggle: (() -> Unit)? = null,
    submit: () -> Unit,
) {
    val focus = remember(label) { FocusRequester() }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    LaunchedEffect(label) { if (autoFocus) focus.requestFocus() }
    BasicTextField(
        value,
        change,
        Modifier.fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(
                if (focused) MaterialTheme.colorScheme.surfaceVariant
                else MaterialTheme.colorScheme.surfaceContainerHighest,
                CircleShape,
            )
            .then(
                if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                else Modifier
            )
            .focusRequester(focus)
            .semantics { contentDescription = label },
        enabled = enabled,
        interactionSource = interaction,
        singleLine = true,
        textStyle =
            MaterialTheme.typography.bodyLarge.copy(
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = if (centered) TextAlign.Center else TextAlign.Start,
            ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        visualTransformation =
            if (masked) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions =
            KeyboardOptions(
                keyboardType = keyboard,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        decorationBox = { inner ->
            Row(
                Modifier.padding(start = 20.dp, end = if (toggle == null) 20.dp else 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp),
                    contentAlignment = if (centered) Alignment.Center else Alignment.CenterStart,
                ) {
                    if (value.isEmpty())
                        Text(
                            placeholder,
                            color =
                                EverplainTokens.colorFaint(
                                        MaterialTheme.colorScheme.background.luminance() < .5f
                                    )
                                    .compose(),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    inner()
                }
                if (toggle != null)
                    IconButton(
                        onClick = toggle,
                        enabled = enabled,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            if (masked) EpIcons.Eye else EpIcons.EyeSlash,
                            if (masked) "显示密码" else "隐藏密码",
                            Modifier.size(18.dp),
                        )
                    }
            }
        },
    )
}
