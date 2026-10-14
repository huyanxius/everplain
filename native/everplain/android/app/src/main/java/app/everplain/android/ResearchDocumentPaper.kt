package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*

internal data class DocumentDiscussion(
    val title: String,
    val sectionId: String?,
    val content: String,
)

/**
 * Native paper body. Export, citation and exact diff services are supplied by the project owner.
 */
@Composable
internal fun ResearchDocumentPaper(
    c: ResearchDocumentController,
    sectionId: String?,
    wholeDocument: Boolean,
    selectSection: (String?, Boolean) -> Unit,
    discuss: (DocumentDiscussion) -> Unit,
    citation: (String) -> Unit,
    export: (String) -> Unit,
    exporting: Boolean,
    importCsl: () -> Unit,
    importCss: () -> Unit,
    diff: @Composable (String, String) -> Unit,
    theory: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s by c.state.collectAsStateWithLifecycle()
    val document = s.document
    val sections = s.draft?.sections ?: document?.sections ?: researchDocumentSections(c.mode)
    val section = sections.find { it.sectionId == sectionId } ?: sections.firstOrNull()
    var showExport by remember { mutableStateOf(false) }
    var showFormatting by rememberSaveable(c.taskId, c.mode) { mutableStateOf(false) }
    var showVersions by rememberSaveable(c.taskId, c.mode) { mutableStateOf(false) }
    var rebased by remember(c.taskId) { mutableStateOf(emptySet<String>()) }
    var discardConfirmation by remember { mutableStateOf(false) }
    FeatureVisibility(c, c::enter, c::leave)
    if (discardConfirmation)
        AlertDialog(
            onDismissRequest = { discardConfirmation = false },
            title = { Text("放弃本机修改？") },
            text = { Text("改用服务器当前版本。本机尚未保存的正文将被替换。") },
            confirmButton = {
                EpButton(
                    "放弃本机修改",
                    {
                        c.discard()
                        discardConfirmation = false
                    },
                )
            },
            dismissButton = { EpButton("继续保留", { discardConfirmation = false }) },
        )
    Column(modifier.fillMaxSize().semantics { contentDescription = "研究文档节点" }) {
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                when {
                    s.unknown -> "保存结果待确认"
                    s.conflict -> "版本冲突 · 草稿已保留"
                    s.busy -> "正在保存…"
                    s.dirty -> "尚未保存"
                    document != null -> "已保存 · v${document.version}"
                    else -> "研究文稿"
                },
                Modifier.padding(vertical = 10.dp).semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
            )
            if (section?.status in setOf("confirmed", "reviewed"))
                Text("已审阅", Modifier.padding(vertical = 10.dp), fontSize = 13.sp)
            Box {
                EpButton(
                    "导出",
                    { showExport = !showExport },
                    secondary = true,
                    enabled = document != null && !exporting,
                )
                DropdownMenu(showExport, { showExport = false }) {
                    listOf(
                            "markdown" to "下载 Markdown",
                            "docx" to "下载 DOCX",
                            "pdf" to "打印或另存 PDF",
                            "audit" to "下载审计 JSON",
                        )
                        .forEach { (kind, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    showExport = false
                                    export(kind)
                                },
                            )
                        }
                }
            }
            EpButton(
                if (document?.status == "confirmed") "已确认" else "确认版本",
                c::confirm,
                enabled = s.ready && s.gate?.ready == true && document?.status != "confirmed",
            )
        }
        Column(
            Modifier.weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            s.navigation
                ?.phenomenonSummary
                ?.phenomenon
                ?.takeIf { it.isNotBlank() }
                ?.let {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Box(
                            Modifier.width(3.dp)
                                .height(40.dp)
                                .background(MaterialTheme.colorScheme.onSurface)
                        )
                        Text(
                            it,
                            fontFamily = FontFamily.Serif,
                            fontStyle = FontStyle.Italic,
                            style = MaterialTheme.typography.titleLarge,
                        )
                    }
                }
            s.error?.let { LibraryNotice(it, true, "重新读取", c::load) }
            s.notice?.let { Text(it, fontSize = 13.sp) }
            if (s.unknown) EpButton("重试原操作", c::retry, enabled = !s.busy)
            if (s.conflict)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EpButton("保留本机正文，采用最新版本", c::rebase, enabled = !s.busy && !s.unknown)
                    EpButton(
                        "改用服务器正文",
                        { discardConfirmation = true },
                        enabled = !s.busy && !s.unknown,
                    )
                }
            if (s.loading && document == null) AgentLiquid(label = "正在恢复文档版本…")
            else {
                Text(
                    if (wholeDocument) document?.title ?: "研究文稿" else section?.title ?: "研究文稿",
                    style = MaterialTheme.typography.headlineSmall,
                )
                if (c.mode == "match" && section?.key == "candidate_theories" && !wholeDocument)
                    theory()
                if (document == null)
                    Text(
                        if (section?.key == "candidate_theories") "在这个节点开始理论匹配，候选会直接回到画布。"
                        else "这一部分会随着研究推进形成可编辑内容。",
                        Modifier.heightIn(min = 192.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                else if (wholeDocument) {
                    sections.forEach { item ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(item.title, style = MaterialTheme.typography.titleLarge)
                            NativeMarkdown(item.content.ifEmpty { "这一节尚待共同补充。" })
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                EpButton("编辑本节", { selectSection(item.sectionId, false) })
                                EpButton(
                                    "讨论本节",
                                    {
                                        discuss(
                                            DocumentDiscussion(
                                                item.title,
                                                item.sectionId,
                                                item.content,
                                            )
                                        )
                                    },
                                )
                            }
                        }
                    }
                } else
                    section?.let { active ->
                        NativeDocumentEditor(
                            document.documentId,
                            active.content,
                            { c.edit(active.sectionId, it) },
                        )
                    }
                EpButton(
                    "围绕文稿继续研究",
                    {
                        discuss(
                            DocumentDiscussion(
                                document?.title ?: "研究方案文稿",
                                section?.sectionId,
                                if (document != null)
                                    "请阅读当前文稿，结合研究地图检查尚缺的论证和依据，先提出下一步研究任务；需要修改时提交可确认的局部修订建议。"
                                else "请承接已确认研究起点和前期调研，一起形成研究方案。先检查研究状态，已有内容直接复用；明确需要我决定什么，先提供依据再提问。",
                            )
                        )
                    },
                )
            }
            val pending = s.proposals.filter { it.status == "pending" }
            if (pending.isNotEmpty()) {
                Text("Agent 修订建议", style = MaterialTheme.typography.titleMedium)
                Text(
                    "修改只会在你确认后写入正文",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )
                pending.forEach { proposal ->
                    val conflict =
                        proposal.kind != "create" &&
                            proposal.baseDocumentVersion != document?.version
                    LibraryCard {
                        Text(
                            "建议基线 v${proposal.baseDocumentVersion ?: "新建"}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (conflict)
                            Text(
                                "当前文稿已是 v${document?.version}，建议基线发生冲突。",
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 13.sp,
                            )
                        Text(proposal.rationale, fontSize = 14.sp)
                        val base =
                            if (proposal.proposalId in rebased) document
                            else
                                s.versions.find { it.version == proposal.baseDocumentVersion }
                                    ?: document
                        proposal.proposedSections.forEach { proposed ->
                            Column(
                                Modifier.semantics { contentDescription = "${proposed.title}局部差异" }
                            ) {
                                diff(
                                    base
                                        ?.sections
                                        ?.find { it.sectionId == proposed.sectionId }
                                        ?.content ?: "",
                                    proposed.content,
                                )
                            }
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            EpButton(
                                "接受局部修改",
                                { c.accept(proposal.proposalId) },
                                enabled = !conflict && !s.busy && !s.unknown && !s.dirty,
                            )
                            EpButton(
                                "拒绝建议",
                                { c.reject(proposal.proposalId) },
                                enabled = !s.busy && !s.unknown,
                            )
                            if (conflict)
                                EpButton("按当前版本重新比较", { rebased = rebased + proposal.proposalId })
                        }
                    }
                }
            }
            if (document != null) {
                HorizontalDivider()
                EpButton("论文与引用格式", { showFormatting = !showFormatting }, selected = showFormatting)
                if (showFormatting)
                    s.formatting?.let { formatting ->
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            NativeSelect(
                                "论文模板",
                                formatting.templateId,
                                listOf(
                                    "chinese-social-science" to "中文社会科学",
                                    "asa" to "ASA",
                                    "custom" to "自定义 CSS",
                                ),
                            ) {
                                c.editFormatting(formatting.copy(templateId = it))
                            }
                            NativeSelect(
                                "引用样式",
                                formatting.cslStyleId,
                                listOf(
                                    "china-national-standard-gb-t-7714-2015-author-date" to
                                        "GB/T 7714",
                                    "american-sociological-association" to "ASA",
                                    "chicago-author-date" to "Chicago",
                                ) +
                                    if (formatting.cslStyleId.startsWith("custom-"))
                                        listOf(formatting.cslStyleId to "自定义 CSL")
                                    else emptyList(),
                            ) {
                                c.editFormatting(formatting.copy(cslStyleId = it))
                            }
                            NativeSelect(
                                "引用语言",
                                formatting.locale,
                                listOf("zh-CN" to "简体中文", "en-US" to "English (US)"),
                            ) {
                                c.editFormatting(formatting.copy(locale = it))
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                EpButton("导入 .csl", importCsl, enabled = !s.busy)
                                EpButton("导入模板 CSS", importCss, enabled = !s.busy)
                            }
                            EpButton(
                                "应用格式并形成新版本",
                                c::applyFormatting,
                                enabled = s.ready && formatting != document.formatting,
                            )
                        }
                    }
                if (!section?.citationRefs.isNullOrEmpty()) {
                    Text("结构化引用", style = MaterialTheme.typography.titleMedium)
                    section?.citationRefs.orEmpty().forEach { ref ->
                        FlowRow(
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                when (ref.kind) {
                                    "scholarly" -> "学术"
                                    "empirical" -> "经验"
                                    else -> "分析"
                                },
                                Modifier.padding(vertical = 10.dp),
                                fontSize = 13.sp,
                            )
                            EpButton(ref.sourceId, { citation(ref.citationId) })
                            Text(
                                when (ref.state) {
                                    "verified" -> "已核实"
                                    "needs_verification" -> "待核实"
                                    "broken" -> "断链"
                                    else -> "来源已删除"
                                },
                                Modifier.padding(vertical = 10.dp),
                                fontSize = 13.sp,
                            )
                            ref.locator
                                ?.takeIf { it.isNotEmpty() }
                                ?.let { locator ->
                                    Text(
                                        locator.entries.joinToString(" · ") {
                                            "${it.key}: ${it.value}"
                                        },
                                        fontSize = 13.sp,
                                    )
                                }
                        }
                    }
                }
                document.researchAnalysis?.let {
                    Text("分析依据 · ${it.contentHash}", fontSize = 13.sp)
                }
                Text("证据边注", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (section?.evidenceRefs.isNullOrEmpty())
                    Text(
                        "本节尚未引用来源",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                else
                    section?.evidenceRefs.orEmpty().forEach {
                        Text(it.sourceId, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                    }
                EpButton(
                    "版本与恢复（${s.versions.size.takeIf { it > 0 } ?: document.version}）",
                    { showVersions = !showVersions },
                    selected = showVersions,
                )
                if (showVersions)
                    (s.versions.ifEmpty { listOf(document) }).forEach { version ->
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "v${version.version} · ${version.actor}",
                                Modifier.weight(1f),
                                fontSize = 13.sp,
                            )
                            EpButton(
                                if (version.version == document.version) "当前版本" else "恢复",
                                { c.restore(version.version) },
                                enabled = s.ready && version.version != document.version,
                            )
                        }
                    }
            }
        }
    }
}

@Composable
internal fun ResearchDocumentOutline(
    sections: List<ResearchDocumentSectionContract>,
    sectionId: String?,
    wholeDocument: Boolean,
    select: (String?, Boolean) -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            "大纲",
            Modifier.padding(12.dp),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        sections.forEachIndexed { index, section ->
            EpButton(
                "${index + 1}  ${section.title}",
                { select(section.sectionId, false) },
                selected = !wholeDocument && section.sectionId == sectionId,
                modifier =
                    Modifier.fillMaxWidth().semantics {
                        contentDescription = "研究章节：${section.title}"
                    },
            )
        }
        EpButton(
            "阅读全文",
            { select(sectionId, true) },
            selected = wholeDocument,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}
