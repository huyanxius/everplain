package app.everplain.android

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.*

private data class ImportSource(
    val id: String,
    val title: String,
    val formats: String,
    val extensions: Set<String>,
    val steps: List<String>,
    val note: String? = null,
)

private val importSources =
    listOf(
        ImportSource(
            "file",
            "文件",
            "PDF、Word、PPT、Markdown、TXT",
            setOf("pdf", "docx", "pptx", "md", "markdown", "txt"),
            listOf("可以一次选好几份", "上传完就能读原文", "知识点稍后自动整理好"),
            "扫描版 PDF 需先转为可选取文字的文档。",
        ),
        ImportSource(
            "image",
            "图片与截图",
            "PNG、JPG、WebP、GIF",
            setOf("png", "jpg", "jpeg", "webp", "gif"),
            listOf("选择截图、照片或拍下的书页", "保留原图，提取图里的文字", "之后按图里的字也能搜到"),
            "图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。",
        ),
        ImportSource(
            "chrome",
            "浏览器收藏",
            "书签 HTML",
            setOf("html", "htm"),
            listOf("打开 Chrome 或 Edge 的书签管理器", "在菜单里选择「导出书签」", "选择得到的 HTML 文件"),
            "逐个读取网页正文，需要登录的页面会显示失败原因，可单独重试。",
        ),
        ImportSource(
            "obsidian",
            "Obsidian / Markdown",
            "Markdown、TXT 或 ZIP",
            setOf("md", "markdown", "txt", "zip"),
            listOf("找到 Vault 所在的文件夹", "先压缩成 ZIP，或选择 Markdown 文件", "保留导出包内的目录结构和双链"),
        ),
        ImportSource(
            "apple_notes",
            "Apple 备忘录",
            "Markdown、TXT 或 ZIP",
            setOf("md", "markdown", "txt", "zip"),
            listOf("选中要带走的笔记", "导出为 Markdown 文件", "选择导出的文件"),
        ),
        ImportSource(
            "enex",
            "印象笔记",
            "ENEX",
            setOf("enex"),
            listOf("在印象笔记里选中笔记本", "导出为 ENEX 文件", "选择导出的文件"),
        ),
        ImportSource(
            "notion",
            "Notion",
            "HTML 或 Markdown 导出包",
            setOf("zip", "html", "htm", "md"),
            listOf("在 Notion 设置里导出全部内容", "格式选择 HTML 或 Markdown", "选择下载的导出包"),
        ),
        ImportSource(
            "flomo",
            "flomo",
            "HTML",
            setOf("html", "htm"),
            listOf("在 flomo 里导出全部笔记", "得到 HTML 文件", "选择导出的文件"),
        ),
        ImportSource(
            "keep",
            "Google Keep",
            "Google Takeout ZIP、JSON 或 HTML",
            setOf("zip", "json", "html"),
            listOf("打开 Google Takeout", "只勾选 Keep 并导出", "选择下载的文件"),
        ),
        ImportSource(
            "bilibili",
            "B 站公开收藏",
            "公开账户 UID",
            emptySet(),
            listOf("填写公开账户 UID", "先读取视频字幕", "没有字幕时按配置转写"),
            "只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。",
        ),
    )

