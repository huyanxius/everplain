package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun ResearchHubScreen(s: AppState, vm: AppViewModel) {
    val controller = vm.research()
    val r by controller.state.collectAsStateWithLifecycle()
    val materials = vm.materials()
    val files by materials.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var fileQuery by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("all") }
    var owner by rememberSaveable { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf("updated") }
    var choosing by remember { mutableStateOf(false) }
    var uploadProject by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<ResearchMaterialResponse?>(null) }
    val (upload, preparing) =
        rememberMaterialUpload(
            materials,
            files.uploading || files.unresolved,
            attachToComposer = false,
        )
    FeatureVisibility(controller, controller::enter, controller::leave)
    LaunchedEffect(r.selectedId, r.projects) {
        uploadProject = r.selectedId ?: uploadProject ?: r.projects.firstOrNull()?.taskId
    }
    LaunchedEffect(uploadProject) {
        materials.bind("project-files:${uploadProject ?: "new"}", null, uploadProject)
    }
    LaunchedEffect(files.saved) { if (files.saved > 0) controller.load() }
    if (files.selected != null) MaterialReader(materials, files)
    deleting?.let { file ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除文件？") },
            text = { Text("删除“${file.filename}”的原文与解析结果？此操作无法撤销。") },
            confirmButton = {
                EpButton(
                    "确认删除",
                    {
                        materials.delete(file)
                        deleting = null
                    },
                    primary = true,
                )
            },
            dismissButton = { EpButton("保留文件", { deleting = null }) },
        )
    }
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (r.selectedId != null) EpButton("研究", { controller.select(null) })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    r.selected?.let(::researchTitle) ?: "研究",
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.headlineSmall,
                )
                if (r.selected != null)
                    EpButton("继续研究", { vm.openResearch(r.selected!!) }, secondary = true)
                else EpButton("新建研究", vm::newResearch, primary = true)
            }
            r.selected?.let {
                ResearchStageBar(it)
                Text(
                    researchFileCount(r, it.taskId),
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val tabs =
                if (r.selected != null) listOf("files" to "研究材料", "memory" to "项目记忆")
                else listOf("projects" to "研究项目", "files" to "全部文件", "memory" to "个人记忆")
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                tabs.forEach { (id, label) ->
                    EpButton(
                        label,
                        { controller.tab(id) },
                        selected = r.tab == id,
                        modifier =
                            Modifier.semantics {
                                role = Role.Tab
                                selected = r.tab == id
                            },
                    )
                }
            }
        }
        if (r.tab == "memory") {
            MemoryScreen(r.selectedId?.let { vm.projectMemory(it) } ?: vm.memory(), vm)
            return@Column
        }
        Column(
            Modifier.weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            r.error?.let { LibraryNotice(it, true, "重新读取研究") { controller.load() } }
            if (r.loading) AgentLiquid(label = "正在读取研究项目…")
            if (r.tab == "projects") {
                EpField("搜索研究项目", query, { query = it }, showLabel = false, placeholder = "搜索研究")
                val projects = r.projects.filter { researchTitle(it).contains(query.trim(), true) }
                if (!r.loading && projects.isEmpty() && r.error == null)
                    Column(
                        Modifier.padding(vertical = 36.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            if (query.isBlank()) "开始你的第一项研究" else "没有找到这个项目",
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(
                            if (query.isBlank()) "从一个问题或一份材料开始。" else "换一个项目名称试试。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                projects.forEach { item ->
                    Box(
                        Modifier.clickable {
                            controller.select(item.taskId)
                            fileQuery = ""
                            category = "all"
                        }
                    ) {
                        LibraryCard {
                            ResearchStageBar(item)
                            Text(researchTitle(item), style = MaterialTheme.typography.titleLarge)
                            Text(
                                item.phenomenonSummary?.phenomenon?.takeUnless {
                                    it == "尚未确认现象" || it == researchTitle(item)
                                } ?: item.nextActionLabel.ifBlank { "从一个问题开始，逐步整理研究。" },
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "${researchFileCount(r,item.taskId)} · ${researchDate(item.updatedAt)}",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Surface(
                    onClick = vm::newResearch,
                    shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp),
                ) {
                    Column(
                        Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(EpIcons.Add, null, Modifier.size(24.dp))
                        Text("从一个问题开始", style = MaterialTheme.typography.titleMedium)
                    }
                }
                if (r.nextCursor != null) EpButton("加载更多研究", { controller.load(more = true) })
            } else {
                EpField(
                    "搜索研究材料",
                    fileQuery,
                    { fileQuery = it },
                    showLabel = false,
                    placeholder = if (r.selected != null) "搜索项目内的材料" else "搜索文件或研究名称",
                )
                Box {
                    EpButton(
                        if (files.uploading || preparing) "正在导入…" else "添加材料",
                        {
                            if (r.projects.isEmpty()) {
                                materials.bind("new-project-files", null)
                                upload()
                            } else choosing = !choosing
                        },
                        primary = true,
                        enabled =
                            !r.loading &&
                                r.error == null &&
                                !files.uploading &&
                                !files.unresolved &&
                                !preparing,
                    )
                    DropdownMenu(
                        choosing,
                        { choosing = false },
                        shape = RoundedCornerShape(20.dp),
                        containerColor = MaterialTheme.colorScheme.surface,
                    ) {
                        Text("保存到研究", Modifier.padding(16.dp), fontSize = 13.sp)
                        (r.selected?.let { listOf(it) } ?: r.projects).forEach { item ->
                            DropdownMenuItem(
                                text = { Text(researchTitle(item)) },
                                onClick = {
                                    uploadProject = item.taskId
                                    materials.bind(
                                        "project-files:${item.taskId}",
                                        null,
                                        item.taskId,
                                    )
                                    choosing = false
                                    upload()
                                },
                            )
                        }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NativeSelect(
                        "材料类型",
                        category,
                        listOf("all" to "所有类型", "documents" to "文档与文本", "media" to "录音与视频"),
                    ) {
                        category = it
                    }
                    if (r.selectedId == null)
                        NativeSelect(
                            "按研究筛选材料",
                            owner ?: "",
                            listOf("" to "全部研究") + r.projects.map { it.taskId to researchTitle(it) },
                        ) {
                            owner = it.takeIf { id -> id.isNotEmpty() }
                        }
                    NativeSelect("材料排序", sort, listOf("updated" to "最近修改", "name" to "文件名称")) {
                        sort = it
                    }
                }
                val listed =
                    r.files.values
                        .flatten()
                        .filter { file ->
                            val project = r.projects.firstOrNull { it.taskId == file.taskId }
                            val media =
                                file.mediaType.startsWith("audio/") ||
                                    file.mediaType.startsWith("video/")
                            (r.selectedId == null || file.taskId == r.selectedId) &&
                                (owner == null || r.selectedId != null || file.taskId == owner) &&
                                (category == "all" || if (category == "media") media else !media) &&
                                ("${file.filename} ${project?.let(::researchTitle).orEmpty()}"
                                    .contains(fileQuery.trim(), true))
                        }
                        .let { list ->
                            if (sort == "name") list.sortedBy { it.filename }
                            else list.sortedByDescending { it.updatedAt }
                        }
                Text(
                    "${listed.size} 份材料",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (r.filesLoading) AgentLiquid(label = "正在读取研究材料…")
                if (r.fileErrors.isNotEmpty())
                    LibraryNotice("${r.fileErrors.size} 个项目的文件暂时无法读取。", true, "重试") {
                        controller.load()
                    }
                files.error?.let { LibraryNotice(it, true) }
                if (files.unresolved)
                    EpButton("使用原请求重试", materials::retryOriginal, enabled = !files.uploading)
                if (files.canEndUpload) EndPartialUpload(materials::endRejectedUpload)
                if (listed.isNotEmpty())
                    Column(
                        Modifier.horizontalScroll(rememberScrollState()).semantics {
                            contentDescription = "研究材料文件列表"
                        }
                    ) {
                        ResearchFileRow(listOf("文件名称", "所属研究", "最近修改", "大小", "状态"), heading = true)
                        listed.forEach { file ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                ResearchFileRow(
                                    listOf(
                                        file.filename,
                                        r.projects
                                            .firstOrNull { it.taskId == file.taskId }
                                            ?.let(::researchTitle)
                                            .orEmpty(),
                                        researchDate(file.updatedAt),
                                        formatLibrarySize(file.sizeBytes),
                                        materialStatus(file),
                                    ),
                                    open = { materials.open(file) },
                                )
                                EpIcon(
                                    EpIcons.Trash,
                                    "删除文件 ${file.filename}",
                                    { deleting = file },
                                    enabled = files.busyId == null,
                                )
                            }
                        }
                    }
                else if (!r.loading && !r.filesLoading && r.fileErrors.isEmpty())
                    Column(
                        Modifier.padding(vertical = 36.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            if (r.projects.isEmpty()) "还没有研究" else "这里还没有材料",
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text("从一个问题或一份材料开始。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
            }
        }
    }
}

@Composable
internal fun NativeSelect(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    change: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        EpButton(
            options.firstOrNull { it.first == value }?.second ?: label,
            { open = true },
            secondary = true,
            modifier = Modifier.semantics { contentDescription = label },
        )
        DropdownMenu(
            open,
            { open = false },
            shape = RoundedCornerShape(20.dp),
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            options.forEach { (id, title) ->
                DropdownMenuItem(
                    text = { Text(title) },
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

@Composable
internal fun ResearchStageBar(item: ResearchTaskNavigationResponse) {
    val stage = researchStage(item)
    Row(
        Modifier.semantics { contentDescription = "研究进度：${item.stageLabel}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        repeat(4) { i ->
            Box(
                Modifier.width(22.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(
                        if (i <= stage) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.surfaceContainerHighest
                    )
            )
        }
        Text(
            listOf("提问", "找资料", "写大纲", "写作").getOrNull(stage) ?: item.stageLabel,
            Modifier.padding(start = 6.dp),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ResearchFileRow(
    values: List<String>,
    heading: Boolean = false,
    open: (() -> Unit)? = null,
) {
    Row(
        Modifier.then(if (open != null) Modifier.clickable(onClick = open) else Modifier)
            .padding(vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        values.forEachIndexed { i, value ->
            Text(
                value,
                Modifier.width(if (i == 0) 220.dp else if (i == 1) 150.dp else 92.dp),
                fontSize = if (heading) 12.sp else 14.sp,
                fontWeight = if (heading || i == 0) FontWeight.Medium else FontWeight.Normal,
                color =
                    if (heading) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

private fun researchFileCount(state: ResearchUiState, id: String) =
    if (id in state.fileErrors) "文件读取失败" else state.files[id]?.let { "${it.size} 份文件" } ?: "正在读取文件…"

internal fun researchDate(value: String) =
    runCatching {
            DateTimeFormatter.ofPattern("M月d日")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(value))
        }
        .getOrDefault("最近更新")
