package app.everplain.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.*

internal val researchExtensions =
    setOf("pdf", "docx", "txt", "md", "markdown", "mp3", "m4a", "wav", "mp4", "webm")

@Composable
internal fun rememberMaterialUpload(
    controller: MaterialController,
    blocked: Boolean,
    attachToComposer: Boolean = true,
): Pair<() -> Unit, Boolean> {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preparing by remember { mutableStateOf(false) }
    var issue by remember { mutableStateOf<String?>(null) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            if (uris.isNotEmpty() && !blocked && !preparing)
                scope.launch {
                    preparing = true
                    issue = null
                    val created = mutableListOf<LibraryUpload>()
                    try {
                        require(uris.size + controller.state.value.attached.size <= 20) {
                            "每轮最多附加 20 份研究材料。"
                        }
                        val files =
                            withContext(Dispatchers.IO) {
                                val copies =
                                    copyPickedDocuments(
                                        context,
                                        uris,
                                        researchExtensions,
                                        100L * 1024 * 1024,
                                        File(context.filesDir.absolutePath)
                                            .usableSpace
                                            .coerceAtMost(2000L * 1024 * 1024),
                                        created,
                                        allowedMediaTypes =
                                            setOf(
                                                "application/pdf",
                                                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                                "text/plain",
                                                "text/markdown",
                                                "audio/mpeg",
                                                "audio/mp4",
                                                "audio/x-m4a",
                                                "audio/wav",
                                                "audio/x-wav",
                                                "video/mp4",
                                                "video/webm",
                                            ),
                                    )
                                copies.map { file ->
                                    val media =
                                        file.filename.substringAfterLast('.').lowercase() in
                                            setOf("mp3", "m4a", "wav", "mp4", "webm") ||
                                            file.mime.startsWith("audio/") ||
                                            file.mime.startsWith("video/")
                                    val limit = (if (media) 100L else 25L) * 1024 * 1024
                                    require(File(file.path).length() <= limit) {
                                        "单份${if(media)"音视频" else "文档"}不能超过 ${limit/1024/1024} MB。"
                                    }
                                    file.copy(limit = limit)
                                }
                            }
                        controller.upload(files, attachToComposer)
                    } catch (e: CancellationException) {
                        created.forEach { File(it.path).delete() }
                        throw e
                    } catch (e: Throwable) {
                        created.forEach { File(it.path).delete() }
                        issue = e.message ?: "文件暂时无法读取。"
                    } finally {
                        preparing = false
                    }
                }
        }
    issue?.let { error ->
        AlertDialog(
            onDismissRequest = { issue = null },
            title = { Text("文件暂未加入") },
            text = { Text(error) },
            confirmButton = { EpButton("知道了", { issue = null }) },
        )
    }
    return Pair({ if (!blocked && !preparing) launcher.launch(arrayOf("*/*")) }, preparing)
}

