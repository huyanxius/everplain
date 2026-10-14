package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.graphics.toColorInt
import app.everplain.core.WireJson
import kotlinx.serialization.json.*

/** Account-menu identity drawer has its own source layout; it is not the account settings grid. */
@Composable
internal fun RoleIdentityPanel(
    s: AppState,
    vm: AppViewModel,
    initialTab: String,
    close: () -> Unit,
) {
    val tabStates = rememberSaveableStateHolder()
    val p = s.profile
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var name by rememberSaveable { mutableStateOf(p?.name.orEmpty()) }
    var color by rememberSaveable { mutableStateOf(p?.color ?: "#5d8fe6") }
    var avatar by rememberSaveable { mutableStateOf(p?.avatarId ?: "cheng") }
    var style by rememberSaveable { mutableStateOf(p?.speakingStyle ?: "clear") }
    var soul by rememberSaveable { mutableStateOf(p?.soulText.orEmpty()) }
    var version by rememberSaveable { mutableLongStateOf(p?.version ?: 0) }
    var saved by rememberSaveable { mutableStateOf(false) }
    var awaitingSave by rememberSaveable { mutableStateOf(false) }
    var saveSequence by rememberSaveable { mutableLongStateOf(s.settingsSaved) }
    val context = LocalContext.current
    val defaultColors = remember {
        context.assets.open("avatars.json").bufferedReader().use {
            WireJson.parseToJsonElement(it.readText())
                .jsonObject
                .getValue("presets")
                .jsonArray
                .associate { entry ->
                    entry.jsonObject.getValue("id").jsonPrimitive.content to
                        entry.jsonObject.getValue("color").jsonPrimitive.content
                }
        }
    }
    fun reset() {
        if (p != null) {
            name = p.name
            avatar = p.avatarId
            color = p.color
            style = p.speakingStyle
            soul = p.soulText.orEmpty()
            version = p.version
            saved = false
            vm.acknowledgeConflict()
        }
    }
    LaunchedEffect(initialTab) { tab = initialTab }
    LaunchedEffect(p?.version) { if (version == 0L && p != null) reset() }
    LaunchedEffect(s.settingsSaved) {
        if (awaitingSave && s.settingsSaved > saveSequence) {
            version = p?.version ?: version
            saved = true
            awaitingSave = false
        }
        saveSequence = s.settingsSaved
    }
    Dialog(
        onDismissRequest = close,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val dialogView = LocalView.current
        SideEffect { (dialogView.parent as? DialogWindowProvider)?.window?.setDimAmount(.18f) }
        BoxWithConstraints(
            Modifier.fillMaxSize().safeDrawingPadding().imePadding(),
            contentAlignment = Alignment.BottomEnd,
        ) {
            val mobile = maxWidth < 560.dp
            Surface(
                Modifier.widthIn(max = 440.dp)
                    .fillMaxWidth()
                    .height(if (mobile) maxHeight * .94f else maxHeight - 24.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape =
                    if (mobile) RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
                    else RoundedCornerShape(28.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "我的 AI 伙伴",
                            Modifier.weight(1f),
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        EpIcon(EpIcons.Close, "关闭角色面板", close)
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier.size(64.dp)
                                .background(
                                    MaterialTheme.colorScheme.surfaceContainerLow,
                                    CircleShape,
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            AgentAvatar(avatar, color, "角色预览", 56, state = "greet")
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                name.trim().ifBlank { p?.name ?: "我的 AI 伙伴" },
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                "${s.session?.user?.displayName ?: s.session?.user?.email.orEmpty()} 的 AI 伙伴",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Row(
                        Modifier.padding(horizontal = 20.dp)
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceContainerLow, CircleShape)
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        listOf("identity" to "Soul · 人格", "memory" to "Memory · 记忆").forEach {
                            (value, label) ->
                            Box(
                                Modifier.weight(1f)
                                    .heightIn(min = 40.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (tab == value)
                                            MaterialTheme.colorScheme.surfaceContainerHigh
                                        else Color.Transparent
                                    )
                                    .clickable { tab = value }
                                    .semantics {
                                        role = Role.Tab
                                        selected = tab == value
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(
                                        if (value == "identity") EpIcons.Fingerprint
                                        else EpIcons.Brain,
                                        null,
                                        Modifier.size(18.dp),
                                    )
                                    Text(
                                        label,
                                        fontSize = 14.sp,
                                        color =
                                            if (tab == value) MaterialTheme.colorScheme.onSurface
                                            else MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Box(Modifier.weight(1f)) {
                        if (tab == "memory")
                            tabStates.SaveableStateProvider("memory") {
                                MemoryScreen(vm.memory(), vm)
                            }
                        else if (p == null)
                            Column(Modifier.padding(20.dp)) {
                                Text(if (s.error == null) "正在读取角色身份…" else "暂时无法读取角色身份。")
                                EpButton("重试", vm::refresh)
                            }
                        else
                            LazyColumn(
                                contentPadding =
                                    PaddingValues(
                                        start = 20.dp,
                                        end = 20.dp,
                                        bottom = 20.dp,
                                        top = 4.dp,
                                    ),
                                verticalArrangement = Arrangement.spacedBy(16.dp),
                            ) {
                                item {
                                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("角色形象", fontSize = 14.sp)
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            avatarNames.forEach { (id, label) ->
                                                Column(
                                                    Modifier.weight(1f)
                                                        .clip(RoundedCornerShape(12.dp))
                                                        .border(
                                                            1.dp,
                                                            if (id == avatar)
                                                                MaterialTheme.colorScheme.outline
                                                            else Color.Transparent,
                                                            RoundedCornerShape(12.dp),
                                                        )
                                                        .background(
                                                            if (id == avatar)
                                                                MaterialTheme.colorScheme
                                                                    .surfaceContainerLow
                                                            else Color.Transparent
                                                        )
                                                        .clickable(enabled = !s.busy) {
                                                            avatar = id
                                                            color = defaultColors.getValue(id)
                                                            saved = false
                                                        }
                                                        .semantics {
                                                            contentDescription = label
                                                            selected = id == avatar
                                                        }
                                                        .padding(vertical = 8.dp),
                                                    horizontalAlignment =
                                                        Alignment.CenterHorizontally,
                                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                                ) {
                                                    AgentAvatar(
                                                        id,
                                                        if (id == avatar) color
                                                        else defaultColors[id],
                                                        label,
                                                        36,
                                                        playing = false,
                                                        decorative = true,
                                                    )
                                                    Text(
                                                        label,
                                                        fontSize = 13.sp,
                                                        color =
                                                            if (id == avatar)
                                                                MaterialTheme.colorScheme.onSurface
                                                            else
                                                                MaterialTheme.colorScheme
                                                                    .onSurfaceVariant,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                                item {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("角色颜色", fontSize = 14.sp)
                                        FlowRow(
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            listOf(
                                                    "#5d8fe6",
                                                    "#ec8a52",
                                                    "#3fae9c",
                                                    "#e55f6f",
                                                    "#de6aa5",
                                                    "#9a80e0",
                                                    "#eeb146",
                                                    "#3d3d3a",
                                                )
                                                .forEach { value ->
                                                    Box(
                                                        Modifier.size(36.dp)
                                                            .clip(CircleShape)
                                                            .border(
                                                                1.dp,
                                                                if (color.equals(value, true))
                                                                    MaterialTheme.colorScheme
                                                                        .onSurface
                                                                else Color.Transparent,
                                                                CircleShape,
                                                            )
                                                            .clickable(enabled = !s.busy) {
                                                                color = value
                                                                saved = false
                                                            }
                                                            .semantics {
                                                                contentDescription = "颜色 $value"
                                                                selected = color.equals(value, true)
                                                            },
                                                        contentAlignment = Alignment.Center,
                                                    ) {
                                                        Box(
                                                            Modifier.size(24.dp)
                                                                .background(
                                                                    Color(value.toColorInt()),
                                                                    CircleShape,
                                                                )
                                                        )
                                                    }
                                                }
                                        }
                                    }
                                }
                                item {
                                    EpField(
                                        "名字",
                                        name,
                                        {
                                            name = it.take(40)
                                            saved = false
                                        },
                                        enabled = !s.busy,
                                    )
                                }
                                item {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("说话方式", fontSize = 14.sp)
                                        listOf(
                                                "clear" to "清晰直接",
                                                "warm" to "温和自然",
                                                "rigorous" to "严谨细致",
                                                "curious" to "好奇开放",
                                            )
                                            .chunked(2)
                                            .forEach { pair ->
                                                Row(
                                                    horizontalArrangement =
                                                        Arrangement.spacedBy(8.dp)
                                                ) {
                                                    pair.forEach { (id, label) ->
                                                        Surface(
                                                            Modifier.weight(1f)
                                                                .clip(CircleShape)
                                                                .clickable(enabled = !s.busy) {
                                                                    style = id
                                                                    saved = false
                                                                },
                                                            shape = CircleShape,
                                                            color =
                                                                if (style == id)
                                                                    MaterialTheme.colorScheme
                                                                        .primaryContainer
                                                                else
                                                                    MaterialTheme.colorScheme
                                                                        .surfaceContainerHigh,
                                                            border =
                                                                BorderStroke(
                                                                    1.dp,
                                                                    if (style == id)
                                                                        MaterialTheme.colorScheme
                                                                            .onSurface
                                                                    else
                                                                        MaterialTheme.colorScheme
                                                                            .outline,
                                                                ),
                                                        ) {
                                                            Box(
                                                                Modifier.heightIn(min = 44.dp)
                                                                    .padding(
                                                                        horizontal = 16.dp,
                                                                        vertical = 10.dp,
                                                                    )
                                                                    .semantics {
                                                                        selected = style == id
                                                                    },
                                                                contentAlignment = Alignment.Center,
                                                            ) {
                                                                Text(
                                                                    label,
                                                                    fontSize = 14.sp,
                                                                    fontWeight = FontWeight(550),
                                                                )
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                    }
                                }
                                item {
                                    EpField(
                                        "人格描述（Markdown）",
                                        soul,
                                        {
                                            soul = it.take(8000)
                                            saved = false
                                        },
                                        minHeight = 180,
                                        multiline = true,
                                        enabled = !s.busy,
                                    )
                                }
                                item {
                                    Text(
                                        "用自己的话写身份、交流方式、偏好与边界。支持 Markdown；上面的风格只是起点。",
                                        fontSize = 13.sp,
                                        lineHeight = 19.5.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                item { EpButton("取消修改", ::reset, enabled = !s.busy) }
                                if (s.settingsConflict)
                                    item {
                                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Text("另一处已保存了新版本。你的草稿仍在编辑框内，先核对下面的最新档案。")
                                            Text("${p.name} · ${p.speakingStyle}")
                                            Text(p.soulText.orEmpty())
                                            if (!s.settingsConflictReady)
                                                EpButton("重新读取最新设置", vm::refresh, enabled = !s.busy)
                                            EpButton(
                                                "保留我的修改继续编辑",
                                                {
                                                    version = p.version
                                                    vm.acknowledgeConflict()
                                                },
                                                enabled = s.settingsConflictReady,
                                            )
                                        }
                                    }
                                s.error?.let {
                                    item {
                                        Text(
                                            it,
                                            color = MaterialTheme.colorScheme.error,
                                            modifier =
                                                Modifier.semantics {
                                                    liveRegion = LiveRegionMode.Polite
                                                },
                                        )
                                    }
                                }
                            }
                    }
                    if (tab == "identity" && p != null) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                if (saved) "已保存" else "关闭后保留草稿",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            EpButton(
                                if (s.busy) "正在保存…" else "保存角色",
                                {
                                    awaitingSave = true
                                    saveSequence = s.settingsSaved
                                    vm.saveProfile(name, style, soul, avatar, color, version)
                                },
                                primary = true,
                                enabled = !s.busy && !s.settingsConflict && name.isNotBlank(),
                            )
                        }
                    }
                }
            }
        }
    }
}
