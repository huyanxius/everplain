package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.serialization.json.*

@Composable
internal fun ReferenceLibraryPicker(
    controller: LibraryController,
    s: AppState,
    vm: AppViewModel,
    onClose: () -> Unit,
) {
    val libraries by controller.state.collectAsStateWithLifecycle()
    LaunchedEffect(controller) { controller.load() }
    LibrarySheet("知识来源", onClose) {
        if (libraries.loading) AgentLiquid(label = "正在读取知识库")
        val current = s.conversation?.referenceKnowledgeBaseId ?: s.referenceLibraryId
        EpButton(
            "不使用个人知识库",
            {
                vm.newChatWithLibrary(null)
                onClose()
            },
            selected = current == null,
            enabled = !s.streaming,
        )
        libraries.owned.forEach { library ->
            EpButton(
                library.name ?: "知识库不可用",
                {
                    vm.newChatWithLibrary(library.id)
                    onClose()
                },
                selected = library.id == current,
                enabled = !s.streaming,
                modifier =
                    Modifier.semantics {
                        role = Role.RadioButton
                        selected = library.id == current
                    },
            )
        }
        if (s.conversation != null)
            Text("切换将开启新对话", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else if (current != null)
            Text(
                "本次对话将使用所选知识库",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        if (libraries.error != null) {
            LibraryNotice(libraries.error!!, true)
            EpButton(
                "查看知识库",
                {
                    onClose()
                    vm.navigate(Destination.Library)
                },
            )
        }
    }
}

private fun citationGroup(c: AgentCitationResponse) =
    when {
        c.knowledgeBaseId != null ||
            c.sourceKind in setOf("shared_material", "personal_knowledge") -> "knowledge"
        c.sourceKind == "web" -> "web"
        c.kind in setOf("material", "research_material") -> "material"
        else -> "knowledge"
    }

@Composable
internal fun ResearchSourcePanel(s: AppState, vm: AppViewModel) {
    val citations =
        (s.conversation?.turns.orEmpty().flatMap { it.assistant.citations.orEmpty() } +
                s.pending?.signals?.citations.orEmpty())
            .distinctBy { it.citationId }
    val tools =
        (s.conversation?.turns.orEmpty().flatMap { canonicalSignals(it).tools } +
                s.pending?.signals?.tools.orEmpty())
            .distinctBy { it.id }
    val chosen = s.selectedCitation
    val materialController = vm.materials()
    val materials by materialController.state.collectAsStateWithLifecycle()
    val libraryController = vm.library()
    val library by libraryController.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current
    LibrarySheet("研究面板", vm::toggleResearchPanel) {
        if (chosen != null) {
            EpButton("返回", vm::backToSources)
            Text(chosen.label, style = MaterialTheme.typography.titleLarge)
            SelectionContainer {
                Text(
                    if (chosen.deleted == true) "这份研究材料已删除，原文不再可访问。"
                    else chosen.excerpt ?: "本轮 Agent 没有返回可展开的证据摘录。",
                    fontFamily = FontFamily.Serif,
                    fontSize = 17.sp,
                    lineHeight = 31.45.sp,
                )
            }
            chosen.locator?.let { locator ->
                val location =
                    listOfNotNull(
                            locator["page"]?.jsonPrimitive?.contentOrNull?.let { "第 $it 页" },
                            locator["paragraph"]?.jsonPrimitive?.contentOrNull?.let { "第 $it 段" },
                        )
                        .joinToString(" · ")
                if (location.isNotBlank())
                    Text(
                        "引用位置：$location",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
            if (chosen.deleted != true) {
                if (chosen.knowledgeBaseId != null && chosen.materialId != null)
                    EpButton(
                        "打开资料原文",
                        {
                            libraryController.source(
                                chosen.knowledgeBaseId!!,
                                chosen.materialId!!,
                                chosen.segmentId,
                            )
                        },
                        primary = true,
                    )
                val task =
                    (chosen.locator?.get("task_id") as? JsonPrimitive)?.contentOrNull
                        ?: s.workspaceTask
                        ?: s.materialContext?.taskId
                if (
                    citationGroup(chosen) == "material" && task != null && chosen.materialId != null
                )
                    EpButton(
                        "打开原文位置",
                        {
                            materialController.openReference(
                                task,
                                chosen.materialId!!,
                                chosen.parseId,
                            )
                        },
                        primary = true,
                    )
                if (citationGroup(chosen) == "web") {
                    val url =
                        listOf("url", "source_url")
                            .firstNotNullOfOrNull { key ->
                                (chosen.locator?.get(key) as? JsonPrimitive)?.contentOrNull
                            }
                            ?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
                    if (url != null) EpButton("访问来源网页", { uri.openUri(url) })
                }
            }
            if (materials.reading) AgentLiquid(label = "正在读取原文…")
            materials.readError?.let { LibraryNotice(it, true) }
        } else {
            listOf("knowledge" to "知识库", "web" to "网页", "material" to "用户文件").forEach {
                (group, label) ->
                val items = citations.filter { citationGroup(it) == group }
                Text("$label ${items.size}", style = MaterialTheme.typography.titleMedium)
                if (items.isEmpty())
                    Text(
                        "本轮暂无来源。",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                items.forEach { citation ->
                    EpButton(
                        "${citations.indexOf(citation)+1} ${citation.label}",
                        { vm.selectCitation(citation) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            Text("工作流程 ${tools.size}", style = MaterialTheme.typography.titleMedium)
            if (tools.isEmpty())
                Text(
                    "实际工具步骤会出现在这里。",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            else ConversationActivity(tools, s.streaming)
        }
    }
    if (materials.selected != null) MaterialReader(materialController, materials)
    if (library.source != null || library.sourceBusy || library.sourceError != null)
        LibrarySourceSheet(library, libraryController::closeSource) {
            if (chosen?.knowledgeBaseId != null && chosen.materialId != null)
                libraryController.source(
                    chosen.knowledgeBaseId!!,
                    chosen.materialId!!,
                    chosen.segmentId,
                )
        }
}
