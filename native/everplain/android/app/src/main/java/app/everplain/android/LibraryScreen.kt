@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.everplain.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

@Composable
internal fun LibraryScreen(controller: LibraryController, origin: String, openGraph: () -> Unit) {
    val s by controller.state.collectAsStateWithLifecycle()
    var scopeOpen by remember { mutableStateOf(false) }
    var managing by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("") }
    var edit by rememberSaveable { mutableStateOf<String?>(null) }
    var add by rememberSaveable { mutableStateOf<String?>(null) }
    var sharing by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<LibraryMaterial?>(null) }
    var deleteLibrary by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    var sourceTarget by remember { mutableStateOf<LibraryMaterial?>(null) }
    FeatureVisibility(controller, controller::enter, controller::leave)
    BackHandler(s.source != null || s.sourceBusy || s.sourceError != null) {
        controller.closeSource()
        sourceTarget = null
    }
    val readonly = s.selected?.viewerAccess?.let { it != "owner" } ?: false
    val search = query.trim()
    val materials =
        s.materials.filter {
            (kind.isEmpty() || materialKind(it.document) == kind) &&
                (search.isEmpty() ||
                    "${it.document.filename} ${it.document.knowledge?.summary.orEmpty()} ${it.document.knowledge?.topics?.joinToString { topic -> "${topic.title} ${topic.summary}" }.orEmpty()} ${it.library.name.orEmpty()}"
                        .contains(search, true))
        }
    if (edit != null) LibraryEditSheet(s, controller, edit!!) { edit = null }
    if (add != null) LibraryImportSheet(controller, add!!) { add = null }
    if (sharing) LibrarySharingSheet(s, controller, origin) { sharing = false }
    if (s.source != null || s.sourceBusy || s.sourceError != null)
        LibrarySourceSheet(
            s,
            {
                controller.closeSource()
                sourceTarget = null
            },
        ) {
            sourceTarget?.let { controller.source(it.library.id, it.document.id) }
        }
    if (deleteLibrary && s.selected != null)
        AlertDialog(
            onDismissRequest = { if (!s.busy) deleteLibrary = false },
            title = { Text("删除知识库？") },
            text = { Text("此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。") },
            confirmButton = {
                EpButton(
                    "确认删除",
                    {
                        controller.deleteLibrary(s.selected!!.id)
                        deleteLibrary = false
                    },
                    primary = true,
                    enabled = !s.busy,
                )
            },
            dismissButton = { EpButton("保留知识库", { deleteLibrary = false }, enabled = !s.busy) },
        )
    deleting?.let { material ->
        AlertDialog(
            onDismissRequest = { if (!s.busy) deleting = null },
            title = { Text("删除资料？") },
            text = { Text("删除“${material.document.filename}”及其知识与索引？此操作无法撤销。") },
            confirmButton = {
                EpButton(
                    "确认删除资料",
                    {
                        controller.detach(material.library.id, material.document.id)
                        deleting = null
                    },
                    primary = true,
                    enabled = !s.busy,
                )
            },
            dismissButton = { EpButton("保留资料", { deleting = null }, enabled = !s.busy) },
        )
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding =
            PaddingValues(if (LocalConfiguration.current.screenWidthDp <= 720) 16.dp else 32.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        Row(
                            Modifier.clip(RoundedCornerShape(12.dp))
                                .clickable { scopeOpen = true }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                s.selected?.name ?: "全部资料",
                                style = MaterialTheme.typography.headlineSmall,
                                maxLines = 2,
                                modifier = Modifier.weight(1f, false),
                            )
                            Icon(EpIcons.ExpandMore, null, Modifier.size(18.dp))
                        }
                        DropdownMenu(
                            scopeOpen,
                            { scopeOpen = false },
                            shape = RoundedCornerShape(20.dp),
                            containerColor = MaterialTheme.colorScheme.surface,
                        ) {
                            DropdownMenuItem(
                                text = { Text("全部资料") },
                                onClick = {
                                    controller.select(null)
                                    scopeOpen = false
                                    managing = false
                                },
                            )
                            if (s.owned.isNotEmpty())
                                Text(
                                    "我的",
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 12.sp,
                                )
                            s.owned.forEach { library ->
                                DropdownMenuItem(
                                    text = { Text(library.name.orEmpty()) },
                                    onClick = {
                                        controller.select(library.id)
                                        scopeOpen = false
                                        managing = false
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("管理知识库") },
                                onClick = {
                                    controller.select(null)
                                    managing = true
                                    scopeOpen = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("新建知识库") },
                                onClick = {
                                    edit = "new"
                                    scopeOpen = false
                                },
                                enabled = !s.busy,
                            )
                            val shared = s.libraries.filter { it.viewerAccess != "owner" }
                            if (shared.isNotEmpty())
                                Text(
                                    "共享给我的",
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 12.sp,
                                )
                            shared.forEach { library ->
                                DropdownMenuItem(
                                    text = { Text(library.name.orEmpty()) },
                                    onClick = {
                                        controller.select(library.id)
                                        scopeOpen = false
                                        managing = false
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("用邀请链接加入") },
                                onClick = {
                                    sharing = true
                                    scopeOpen = false
                                },
                            )
                            Text(
                                s.storage?.let {
                                    "${formatLibrarySize(it.usedBytes)} / ${formatLibrarySize(it.maxBytes)} · ${it.libraryCount}/${it.maxLibraries} 个知识库"
                                } ?: "存储用量暂不可用",
                                Modifier.padding(16.dp),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (!readonly) {
                        EpButton(
                            "添加",
                            { add = "extension" },
                            primary = true,
                            enabled = !s.busy && !s.unresolved,
                        )
                        if (s.selected != null)
                            Box {
                                EpIcon(EpIcons.MoreHoriz, "知识库选项", { options = true })
                                DropdownMenu(
                                    options,
                                    { options = false },
                                    shape = RoundedCornerShape(20.dp),
                                    containerColor = MaterialTheme.colorScheme.surface,
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("编辑名称与说明") },
                                        onClick = {
                                            edit = s.selectedId
                                            options = false
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("删除知识库") },
                                        onClick = {
                                            deleteLibrary = true
                                            options = false
                                        },
                                    )
                                }
                            }
                    }
                }
                s.selected?.let { library ->
                    Text(
                        library.description?.takeIf { it.isNotBlank() }
                            ?: if (readonly) "只读知识库" else "只有你可以访问这个知识库。",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EpButton(if (readonly) "共享与邀请" else "共享", { sharing = true })
                }
                if (!readonly) KnowledgeViewSwitch(false, {}, openGraph)
                EpField(
                    if (managing) "搜索知识库" else "搜索资料",
                    query,
                    { query = it },
                    showLabel = false,
                    placeholder = if (managing) "搜索名称或说明" else "搜标题、摘要、知识点",
                )
                if (managing) EpButton("返回资料", { managing = false })
                if (!managing && s.materials.isNotEmpty())
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        EpButton("全部 ${s.materials.size}", { kind = "" }, selected = kind.isEmpty())
                        s.materials
                            .map { materialKind(it.document) }
                            .distinct()
                            .forEach { type ->
                                EpButton(
                                    type,
                                    { kind = if (kind == type) "" else type },
                                    selected = kind == type,
                                )
                            }
                    }
            }
        }
        if (s.error != null) item { LibraryNotice(s.error!!, true, "重新加载") { controller.load() } }
        if (s.catalogError != null)
            item { LibraryNotice(s.catalogError!!, true, "重试读取资料") { controller.load() } }
        if (s.notice != null) item { LibraryNotice(s.notice!!, false) }
        if (s.unresolved)
            item {
                FlowRow {
                    EpButton("重新读取", { controller.load() }, enabled = !s.busy)
                    EpButton("使用原请求重试", controller::retryOriginal, enabled = !s.busy)
                }
            }
        if (s.loading) item { AgentLiquid(label = "正在读取知识库…") }
        else if (managing && s.selected == null) {
            val libraries = s.owned.filter { "${it.name} ${it.description}".contains(search, true) }
            items(libraries, key = { it.id }) { library ->
                LibraryCard {
                    Text(
                        "私有 · ${library.documents?.size?.toLong() ?: library.readyDocumentCount ?: 0} 份资料",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(library.name.orEmpty(), style = MaterialTheme.typography.titleLarge)
                    Text(
                        library.description?.takeIf { it.isNotBlank() } ?: "你的资料与研究依据",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EpButton(
                        "打开知识库",
                        {
                            controller.select(library.id)
                            managing = false
                        },
                    )
                }
            }
            if (libraries.isEmpty())
                item {
                    LibraryEmpty(if (search.isNotEmpty()) "没有找到相关知识库" else "创建你的第一个知识库", "") {
                        EpButton("新建知识库", { edit = "new" }, secondary = true)
                    }
                }
        } else {
            val pending = s.materials.count { isMaterialProcessing(it.document) }
            if (pending > 0)
                item {
                    LibraryNotice("$pending 份资料正在解析、整理知识或建立语义索引。", false, "导入记录") {
                        add = "records"
                    }
                }
            items(materials, key = { "${it.library.id}:${it.document.id}" }) { material ->
                LibraryMaterialCard(
                    material,
                    controller,
                    s.selected == null,
                    s.busy || s.unresolved,
                    open = {
                        sourceTarget = material
                        controller.source(material.library.id, material.document.id)
                    },
                    select = { controller.select(material.library.id) },
                    retry = { controller.organize(material.library.id, material.document.id) },
                    delete = { deleting = material },
                    upload = {
                        controller.select(material.library.id)
                        add = "file"
                    },
                )
            }
            if (materials.isEmpty() && s.error == null && !s.loading)
                item {
                    val filtered = search.isNotEmpty() || kind.isNotEmpty()
                    LibraryEmpty(
                        if (filtered) "没有找到相关资料"
                        else if (s.owned.isEmpty() && !readonly) "创建你的第一个知识库" else "把第一份资料，放进来。",
                        if (filtered) "换个关键词，或调整筛选条件。"
                        else if (s.selected != null) "在这里上传的文件只属于这个库。从其他应用导入的资料会统一放进「我的资料」。"
                        else "收藏、笔记和文档会汇集在这里，保留原文与知识点。",
                    ) {
                        if (filtered)
                            EpButton(
                                "清除搜索和筛选",
                                {
                                    query = ""
                                    kind = ""
                                },
                                secondary = true,
                            )
                        else if (!readonly) {
                            EpButton(
                                "上传文件",
                                { add = "file" },
                                primary = s.selected != null,
                                secondary = s.selected == null,
                            )
                            if (s.selected == null) {
                                EpButton("导入浏览器收藏", { add = "chrome" }, secondary = true)
                                EpButton("导入 Obsidian", { add = "obsidian" }, secondary = true)
                                EpButton("还支持印象笔记、Notion、flomo、B 站收藏等 →", { add = "extension" })
                                EpButton(
                                    "新建知识库",
                                    { edit = "new" },
                                    enabled =
                                        s.storage?.let { s.owned.size < it.maxLibraries } ?: false,
                                )
                            }
                        }
                    }
                }
        }
    }
}