@Composable
internal fun LibraryImportSheet(
    controller: LibraryController,
    initial: String,
    onClose: () -> Unit,
) {
    val s by controller.state.collectAsStateWithLifecycle()
    var selected by rememberSaveable { mutableStateOf(initial) }
    var target by rememberSaveable {
        mutableStateOf(
            s.owned.find { it.id == s.selectedId }?.id
                ?: s.owned.find { it.name == "我的资料" }?.id
                ?: s.owned.firstOrNull()?.id
        )
    }
    var targetsOpen by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var uid by rememberSaveable { mutableStateOf("") }
    var preparing by remember { mutableStateOf(false) }
    var staged by remember { mutableStateOf<List<LibraryUpload>>(emptyList()) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val source = importSources.firstOrNull { it.id == selected }
    val locked = s.busy || preparing || s.unresolved
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            if (uris.isNotEmpty() && source != null && !locked)
                scope.launch {
                    preparing = true
                    localError = null
                    val created = mutableListOf<LibraryUpload>()
                    try {
                        val limit =
                            if (source.id == "file")
                                s.storage?.maxFileBytes ?: throw IOException("暂时无法核对存储限制，请重新读取用量。")
                            else 16L * 1024 * 1024
                        val maxTotal =
                            if (source.id == "file")
                                s.storage?.let { (it.maxBytes - it.usedBytes).coerceAtLeast(0) }
                                    ?: 0
                            else 64L * 1024 * 1024
                        val copies =
                            withContext(Dispatchers.IO) {
                                copyPickedDocuments(
                                    context,
                                    uris,
                                    source.extensions,
                                    limit,
                                    maxTotal,
                                    created,
                                )
                            }
                        staged.forEach { File(it.path).delete() }
                        staged = copies
                    } catch (e: CancellationException) {
                        created.forEach { File(it.path).delete() }
                        throw e
                    } catch (e: Throwable) {
                        created.forEach { File(it.path).delete() }
                        localError = e.message ?: "文件暂时无法读取。"
                    } finally {
                        preparing = false
                    }
                }
        }
    val baseline = remember { s.saved }
    LaunchedEffect(s.saved) { if (s.saved > baseline) staged = emptyList() }
    // URI permissions are transient. Retry data is copied privately and owned by the journal.
    DisposableEffect(Unit) {
        onDispose {
            if (!controller.state.value.unresolved) staged.forEach { File(it.path).delete() }
        }
    }
    LibrarySheet("添加资料", { if (!s.busy && !preparing) onClose() }) {
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            (listOf("extension" to "浏览器扩展") +
                    importSources.map { it.id to it.title } +
                    listOf("records" to "导入记录"))
                .forEach { (id, title) ->
                    EpButton(
                        title,
                        {
                            selected = id
                            localError = null
                            staged.forEach { File(it.path).delete() }
                            staged = emptyList()
                        },
                        selected = selected == id,
                        enabled = !locked,
                    )
                }
        }
        if (s.error != null) LibraryNotice(s.error!!, true)
        if (localError != null) LibraryNotice(localError!!, true)
        if (s.notice != null) LibraryNotice(s.notice!!)
        if (s.canEndUpload) EndPartialUpload(controller::endRejectedUpload)
        if (s.unresolved) {
            Text("原请求已保留，请先核对结果。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            EpButton("使用原请求重试", controller::retryOriginal, enabled = !s.busy)
        }
        when (selected) {
            "extension" -> {
                Text("把正在看的网页，随手留下。", style = MaterialTheme.typography.headlineSmall)
                Text("Everplain 收藏助手", style = MaterialTheme.typography.titleLarge)
                Text(
                    "适用于电脑上的 Chrome / Edge，尚未上架扩展商店。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("在同一个浏览器用户资料中登录 Everplain，回到要保存的网页，打开助手，点击“收藏当前页面”。")
                Text(
                    "安卓可直接选择导出的收藏文件；桌面扩展需在电脑浏览器安装。",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                EpButton("导入浏览器收藏", { selected = "chrome" }, primary = true)
                EpButton("导入记录", { selected = "records" }, secondary = true)
            }
            "records" -> {
                Row {
                    Text("导入记录", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    EpButton("刷新", { controller.load(quiet = true) }, enabled = !s.busy)
                }
                if (s.imports.isEmpty())
                    Text("还没有导入记录。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (s.imports.any { it.status == "processing" }) AgentLiquid(label = "正在整理导入的资料…")
                s.imports.forEach { batch ->
                    var expanded by rememberSaveable(batch.id) { mutableStateOf(false) }
                    LibraryCard {
                        Text(
                            importSources.find { it.id == batch.sourceType }?.title
                                ?: batch.sourceType,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "${batch.finished} / ${batch.total}",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        LinearProgressIndicator(
                            progress = {
                                (batch.finished.toDouble() / batch.total.coerceAtLeast(1))
                                    .toFloat()
                                    .coerceIn(0f, 1f)
                            },
                            modifier =
                                Modifier.fillMaxWidth().semantics { contentDescription = "导入进度" },
                        )
                        Text(
                            "${batch.imported} 条已入库 · ${batch.duplicates} 条重复${if(batch.failed>0)" · ${batch.failed} 条待重试" else ""}",
                            fontSize = 13.sp,
                        )
                        EpButton(
                            "打开资料库",
                            {
                                controller.select(batch.libraryId)
                                onClose()
                            },
                            enabled = !s.busy,
                        )
                        EpButton(if (expanded) "收起条目" else "查看条目", { expanded = !expanded })
                        if (expanded)
                            batch.items.forEach { item ->
                                Text(item.title, fontSize = 14.sp)
                                Text(
                                    item.error
                                        ?: mapOf(
                                            "imported" to "已入库",
                                            "duplicate" to "已存在",
                                            "queued" to "等待处理",
                                            "running" to "正在处理",
                                            "failed" to "失败",
                                        )[item.status]
                                        ?: item.status,
                                    fontSize = 12.sp,
                                    color =
                                        if (item.status == "failed") MaterialTheme.colorScheme.error
                                        else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (item.status == "failed")
                                    EpButton(
                                        "重试",
                                        { controller.retryImport(batch.id, item.id) },
                                        enabled = !locked,
                                    )
                            }
                    }
                }
            }
            else ->
                if (source != null) {
                    Text(source.title, style = MaterialTheme.typography.headlineSmall)
                    Text(
                        source.formats,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    source.steps.forEachIndexed { index, step ->
                        Text("${index+1}. $step", fontSize = 14.sp)
                    }
                    source.note?.let {
                        Text(
                            it,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (source.id == "file")
                        Box {
                            EpButton(
                                "保存到：${s.owned.find { it.id==target }?.name ?: "我的资料"}",
                                { targetsOpen = true },
                                secondary = true,
                                enabled = !locked,
                            )
                            DropdownMenu(
                                targetsOpen,
                                { targetsOpen = false },
                                shape = RoundedCornerShape(20.dp),
                                containerColor = MaterialTheme.colorScheme.surface,
                            ) {
                                s.owned.forEach { library ->
                                    DropdownMenuItem(
                                        text = { Text(library.name.orEmpty()) },
                                        onClick = {
                                            target = library.id
                                            targetsOpen = false
                                        },
                                    )
                                }
                            }
                        }
                    else
                        Text(
                            "保存到「我的资料」",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    if (source.id == "bilibili") {
                        EpField("公开账户 UID", uid, { uid = it }, placeholder = "填写公开账户 UID")
                        EpButton(
                            "开始导入",
                            { controller.importBilibili(uid) },
                            primary = true,
                            enabled = !locked && Regex("[0-9]{1,20}").matches(uid),
                        )
                    } else {
                        Surface(
                            shape = RoundedCornerShape(24.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                Modifier.padding(24.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Icon(EpIcons.UploadSimple, null, Modifier.size(28.dp))
                                Text(
                                    if (preparing) "正在读取文件…" else "选择要带进来的文件",
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                EpButton(
                                    "选择文件",
                                    {
                                        picker.launch(
                                            if (source.id == "image")
                                                arrayOf(
                                                    "image/png",
                                                    "image/jpeg",
                                                    "image/webp",
                                                    "image/gif",
                                                )
                                            else arrayOf("*/*")
                                        )
                                    },
                                    secondary = true,
                                    enabled = !locked && s.storage != null,
                                )
                            }
                        }
                        staged.forEach { file ->
                            Text(
                                "${file.filename} · ${formatLibrarySize(File(file.path).length())}",
                                fontSize = 14.sp,
                            )
                        }
                        if (staged.isNotEmpty())
                            EpButton(
                                if (source.id == "file") "上传 ${staged.size} 份资料" else "开始导入",
                                {
                                    if (source.id == "file") controller.upload(target, staged)
                                    else controller.importFiles(source.id, staged)
                                },
                                primary = true,
                                enabled = !locked,
                            )
                    }
                    Text(
                        s.storage?.let {
                            "已用 ${formatLibrarySize(it.usedBytes)} / ${formatLibrarySize(it.maxBytes)}"
                        } ?: "存储用量暂不可用",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (s.storage == null)
                        EpButton("重新读取用量", { controller.load(quiet = true) }, enabled = !s.busy)
                }
        }
    }
}

/** Bounded private snapshot; never requests broad storage or persistent URI grants. */
internal suspend fun copyPickedDocuments(
    context: Context,
    uris: List<Uri>,
    extensions: Set<String>,
    limit: Long,
    maxTotal: Long,
    copies: MutableList<LibraryUpload>,
    allowedMediaTypes: Set<String> = emptySet(),
): List<LibraryUpload> {
    require(limit > 0 && maxTotal > 0) { "存储空间不足。" }
    var total = 0L
    val directory = File(context.filesDir, "pending-uploads").apply { mkdirs() }
    try {
        uris.forEach { uri ->
            currentCoroutineContext().ensureActive()
            val resolver = context.contentResolver
            val name =
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } ?: "document"
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            require(
                name.substringAfterLast('.', "").lowercase() in extensions ||
                    mime in allowedMediaTypes
            ) {
                "${name} 的格式不支持，请选择页面列出的格式。"
            }
            val file = File(directory, UUID.randomUUID().toString())
            val item = LibraryUpload(file.absolutePath, name, mime, limit)
            copies += item
            resolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(32 * 1024)
                    var length = 0L
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        length += n
                        total += n
                        if (length > limit || total > maxTotal) throw IOException("所选文件超过大小或存储限制。")
                        output.write(buffer, 0, n)
                    }
                }
            } ?: throw IOException("无法读取所选文件，请重新选择。")
        }
        return copies
    } catch (e: Throwable) {
        copies.forEach { File(it.path).delete() }
        throw e
    }
}
