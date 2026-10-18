package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.serialization.json.*

@Composable
internal fun ConversationModeSwitch(s: AppState, vm: AppViewModel) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
    ) {
        Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                onClick = { vm.setComposerMode("standard") },
                enabled = !s.streaming,
                shape = RoundedCornerShape(999.dp),
                color =
                    if (s.composerMode == "standard") MaterialTheme.colorScheme.surfaceVariant
                    else androidx.compose.ui.graphics.Color.Transparent,
                modifier =
                    Modifier.height(44.dp).semantics {
                        contentDescription = "对话模式"
                        selected = s.composerMode == "standard"
                        role = Role.Tab
                    },
            ) {
                Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    AgentAvatar(
                        s.profile?.avatarId ?: "cheng",
                        s.profile?.color,
                        s.profile?.name ?: "Agent",
                        32,
                        state = if (s.streaming) "work" else "idle",
                        decorative = true,
                    )
                }
            }
            EpButton(
                "研究",
                { vm.setComposerMode("deep_research") },
                selected = s.composerMode == "deep_research",
                enabled = !s.streaming,
                modifier =
                    Modifier.semantics {
                        contentDescription = "Research"
                        selected = s.composerMode == "deep_research"
                        role = Role.Tab
                    },
            )
        }
    }
}

@Composable
internal fun ResearchFlow(
    signals: NativeTurnSignals,
    busy: Boolean,
    active: Boolean,
    vm: AppViewModel,
) {
    val r = signals.research
    if (r.stage == "idle") return
    var customOpen by rememberSaveable(r.stage, r.question) { mutableStateOf(false) }
    var custom by rememberSaveable(r.stage, r.question) { mutableStateOf("") }
    val canContinue = active && r.waitingState != null && !busy
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val label =
            when (r.stage) {
                "clarifying" -> "确认研究意图"
                "planning" -> "研究计划"
                "completed" -> "研究结论"
                else -> "研究进度"
            }
        Text(
            r.question.takeIf { it.isNotBlank() } ?: label,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { contentDescription = label },
        )
        when (r.stage) {
            "clarifying" -> {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    r.options
                        .filter { it != "更多自定义" }
                        .forEach { option ->
                            EpButton(
                                option,
                                { vm.continueDeepResearch("clarify", option) },
                                enabled = canContinue,
                                modifier =
                                    Modifier.semantics {
                                        role = Role.RadioButton
                                        selected = false
                                    },
                            )
                        }
                }
                if (active) {
                    EpButton("更多自定义", { customOpen = !customOpen }, enabled = canContinue)
                    if (customOpen) {
                        EpField("补充方向", custom, { custom = it }, enabled = canContinue)
                        EpButton(
                            "继续",
                            { vm.continueDeepResearch("clarify", custom.trim()) },
                            primary = true,
                            enabled = canContinue && custom.isNotBlank(),
                        )
                    }
                    EpButton("跳过", { vm.continueDeepResearch("skip") }, enabled = canContinue)
                    if (busy)
                        Text(
                            "正在根据你的选择继续讨论。",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                }
            }
            "planning" -> {
                r.options.forEachIndexed { i, step ->
                    Text("${i+1}. $step", fontSize = 16.sp, lineHeight = 25.6.sp)
                }
                if (active)
                    FlowRow {
                        EpButton(
                            "开始深入研究",
                            { vm.continueDeepResearch("confirm") },
                            primary = true,
                            enabled = canContinue,
                        )
                        EpButton("返回修改", vm::editResearchPlan, enabled = canContinue)
                    }
            }
            "researching" -> {
                LinearProgressIndicator(
                    progress = { ((r.step + 1) / 4f).coerceAtMost(.95f) },
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "研究进度" },
                )
                researchPhases.forEachIndexed { i, step ->
                    Text(
                        "${i+1}. $step",
                        fontSize = 14.sp,
                        color =
                            if (i == r.step) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier =
                            Modifier.semantics { if (i == r.step) stateDescription = "当前研究阶段" },
                    )
                }
            }
            "completed" -> {
                r.summary?.takeIf { it.isNotBlank() }?.let { NativeMarkdown(it) }
                    ?: Text("本轮没有可摘录的结论，完整回答见对话正文。", fontFamily = FontFamily.Serif)
                Text(
                    listOfNotNull(
                            r.knowledgeCount?.let { "知识库 $it 条" },
                            r.webCount?.let { "网页资料 $it 条" },
                        )
                        .joinToString(" · "),
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        ConversationActivity(signals.tools, busy)
    }
}

private val nativeToolLabels =
    mapOf(
        "search_knowledge" to "检索知识库",
        "read_knowledge_entry" to "读取知识条目",
        "read_sources" to "读取来源",
        "browse_knowledge_directory" to "浏览知识目录",
        "search_research_materials" to "检索研究材料",
        "read_research_material_context" to "读取研究材料原文",
        "search_web" to "搜索公开网页",
        "read_web_page" to "读取网页正文",
        "ask_research_question" to "讨论研究下一步",
        "update_research_map" to "更新研究地图",
        "propose_start_research" to "整理研究起点",
        "get_research_workflow_state" to "读取研究进度",
        "start_theory_matching" to "启动理论匹配",
        "save_confirmed_theory_plan" to "保存已确认理论方案",
        "read_research_document" to "读取研究文档",
        "propose_document_revision" to "整理文档修订提议",
        "propose_document_creation" to "整理文档创建提议",
    )

@Composable
internal fun ConversationActivity(tools: List<NativeToolActivity>, busy: Boolean) {
    if (tools.isEmpty()) return
    var expanded by rememberSaveable { mutableStateOf(false) }
    val running = tools.any { it.phase == "started" } && busy
    val interrupted = tools.any { it.phase == "started" } && !busy
    val label =
        if (running) "Agent 正在调用工具"
        else if (interrupted) "工具调用已中断"
        else if (tools.any { it.phase == "failed" }) "工具调用未完成" else "Agent 已完成工具调用"
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        EpButton(
            "$label · ${tools.size} 个实际步骤",
            { expanded = !expanded },
            modifier =
                Modifier.semantics {
                    contentDescription = "Agent 工作过程"
                    stateDescription = if (expanded) "已展开" else "已收起"
                },
        )
        if (expanded)
            tools.forEach { tool ->
                Text(
                    nativeToolLabels[tool.tool] ?: tool.tool,
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    when (tool.phase) {
                        "started" -> if (busy) "进行中" else "已中断"
                        "failed" -> "失败"
                        else -> "已完成"
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                tool.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
                listOf(
                        "工具输入" to tool.input?.toString(),
                        "查看完整工具返回" to tool.detail,
                        "工具结果数据" to tool.output?.toString(),
                    )
                    .forEach { (title, value) ->
                        if (value != null) {
                            var open by rememberSaveable(tool.id, title) { mutableStateOf(false) }
                            EpButton(title, { open = !open })
                            if (open)
                                SelectionContainer {
                                    Text(value, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                                }
                        }
                    }
            }
    }
}
