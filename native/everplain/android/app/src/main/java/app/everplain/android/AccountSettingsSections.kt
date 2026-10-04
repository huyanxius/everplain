package app.everplain.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import java.time.Instant
import kotlinx.coroutines.*

@Composable
internal fun AccountSettingsFeedback(controller: AccountSettingsController) {
    val s by controller.state.collectAsStateWithLifecycle()
    var end by remember { mutableStateOf(false) }
    if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    s.error?.let { LibraryNotice(it, true, "重新读取", controller::load) }
    s.notice?.let {
        Text(
            it,
            fontSize = 13.sp,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    if (s.unknown) EpButton("结束本地等待", { end = true }, enabled = !s.busy)
    if (end)
        AlertDialog(
            shape = RoundedCornerShape(24.dp),
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            onDismissRequest = { end = false },
            title = { Text("结束本地等待？") },
            text = { Text("这不会撤销已发送的操作，也不能保证服务器没有完成。之后请重新读取确认，避免重复提交。") },
            confirmButton = {
                EpButton(
                    "结束等待",
                    {
                        controller.endLocalWait()
                        end = false
                    },
                )
            },
            dismissButton = { EpButton("继续等待", { end = false }) },
        )
}

@Composable
internal fun CreditRedemptionField(controller: AccountSettingsController, refreshed: () -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    var code by remember { mutableStateOf("") }
    LaunchedEffect(s.completed) { if (s.completedAction == "redeem") code = "" }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        EpField("兑换码", code, { if (it.length <= 64) code = it }, placeholder = "QX-XXXX-XXXX")
        EpButton(
            "兑换",
            { controller.redeem(code, refreshed) },
            enabled = !s.busy && code.isNotBlank(),
        )
        Text("每个兑换码仅可使用一次", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun AccountAdditionalSection(
    section: String,
    app: AppState,
    vm: AppViewModel,
    c: AccountSettingsController,
) {
    val s by c.state.collectAsStateWithLifecycle()
    val account = s.account ?: app.account
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (LocalConfiguration.current.screenWidthDp > 640)
            Text(section, style = MaterialTheme.typography.titleLarge)
        when (section) {
            "使用偏好" -> if (account != null) PreferencesSettings(account, c, app, vm)
            "安全" -> SecuritySettings(c)
            "数据与隐私" -> if (account != null) PrivacySettings(account, c)
            "账户状态" -> if (account != null) AccountStatusSettings(account, c)
            "聊天平台" -> ChannelSettings(vm.channels())
        }
    }
}

@Composable
private fun PreferencesSettings(
    account: AccountResponse,
    c: AccountSettingsController,
    app: AppState,
    vm: AppViewModel,
) {
    val s by c.state.collectAsStateWithLifecycle()
    var locale by rememberSaveable { mutableStateOf(account.preferences.locale) }
    var timezone by rememberSaveable { mutableStateOf(account.preferences.timezone) }
    var expected by rememberSaveable { mutableLongStateOf(account.preferences.version) }
    var dirty by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(account.preferences.version) {
        if (!dirty) {
            locale = account.preferences.locale
            timezone = account.preferences.timezone
            expected = account.preferences.version
        }
    }
    LaunchedEffect(s.completed) {
        if (s.completedAction == "preferences") {
            dirty = false
            expected = s.account?.preferences?.version ?: expected
        }
    }
    Text("外观", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (id, label) ->
            EpButton(
                label,
                { vm.setAppearance(id) },
                selected = app.appearance == id,
                modifier = Modifier.weight(1f),
            )
        }
    }
    SettingsChoice("界面语言", locale, listOf("zh-CN" to "简体中文", "en-US" to "English"), !s.busy) {
        locale = it
        dirty = true
    }
    SettingsChoice("时区", timezone, listOf("Asia/Shanghai" to "中国标准时间", "UTC" to "协调世界时"), !s.busy) {
        timezone = it
        dirty = true
    }
    if (s.conflict) {
        Text("服务器已有新版本。重新读取不会覆盖这里未保存的修改。", fontSize = 13.sp)
        EpButton(
            "保留修改并采用最新版本",
            {
                expected = s.account?.preferences?.version ?: expected
                c.endLocalWait()
            },
            enabled = !s.loading && !s.busy,
        )
    }
    EpButton(
        if (s.busy) "正在保存…" else "保存偏好",
        { c.savePreferences(locale, timezone, expected) },
        primary = true,
        enabled = !s.busy && !s.conflict,
    )
}

@Composable
private fun SecuritySettings(c: AccountSettingsController) {
    val s by c.state.collectAsStateWithLifecycle()
    // Deliberately not rememberSaveable: secrets must never enter a saved-state bundle.
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var revoke by rememberSaveable { mutableStateOf(true) }
    var selected by remember { mutableStateOf<AccountSessionResponse?>(null) }
    LaunchedEffect(s.completed) {
        if (s.completedAction == "password") {
            current = ""
            next = ""
            confirmation = ""
        }
        if (s.completedAction == "revoke") selected = null
    }
    Text("登录密码", style = MaterialTheme.typography.titleMedium)
    EpField(
        "当前密码",
        current,
        { if (it.length <= 128) current = it },
        password = true,
        enabled = !s.busy,
    )
    EpField("新密码", next, { if (it.length <= 128) next = it }, password = true, enabled = !s.busy)
    EpField(
        "确认新密码",
        confirmation,
        { if (it.length <= 128) confirmation = it },
        password = true,
        enabled = !s.busy,
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(revoke, { revoke = it }, enabled = !s.busy)
        Column {
            Text("撤销其他设备的会话", fontSize = 14.sp)
            Text("当前设备不会退出。", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    EpButton(
        if (s.busy) "正在更新…" else "更新密码",
        { c.changePassword(current, next, confirmation, revoke) },
        primary = true,
        enabled = !s.busy && current.isNotEmpty(),
    )
    Text("活跃会话", style = MaterialTheme.typography.titleMedium)
    s.sessions.forEach { session ->
        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(session.deviceLabel, fontSize = 14.sp)
                Text(
                    "最近活动 · ${dateTime(session.lastSeenAt)}",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (session.current) Text("当前会话", fontSize = 13.sp)
            else EpButton("撤销", { selected = session }, enabled = !s.busy)
        }
    }
    if (s.sessions.none { !it.current })
        Text("没有其他活跃会话", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    selected?.let { session ->
        AlertDialog(
            shape = RoundedCornerShape(24.dp),
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            onDismissRequest = { if (!s.busy) selected = null },
            title = { Text("撤销这个会话？") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${session.deviceLabel} 将立即退出，未保存的操作可能丢失。")
                    s.error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                EpButton("确认撤销", { c.revoke(session) }, primary = true, enabled = !s.busy)
            },
            dismissButton = { EpButton("取消", { selected = null }, enabled = !s.busy) },
        )
    }
}

@Composable
private fun PrivacySettings(account: AccountResponse, c: AccountSettingsController) {
    val s by c.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    var saving by remember { mutableStateOf(false) }
    var downloadError by remember { mutableStateOf<String?>(null) }
    val save =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/json")
        ) { uri ->
            if (uri != null)
                scope.launch {
                    saving = true
                    downloadError = null
                    try {
                        withContext(Dispatchers.IO) {
                            context.contentResolver.openOutputStream(uri)?.use { c.saveExport(it) }
                                ?: error("无法写入所选位置")
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        downloadError = (e.message ?: "下载未完成") + "。保存的文件可能不完整，请重新下载。"
                    } finally {
                        saving = false
                    }
                }
        }
    LaunchedEffect(s.completed) { if (s.completedAction == "consent") confirm = null }
    Text("模型改进", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("允许用于改进模型", Modifier.weight(1f), fontSize = 14.sp)
        Switch(account.preferences.modelImprovementAllowed, { confirm = it }, enabled = !s.busy)
    }
    Text(
        "目前不使用研究数据训练模型。此项仅记录未来可选改进计划的授权，可随时撤回。",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text("导出", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    EpButton(if (s.busy) "正在准备…" else "导出我的数据", c::requestExport, enabled = !s.busy)
    Text(
        "包含账户资料、研究任务与模型交互记录，不包含密码或会话凭据。",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    s.export?.let {
        if (it.status == "ready")
            EpButton(
                if (saving) "正在下载…" else "下载数据副本",
                { save.launch("Everplain-data-${it.exportId}.json") },
                enabled = !saving,
            )
        else Text("数据副本正在准备，请稍后重新查看。", fontSize = 13.sp)
    }
    downloadError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
    confirm?.let { allowed ->
        AlertDialog(
            shape = RoundedCornerShape(24.dp),
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            onDismissRequest = { if (!s.busy) confirm = null },
            title = { Text(if (allowed) "允许用于改进模型？" else "停止用于改进模型？") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        if (allowed) "Everplain 当前不使用你的数据训练模型。开启仅记录未来可选改进计划的授权；任何实际启用仍会另行告知。"
                        else "停止后，未来可选改进计划不再取得你的授权；研究功能所需推理不受影响。"
                    )
                    s.error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                EpButton(
                    if (allowed) "确认允许" else "确认停止",
                    {
                        c.modelConsent(
                            allowed,
                            account.preferences.version,
                            account.preferences.consentPolicyVersion,
                        )
                    },
                    primary = true,
                    enabled = !s.busy,
                )
            },
            dismissButton = { EpButton("取消", { confirm = null }, enabled = !s.busy) },
        )
    }
}

@Composable
private fun AccountStatusSettings(account: AccountResponse, c: AccountSettingsController) {
    val s by c.state.collectAsStateWithLifecycle()
    var action by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    if (account.isProtectedAdmin) {
        Text("部署管理员保护", style = MaterialTheme.typography.titleMedium)
        Text("此账户不能被降级、停用或删除。仍可更新密码与撤销其他会话。", fontSize = 14.sp)
        return
    }
    EpButton("停用账户", { action = "deactivate" }, enabled = !s.busy)
    Text(
        "退出所有设备并暂停访问。研究数据保留，管理员可在核验后恢复账户。",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    EpButton("永久删除账户", { action = "delete" }, enabled = !s.busy)
    Text(
        "永久删除账户、研究任务与个人模型交互记录。此操作无法恢复。",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    action?.let { kind ->
        val deleting = kind == "delete"
        AlertDialog(
            shape = RoundedCornerShape(24.dp),
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            onDismissRequest = {
                if (!s.busy) {
                    action = null
                    password = ""
                }
            },
            title = { Text(if (deleting) "永久删除账户？" else "停用账户？") },
            text = {
                Column(
                    Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        if (deleting) "账户、研究任务、派生文档与个人模型交互记录将被永久删除。删除后无法恢复。"
                        else "停用后你会立即退出所有设备。数据会保留，管理员可在核验后恢复访问。"
                    )
                    if (deleting)
                        EpField("账户邮箱", email, { email = it }, placeholder = account.email)
                    EpField(
                        "当前密码",
                        password,
                        { if (it.length <= 128) password = it },
                        password = true,
                    )
                    if (!deleting)
                        EpField(
                            "停用原因",
                            reason,
                            { if (it.length <= 240) reason = it },
                            multiline = true,
                            minLines = 3,
                            minHeight = 100,
                        )
                    s.error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                EpButton(
                    if (deleting) "确认永久删除" else "确认停用",
                    { if (deleting) c.delete(password, email) else c.deactivate(password, reason) },
                    primary = true,
                    enabled =
                        !s.busy &&
                            password.isNotEmpty() &&
                            if (deleting) email.trim().equals(account.email, true)
                            else reason.isNotBlank(),
                )
            },
            dismissButton = {
                EpButton(
                    "取消",
                    {
                        action = null
                        password = ""
                    },
                    enabled = !s.busy,
                )
            },
        )
    }
}

@Composable
internal fun SettingsChoice(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean = true,
    change: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            Surface(
                onClick = { open = true },
                enabled = enabled,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                modifier =
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics {
                        contentDescription = label
                    },
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        options.find { it.first == value }?.second ?: value,
                        Modifier.weight(1f),
                        fontSize = 14.sp,
                    )
                    Icon(EpIcons.ExpandMore, null, Modifier.size(16.dp))
                }
            }
            DropdownMenu(
                open,
                { open = false },
                shape = RoundedCornerShape(20.dp),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                options.forEach { (id, name) ->
                    DropdownMenuItem(
                        text = { Text(name, fontSize = 14.sp) },
                        onClick = {
                            change(id)
                            open = false
                        },
                        trailingIcon = {
                            if (value == id) Icon(EpIcons.Check, null, Modifier.size(16.dp))
                        },
                    )
                }
            }
        }
    }
}

private fun dateTime(raw: String) =
    runCatching {
            java.time.format.DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm")
                .withZone(java.time.ZoneId.systemDefault())
                .format(Instant.parse(raw))
        }
        .getOrDefault(raw)
