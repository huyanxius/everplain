package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*

/** Personal memory source structure; all records, limits and versions come from the session API. */
@Composable
internal fun MemoryScreen(controller: MemoryController, vm: AppViewModel) {
    val s by controller.state.collectAsStateWithLifecycle()
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var origin by rememberSaveable { mutableStateOf("all") }
    var oldest by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<MemoryResponse?>(null) }
    LaunchedEffect(controller) { controller.enter() }
    DisposableEffect(controller) { onDispose { controller.leave() } }
    val selected = s.items.find { it.memoryId == s.selected }
    val current = s.items.find { it.memoryId == s.editor }
    val review =
        s.editor != null &&
            s.editor != "new" &&
            (current == null || current.version != s.editorVersion)
    val bytes = s.draft.trim().toByteArray(Charsets.UTF_8).size
    val capacity = s.limits?.let { s.items.size >= it.maxEntries } ?: false
    val tooLong = s.limits?.let { bytes > it.maxContentBytes } ?: false
    val visible =
        s.items
            .filter {
                (origin == "all" || it.origin == origin) &&
                    it.content.contains(query, ignoreCase = true)
            }
            .let {
                if (oldest) it.sortedBy { r -> r.updatedAt }
                else it.sortedByDescending { r -> r.updatedAt }
            }
    if (deleting != null)
        AlertDialog(
            onDismissRequest = { if (!s.busy) deleting = null },
            title = { Text("删除记忆？") },
            text = { Text("删除这条记忆及其修改历史？原始对话仍保留。") },
            confirmButton = {
                EpButton(
                    "确认删除",
                    {
                        controller.delete(deleting!!)
                        deleting = null
                    },
                    enabled = !s.busy,
                    primary = true,
                )
            },
            dismissButton = { EpButton("取消", { deleting = null }, enabled = !s.busy) },
        )
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Agent 记住了什么", style = MaterialTheme.typography.titleLarge)
                Text(
                    "个人记忆 · ${if(s.loading)"正在读取…" else "${s.items.size} 条记忆"}${s.limits?.let { " · 上限 ${it.maxEntries} 条" }.orEmpty()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                EpButton("记忆设置", { settingsOpen = !settingsOpen })
            }
        }
        item {
            when {
                s.loading || s.overviewBusy ->
                    Text(
                        if (s.loading) "正在读取记忆…" else "Agent 正在整理记忆概览…",
                        Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                s.overview.isNotEmpty() ->
                    Text(
                        s.overview,
                        fontFamily = FontFamily.Serif,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                s.overviewError != null ->
                    Column {
                        Text(s.overviewError!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        EpButton("重新整理", controller::load, secondary = true)
                    }
                else ->
                    Text(
                        if (s.error != null) "暂时无法读取记忆。"
                        else "这里会逐渐形成 Agent 对你的了解。你可以先添加一条记忆，也可以在对话中让它记住。",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        }
        item {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                EpButton(
                    if (s.details) "收起记忆明细" else "查看记忆明细",
                    { controller.details(!s.details) },
                    secondary = true,
                )
                EpButton(
                    "添加记忆",
                    { controller.edit() },
                    enabled =
                        !s.loading &&
                            !s.busy &&
                            s.settings != null &&
                            s.limits != null &&
                            !capacity,
                    primary = true,
                )
            }
            if (capacity && !s.loading)
                Text(
                    "已达到 ${s.limits?.maxEntries ?: "…"} 条上限，可编辑已有记忆，或删除后再添加。",
                    style = MaterialTheme.typography.bodySmall,
                )
            if (s.settings?.useMemory == false)
                Text("已暂停在对话中使用个人记忆，保存的内容仍可查看。", style = MaterialTheme.typography.bodySmall)
        }
        if (settingsOpen)
            item {
                MemoryCard {
                    listOf(
                            "use" to ("使用个人记忆" to "在对话中按需参考已保存的记忆。关闭后仍然保留内容。"),
                            "learn" to ("从对话中学习" to "从对话中整理值得保留的信息。关闭后仍可手动添加。"),
                        )
                        .forEach { (field, copy) ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(20.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(copy.first, fontSize = 14.sp)
                                    Text(
                                        copy.second,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                val checked =
                                    if (field == "use") s.settings?.useMemory == true
                                    else s.settings?.learnMemory == true
                                Box(
                                    Modifier.width(44.dp)
                                        .height(36.dp)
                                        .clip(CircleShape)
                                        .background(
                                            if (checked) MaterialTheme.colorScheme.primary
                                            else MaterialTheme.colorScheme.surfaceContainerHighest
                                        )
                                        .clickable(enabled = s.settings != null && !s.busy) {
                                            controller.toggle(field)
                                        }
                                        .semantics {
                                            role = Role.Switch
                                            stateDescription = if (checked) "开启" else "关闭"
                                            contentDescription = copy.first
                                        }
                                        .padding(4.dp),
                                    contentAlignment =
                                        if (checked) Alignment.CenterEnd else Alignment.CenterStart,
                                ) {
                                    Box(
                                        Modifier.size(20.dp)
                                            .background(
                                                if (checked) MaterialTheme.colorScheme.onPrimary
                                                else MaterialTheme.colorScheme.onSurfaceVariant,
                                                CircleShape,
                                            )
                                    )
                                }
                            }
                        }
                }
            }
        s.error?.let { error ->
            item {
                Column {
                    Text(
                        error,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    EpButton(
                        "刷新记录",
                        controller::load,
                        enabled = !s.loading && !s.busy,
                        secondary = true,
                    )
                }
            }
        }
        s.notice?.let {
            item {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
        if (s.details) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    EpField(
                        "搜索记忆",
                        query,
                        { query = it },
                        showLabel = false,
                        placeholder = "搜索记忆内容",
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        MemoryChoice(
                            origin,
                            { origin = it },
                            listOf(
                                "all" to "全部来源",
                                "manual" to "手动记录",
                                "explicit" to "对话中记住",
                                "learned" to "自动整理",
                            ),
                            "记忆来源",
                            Modifier.weight(1f),
                        )
                        MemoryChoice(
                            if (oldest) "oldest" else "recent",
                            { oldest = it == "oldest" },
                            listOf("recent" to "最近更新", "oldest" to "最早更新"),
                            "记忆排序",
                            Modifier.weight(1f),
                        )
                    }
                    Text(
                        "手动添加、修改或明确要求记住的内容，后台学习不会覆盖；这不代表每轮对话都会加载全文。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (s.editor != null || selected != null)
                item {
                    MemoryCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (s.editor != null) if (s.editor == "new") "添加记忆" else "编辑记忆"
                                else "记忆详情",
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            EpIcon(
                                EpIcons.Close,
                                if (s.editor != null) "关闭编辑" else "关闭记忆详情",
                                controller::closeDetail,
                                enabled = !s.busy,
                            )
                        }
                        if (s.editor != null) {
                            EpField(
                                "希望 Agent 记住什么？",
                                s.draft,
                                controller::draft,
                                multiline = true,
                                enabled = !s.busy,
                                minHeight = 160,
                                minLines = 5,
                                monospace = false,
                                labelSize = 16f,
                                placeholder = "例如：比较不同解释时，先回到原始材料核验。",
                            )
                            Text(
                                "本条 $bytes / ${s.limits?.maxContentBytes ?: "…"} 字节（UTF-8）${if(tooLong)"，请缩短内容后保存。" else "；通常一个汉字占 3 字节。"}",
                                style = MaterialTheme.typography.bodySmall,
                                color =
                                    if (tooLong) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (review) {
                                if (current != null) {
                                    Text("最新记录 · 第 ${current.version} 版")
                                    Text(current.content)
                                    Text(
                                        "你的草稿仍保留在上方。请对照最新记录合并需要保留的内容；核对后再保存，会以草稿替换最新记录。",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    EpButton(
                                        "已核对，基于最新版本继续编辑",
                                        controller::acknowledgeVersion,
                                        secondary = true,
                                    )
                                } else Text("这条记忆已被删除。你的草稿仍保留在上方，可复制留存；不会自动重新创建。")
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                EpButton("取消", controller::cancelEditor, enabled = !s.busy)
                                EpButton(
                                    if (s.busy) "保存中…" else "保存记忆",
                                    controller::save,
                                    primary = true,
                                    enabled =
                                        !s.busy &&
                                            !s.loading &&
                                            !review &&
                                            s.limits != null &&
                                            s.draft.isNotBlank() &&
                                            !tooLong &&
                                            !(s.editor == "new" && capacity),
                                )
                            }
                        } else if (selected != null) {
                            Text(
                                selected.content,
                                style = MaterialTheme.typography.bodyLarge,
                                fontFamily = FontFamily.Serif,
                            )
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                EpButton(
                                    "编辑",
                                    { controller.edit(selected) },
                                    secondary = true,
                                    enabled = !s.busy,
                                )
                                EpButton("删除", { deleting = selected }, enabled = !s.busy)
                            }
                            listOf(
                                    listOf("范围" to "个人记忆", "来源" to memoryOrigin(selected)),
                                    listOf(
                                        "创建于" to memoryDate(selected.createdAt),
                                        "更新于" to memoryDate(selected.updatedAt),
                                    ),
                                )
                                .forEach { pair ->
                                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                        pair.forEach { (label, value) ->
                                            Column(
                                                Modifier.weight(1f),
                                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                            ) {
                                                Text(
                                                    label,
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color =
                                                        MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                                Text(
                                                    value,
                                                    style = MaterialTheme.typography.bodySmall,
                                                )
                                            }
                                        }
                                    }
                                }
                            selected.sourceQuote?.let {
                                Text("来源原话", style = MaterialTheme.typography.labelMedium)
                                Text(it, Modifier.padding(start = 12.dp))
                                selected.sourceConversationId?.let { id ->
                                    EpButton("打开来源对话", { vm.openConversation(id) })
                                }
                            }
                            EpButton(
                                "修改历史 · 最近 ${minOf(selected.version,50)} 个版本",
                                { controller.history(selected) },
                                enabled = !s.historyBusy,
                            )
                            if (s.historyBusy) Text("正在读取修改历史…")
                            s.revisions?.forEach { revision ->
                                HorizontalDivider()
                                Text(
                                    "第 ${revision.version} 版 · ${memoryDate(revision.updatedAt)} · ${memoryOrigin(revision)}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(revision.content)
                            }
                        }
                    }
                }
            items(visible, key = { it.memoryId }) { item ->
                Surface(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = !s.busy && s.editor == null) {
                            controller.select(item.memoryId)
                        }
                        .semantics { contentDescription = "查看记忆：${item.content}" },
                    shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    border =
                        if (s.selected == item.memoryId)
                            BorderStroke(2.dp, MaterialTheme.colorScheme.onSurface)
                        else null,
                ) {
                    Column(
                        Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(
                            item.content,
                            fontFamily = FontFamily.Serif,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            "${memoryOrigin(item)} · ${memoryDate(item.updatedAt)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (!s.loading && visible.isEmpty() && s.error == null)
                item {
                    Text(
                        if (query.isNotEmpty() || origin != "all") "没有匹配的记忆" else "还没有记忆",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
        }
    }
}

private fun memoryOrigin(item: MemoryResponse) =
    if (item.sourceQuote?.startsWith("引导问卷") == true) "引导问卷"
    else
        when (item.origin) {
            "manual" -> "手动记录"
            "explicit" -> "对话中记住"
            "learned" -> "自动整理"
            else -> item.origin
        }

@Composable
private fun MemoryCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

@Composable
private fun MemoryChoice(
    value: String,
    change: (String) -> Unit,
    options: List<Pair<String, String>>,
    label: String,
    modifier: Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth()
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                .clickable { open = true }
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .semantics { contentDescription = label },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                options.find { it.first == value }?.second.orEmpty(),
                Modifier.weight(1f),
                fontSize = 14.sp,
            )
            Icon(EpIcons.ExpandMore, null, Modifier.size(16.dp))
        }
        DropdownMenu(
            open,
            { open = false },
            shape = RoundedCornerShape(20.dp),
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            options.forEach { (id, title) ->
                DropdownMenuItem(
                    text = { Text(title, fontSize = 14.sp) },
                    onClick = {
                        change(id)
                        open = false
                    },
                    trailingIcon = {
                        if (id == value) Icon(EpIcons.Check, null, Modifier.size(16.dp))
                    },
                )
            }
        }
    }
}

private fun memoryDate(raw: String) =
    runCatching {
            java.time.Instant.parse(raw)
                .atZone(java.time.ZoneId.systemDefault())
                .format(java.time.format.DateTimeFormatter.ofPattern("M月d日"))
        }
        .getOrDefault(raw)