@Composable
private fun LibraryMaterialCard(
    material: LibraryMaterial,
    controller: LibraryController,
    showLibrary: Boolean,
    busy: Boolean,
    open: () -> Unit,
    select: () -> Unit,
    retry: () -> Unit,
    delete: () -> Unit,
    upload: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val d = material.document
    val readonly = material.library.viewerAccess != "owner"
    val kind = materialKind(d)
    val retryable =
        d.status == "ready" && (d.knowledgeStatus == "failed" || d.indexStatus == "failed")
    val states = buildList {
        if (d.status == "processing") add("正在解析，完成后即可阅读原文")
        else if (d.status == "failed") add("解析失败")
        else {
            mapOf("queued" to "等待知识整理", "running" to "知识整理中", "failed" to "知识整理失败")[
                    d.knowledgeStatus]
                ?.let(::add)
            mapOf("queued" to "等待语义索引", "running" to "建立语义索引中", "failed" to "语义索引失败")[d.indexStatus]
                ?.let(::add)
        }
    }
    LibraryCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                when (kind) {
                    "图片" -> EpIcons.Image
                    "演示文稿" -> EpIcons.Presentation
                    else -> EpIcons.FileText
                },
                null,
                Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(kind, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            if (showLibrary)
                Text(
                    material.library.name.orEmpty(),
                    Modifier.clickable(onClick = select),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            if (!readonly)
                Box {
                    EpIcon(
                        EpIcons.MoreHoriz,
                        "管理资料 ${d.filename}",
                        { menu = true },
                        enabled = !busy,
                    )
                    DropdownMenu(
                        menu,
                        { menu = false },
                        shape = RoundedCornerShape(20.dp),
                        containerColor = MaterialTheme.colorScheme.surface,
                    ) {
                        if (retryable)
                            DropdownMenuItem(
                                text = { Text("重试处理") },
                                onClick = {
                                    menu = false
                                    retry()
                                },
                            )
                        if (d.status == "failed")
                            DropdownMenuItem(
                                text = { Text("重新上传") },
                                onClick = {
                                    menu = false
                                    upload()
                                },
                            )
                        DropdownMenuItem(
                            text = { Text("删除资料") },
                            onClick = {
                                menu = false
                                delete()
                            },
                        )
                    }
                }
        }
        if (kind == "图片") NativeLibraryImage(controller, material.library.id, d.id, d.filename)
        Text(
            d.filename,
            Modifier.then(
                if (d.status == "ready") Modifier.clickable(onClick = open) else Modifier
            ),
            style = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Serif),
        )
        if (d.status == "processing")
            Text("正在读取内容…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else
            Text(
                if (d.status == "failed") "资料解析失败，可查看原因后重新上传。"
                else d.knowledge?.summary?.takeIf { it.isNotBlank() } ?: "原文已保存，知识摘要将在整理完成后显示。",
                fontFamily = FontFamily.Serif,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        if (states.isNotEmpty()) {
            val errors = listOfNotNull(d.errorMessage, d.knowledgeError, d.indexError)
            Text(
                states.joinToString(" · ") +
                    if (errors.isEmpty()) "" else "：${errors.joinToString("；")}",
                fontSize = 13.sp,
                color =
                    if (retryable || d.status == "failed") MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!readonly && retryable) EpButton("重试", retry, enabled = !busy)
        }
        if (!showLibrary)
            d.warnings.orEmpty().forEach {
                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        Text(
            librarySourceLabel(controller.state.value, material) +
                (d.knowledge?.let { " · ${it.topics.size} 个知识点" } ?: ""),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun LibraryCard(content: @Composable ColumnScope.() -> Unit) {
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    Surface(
        shape = RoundedCornerShape(EverplainTokens.radiusCard.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier =
            Modifier.fillMaxWidth()
                .webShadow(EverplainTokens.shadowCard(dark), EverplainTokens.radiusCard.dp),
    ) {
        Column(
            Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

@Composable
internal fun LibraryNotice(
    text: String,
    error: Boolean = false,
    action: String? = null,
    onClick: () -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text,
            color =
                if (error) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 14.sp,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (action != null) EpButton(action, onClick)
    }
}

@Composable
private fun LibraryEmpty(
    title: String,
    detail: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            EpIcons.Books,
            null,
            Modifier.size(32.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (detail.isNotBlank())
            Text(detail, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

@Composable
internal fun LibrarySheet(
    title: String,
    onClose: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onClose,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.94f).imePadding()) {
            Row(
                Modifier.fillMaxWidth()
                    .padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                EpIcon(EpIcons.Close, "关闭$title", onClose)
            }
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                content = content,
            )
        }
    }
}

@Composable
private fun LibraryEditSheet(
    s: LibraryUiState,
    controller: LibraryController,
    id: String,
    onClose: () -> Unit,
) {
    val current = s.libraries.firstOrNull { it.id == id }
    var name by rememberSaveable(id) { mutableStateOf(current?.name.orEmpty()) }
    var description by rememberSaveable(id) { mutableStateOf(current?.description.orEmpty()) }
    var submitted by remember { mutableStateOf(false) }
    val base = remember { s.saved }
    LaunchedEffect(s.saved) { if (submitted && s.saved > base) onClose() }
    LibrarySheet(if (id == "new") "新建知识库" else "编辑知识库", { if (!s.busy) onClose() }) {
        EpField("知识库名称", name, { if (it.length <= 100) name = it }, enabled = !s.busy)
        EpField(
            "说明（选填）",
            description,
            { if (it.length <= 1000) description = it },
            multiline = true,
            minLines = 3,
            monospace = false,
            placeholder = "这些资料围绕什么主题？",
            enabled = !s.busy,
        )
        if (s.error != null) LibraryNotice(s.error, true)
        Row {
            EpButton(
                "保存知识库",
                {
                    submitted = true
                    controller.saveLibrary(id.takeUnless { it == "new" }, name, description)
                },
                primary = true,
                enabled = !s.busy && !s.unresolved && name.isNotBlank(),
            )
            EpButton("取消", onClose, enabled = !s.busy)
        }
    }
}

@Composable
internal fun LibrarySourceSheet(s: LibraryUiState, onClose: () -> Unit, retry: () -> Unit) {
    LibrarySheet(s.source?.document?.filename ?: "原文", onClose) {
        if (s.sourceBusy) AgentLiquid(label = "正在读取原文")
        s.sourceError?.let { LibraryNotice(it, true, "重试", retry) }
        s.source?.let { source ->
            Text(
                source.knowledgeBaseName,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SelectionContainer {
                Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    source.segments
                        .sortedBy { it.ordinal }
                        .forEach { segment -> NativeMarkdown(segment.text) }
                    if (source.segments.isEmpty())
                        Text("此资料暂无可读取的原文。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun LibrarySharingSheet(
    s: LibraryUiState,
    controller: LibraryController,
    origin: String,
    onClose: () -> Unit,
) {
    var token by rememberSaveable { mutableStateOf("") }
    var publishing by rememberSaveable { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf<String?>(null) }
    LibrarySheet("共享知识库", onClose) {
        Text("资料默认私有。只读邀请与公开发布可以分别管理。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("收到一份邀请？", style = MaterialTheme.typography.titleLarge)
        Text(
            "加入后可以阅读对方共享的资料。",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        EpField("邀请链接或口令", token, { token = it }, showLabel = false, placeholder = "粘贴邀请链接或口令")
        EpButton(
            "加入",
            {
                val value =
                    runCatching {
                            URI(token.trim())
                                .rawQuery
                                ?.split('&')
                                ?.firstOrNull { it.startsWith("invite=") }
                                ?.substringAfter('=')
                                ?.let { URLDecoder.decode(it, "UTF-8") }
                        }
                        .getOrNull() ?: token.trim()
                controller.join(value)
            },
            primary = true,
            enabled = !s.busy && !s.unresolved && token.isNotBlank(),
        )
        if (s.error != null) LibraryNotice(s.error, true)
        Text("我的共享与邀请", style = MaterialTheme.typography.titleLarge)
        s.libraries.forEach { library ->
            LibraryCard {
                Text(
                    if (library.viewerAccess == "owner") "我拥有的知识库" else "加入的只读知识库",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(library.name.orEmpty(), style = MaterialTheme.typography.titleLarge)
                library.description?.takeIf { it.isNotBlank() }?.let { Text(it) }
                Text(
                    "${library.readyDocumentCount ?: 0} 份可读资料",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (library.viewerAccess == "owner") {
                    Text(
                        "只读邀请${if(library.sharingEnabled==true)"已开启" else "未开启"}",
                        fontSize = 13.sp,
                    )
                    EpButton(
                        if (library.sharingEnabled == true) "关闭邀请共享" else "开启只读邀请",
                        { controller.sharing(library.id, library.sharingEnabled != true) },
                        enabled = !s.busy && !s.unresolved,
                    )
                    if (library.sharingEnabled == true && library.shareToken != null) {
                        Text(
                            "持有此链接并登录的人可加入，只能阅读。关闭共享会撤销成员访问和旧邀请。",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        EpButton(
                            if (copied == library.id) "已复制邀请链接" else "复制邀请链接",
                            {
                                clipboard.setText(
                                    AnnotatedString(
                                        "${origin.trimEnd('/')}/sharing?invite=${URLEncoder.encode(library.shareToken,"UTF-8")}"
                                    )
                                )
                                copied = library.id
                            },
                            secondary = true,
                        )
                    }
                    if (library.publication != null) {
                        Text("已公开 ${library.publication!!.documentCount} 份资料", fontSize = 13.sp)
                        EpButton(
                            "撤回公开",
                            { controller.unpublish(library.id) },
                            enabled = !s.busy && !s.unresolved,
                        )
                    } else
                        EpButton(
                            "发布到公共主题",
                            { publishing = library.id },
                            enabled = !s.busy && !s.unresolved,
                        )
                } else
                    Row {
                        EpButton(
                            "打开",
                            {
                                controller.select(library.id)
                                onClose()
                            },
                            secondary = true,
                        )
                        EpButton(
                            "退出知识库",
                            { controller.leaveShared(library.id) },
                            enabled = !s.busy && !s.unresolved,
                        )
                    }
            }
        }
    }
    publishing?.let { id ->
        val library = s.libraries.firstOrNull { it.id == id } ?: return@let
        var title by rememberSaveable(id) { mutableStateOf(library.name.orEmpty()) }
        var description by rememberSaveable(id) { mutableStateOf(library.description.orEmpty()) }
        var topics by rememberSaveable(id) { mutableStateOf("") }
        var confirmed by rememberSaveable(id) { mutableStateOf(false) }
        val base = remember(id) { s.saved }
        var sent by remember(id) { mutableStateOf(false) }
        LaunchedEffect(s.saved) { if (sent && s.saved > base) publishing = null }
        LibrarySheet("发布到公共主题", { if (!s.busy) publishing = null }) {
            EpField("公共标题", title, { if (it.length <= 100) title = it })
            EpField(
                "主题简介",
                description,
                { if (it.length <= 1000) description = it },
                multiline = true,
                minLines = 3,
                monospace = false,
            )
            EpField("主题标签", topics, { topics = it }, placeholder = "用顿号分隔，最多 12 个")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(confirmed, { confirmed = it })
                Text(
                    "我确认将当前 ${library.readyDocumentCount ?: 0} 份可读资料及原文公开，任何人都可阅读。以后新增的资料不会自动公开。",
                    fontSize = 14.sp,
                )
            }
            s.error?.let { LibraryNotice(it, true) }
            val tags = topics.split('、', ',', '，').map { it.trim() }.filter { it.isNotEmpty() }
            EpButton(
                if (s.busy) "正在公开…" else "确认公开当前资料",
                {
                    sent = true
                    controller.publish(id, title, description, tags, confirmed)
                },
                primary = true,
                enabled =
                    !s.busy && confirmed && !s.unresolved && title.isNotBlank() && tags.size <= 12,
            )
            EpButton("取消", { publishing = null }, enabled = !s.busy)
        }
    }
}

internal fun formatLibrarySize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val (divisor, unit) =
        when {
            bytes >= 1024L * 1024 * 1024 -> 1024L * 1024 * 1024 to "GB"
            bytes >= 1024L * 1024 -> 1024L * 1024 to "MB"
            else -> 1024L to "KB"
        }
    return "${String.format(Locale.ROOT,"%.1f",bytes.toDouble()/divisor).removeSuffix(".0")} $unit"
}

private fun librarySourceLabel(state: LibraryUiState, material: LibraryMaterial): String {
    val id = material.document.id
    val batch =
        state.imports.lastOrNull {
            it.libraryId == material.library.id && it.items.any { item -> item.documentId == id }
        }
    val item = batch?.items?.lastOrNull { it.documentId == id }
    val url = state.imageSources["${material.library.id}:$id"]?.sourceUrl ?: item?.sourceUrl
    val host =
        url?.let { runCatching { java.net.URI(it) }.getOrNull() }
            ?.takeIf { it.scheme in setOf("http", "https") }
            ?.host
    if (!host.isNullOrBlank()) return host.removePrefix("www.")
    val sourceNames =
        mapOf(
            "chrome" to "浏览器收藏",
            "obsidian" to "Obsidian",
            "markdown" to "Markdown",
            "apple_notes" to "Apple 备忘录",
            "enex" to "印象笔记",
            "notion" to "Notion",
            "flomo" to "flomo",
            "keep" to "Google Keep",
            "bilibili" to "B 站收藏",
            "image" to "图片与截图",
        )
    return sourceNames[batch?.sourceType] ?: formatLibrarySize(material.document.sizeBytes)
}