@Composable
internal fun ComposerAttachments(s: AppState, controller: MaterialController) {
    val files by controller.state.collectAsStateWithLifecycle()
    if (files.attached.isNotEmpty() || files.uploading)
        FlowRow(
            Modifier.fillMaxWidth().padding(bottom = 8.dp).semantics {
                contentDescription = "本轮附件"
            },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            files.attached.forEach { item ->
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                ) {
                    Row(
                        Modifier.padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(EpIcons.FileText, null, Modifier.size(16.dp))
                        Text(
                            item.filename,
                            Modifier.widthIn(max = 170.dp).padding(horizontal = 8.dp),
                            fontSize = 13.sp,
                            maxLines = 1,
                        )
                        Text(
                            if (item.status == "ready") "已添加" else materialStatus(item),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        EpIcon(
                            EpIcons.Close,
                            "移除附件 ${item.filename}",
                            { controller.remove(item.materialId) },
                            enabled = !s.streaming,
                        )
                    }
                }
            }
            if (files.uploading)
                Text("正在上传…", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    files.error?.let { LibraryNotice(it, true) }
    if (files.canEndUpload) EndPartialUpload(controller::endRejectedUpload)
    if (files.unresolved)
        EpButton("重试原文件请求", controller::retryOriginal, enabled = !files.uploading && !s.streaming)
}

@Composable
internal fun MaterialPicker(controller: MaterialController, onClose: () -> Unit) {
    val state by controller.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(controller) { controller.load() }
    LibrarySheet("从研究材料添加", onClose) {
        EpField("搜索研究材料", query, { query = it }, showLabel = false, placeholder = "搜索文件名称")
        if (state.loading) AgentLiquid(label = "正在加载材料")
        state.error?.let { LibraryNotice(it, true, "重试") { controller.load() } }
        state.available
            .filter { it.filename.contains(query, true) }
            .forEach { material ->
                val selected = state.attached.any { it.materialId == material.materialId }
                Row(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .clickable(enabled = material.status == "ready") {
                            controller.toggle(material)
                        }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        selected,
                        { controller.toggle(material) },
                        enabled = material.status == "ready",
                    )
                    Column(Modifier.weight(1f)) {
                        Text(material.filename, fontSize = 14.sp)
                        Text(
                            materialStatus(material),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        if (!state.loading && state.available.isEmpty())
            Text("还没有研究材料", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.more) EpButton("加载更多", { controller.load(more = true) }, enabled = !state.loading)
        EpButton("完成", onClose, primary = true)
    }
}

@Composable
internal fun MaterialsScreen(controller: MaterialController, s: AppState) {
    val state by controller.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var deleting by remember { mutableStateOf<ResearchMaterialResponse?>(null) }
    val (upload, preparing) =
        rememberMaterialUpload(
            controller,
            state.uploading || state.unresolved,
            attachToComposer = false,
        )
    LaunchedEffect(controller) {
        controller.bind("files:${s.session?.user?.userId}", null)
        controller.load()
    }
    FeatureVisibility(
        controller,
        { controller.bind("files:${s.session?.user?.userId}", null) },
        controller::leave,
    )
    deleting?.let { file ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除研究材料？") },
            text = { Text("删除“${file.filename}”的原文件、解析内容和相关索引？此操作无法撤销，引用它的旧回答可能被隐藏。") },
            confirmButton = {
                EpButton(
                    "确认删除",
                    {
                        controller.delete(file)
                        deleting = null
                    },
                    primary = true,
                    enabled = state.busyId == null,
                )
            },
            dismissButton = { EpButton("保留材料", { deleting = null }) },
        )
    }
    if (state.selected != null) MaterialReader(controller, state)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("文件", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
            EpButton(
                if (preparing || state.uploading) "正在上传…" else "上传文件",
                upload,
                primary = true,
                enabled = !preparing && !state.uploading && !state.unresolved,
            )
        }
        EpField("搜索文件", query, { query = it }, showLabel = false, placeholder = "搜索文件名称")
        state.error?.let { LibraryNotice(it, true, "重新读取") { controller.load() } }
        if (state.canEndUpload) EndPartialUpload(controller::endRejectedUpload)
        if (state.unresolved)
            EpButton("使用原请求重试", controller::retryOriginal, enabled = !state.uploading)
        if (state.loading) AgentLiquid(label = "正在加载材料")
        val items = state.available.filter { it.filename.contains(query, true) }
        if (!state.loading && items.isEmpty()) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Icon(EpIcons.FileText, null, Modifier.size(30.dp))
                Text(
                    if (query.isBlank()) "还没有研究材料" else "没有找到相关文件",
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    "先加入一份论文、访谈转录或田野笔记，Agent 才能在本次研究中引用它。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "支持文档、MP3、M4A、WAV、MP4、WebM",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items.forEach { material ->
            LibraryCard {
                Text(
                    material.materialFormat.uppercase(),
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    material.filename,
                    Modifier.clickable { controller.open(material) },
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    materialKindLabel(material.materialKind),
                    fontFamily = FontFamily.Serif,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    materialStatus(material),
                    fontSize = 13.sp,
                    color =
                        if (material.status == "failed") MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        formatLibrarySize(material.sizeBytes),
                        Modifier.weight(1f),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (material.status == "failed" || material.ingestionStatus == "failed")
                        EpIcon(
                            EpIcons.Refresh,
                            "重新解析：${material.filename}",
                            { controller.reparse(material) },
                            enabled = state.busyId == null && !state.unresolved,
                        )
                    EpIcon(
                        EpIcons.Trash,
                        "删除材料：${material.filename}",
                        { deleting = material },
                        enabled = state.busyId == null && !state.unresolved,
                    )
                }
            }
        }
        if (state.more) EpButton("加载更多", { controller.load(more = true) }, enabled = !state.loading)
    }
}

@Composable
internal fun MaterialReader(controller: MaterialController, state: MaterialUiState) {
    val file = state.selected ?: return
    LibrarySheet(file.filename, controller::closeReader) {
        Text(
            "${materialKindLabel(file.materialKind)} · ${formatLibrarySize(file.sizeBytes)}",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (state.reading) AgentLiquid(label = "正在读取原文…")
        state.readError?.let { LibraryNotice(it, true, "重试") { controller.open(file) } }
        file.segments
            .orEmpty()
            .sortedBy { it.ordinal }
            .forEach { segment ->
                val location =
                    listOfNotNull(
                            segment.locator.page?.let { "第 $it 页" },
                            segment.locator.paragraph?.let { "第 $it 段" },
                            segment.locator.timeStartMs?.let {
                                "${it/1000/60}:${(it/1000%60).toString().padStart(2,'0')}"
                            },
                        )
                        .joinToString(" · ")
                if (location.isNotBlank())
                    Text(
                        location,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                NativeMarkdown(segment.text)
            }
        if (!state.reading && state.readError == null && file.segments.isNullOrEmpty())
            Text(materialStatus(file), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal fun materialStatus(file: ResearchMaterialResponse): String =
    when {
        file.unavailableReason == "ocr_required" -> "需要 OCR"
        file.unavailableReason == "transcription_unavailable" -> "未配置转写"
        file.unavailableReason == "transcription_required" -> "等待转写"
        file.ingestionStatus == "queued" -> "等待解析"
        file.ingestionStatus == "failed" || file.status == "failed" -> "解析失败"
        file.status == "ready" -> "可引用"
        file.status == "deleted" -> "已删除"
        else -> "处理中"
    }

internal fun materialKindLabel(kind: String) =
    when (kind) {
        "paper" -> "论文"
        "interview_transcript" -> "访谈转录"
        "observation_record" -> "观察记录"
        "field_note" -> "田野笔记"
        else -> "研究材料"
    }

@Composable
internal fun EndPartialUpload(end: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    EpButton("结束本次上传", { confirm = true })
    if (confirm)
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("结束本次上传？") },
            text = { Text("已上传成功的资料会保留；服务器已明确拒绝的文件和剩余文件不再重试。可以重新选择需要上传的文件。") },
            confirmButton = {
                EpButton(
                    "结束上传",
                    {
                        end()
                        confirm = false
                    },
                    primary = true,
                )
            },
            dismissButton = { EpButton("继续处理", { confirm = false }) },
        )
}
