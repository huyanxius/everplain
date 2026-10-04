package app.everplain.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val methodDescriptions =
    mapOf(
        "undecided" to "保留路径比较与下一次决定所需信息，暂不把方法选择写成既定事实。",
        "qualitative" to "围绕材料、批注、备忘、跨案例比较与理论检验建立解释性设计。",
        "quantitative" to "把理论概念落实为变量、测量、样本与可检验的统计分析计划。",
        "mixed" to "说明两类证据为何结合、如何排序整合，以及冲突时共同结论的边界。",
    )
private val methodStatuses =
    mapOf("draft" to "草案", "under_review" to "审校中", "confirmed" to "已确认", "stale" to "依据已变化")

@Composable
internal fun MethodPlanScreen(c: MethodPlanController) {
    val s by c.state.collectAsStateWithLifecycle()
    var context by rememberSaveable(c.taskId) { mutableStateOf(false) }
    var history by rememberSaveable(c.taskId) { mutableStateOf(false) }
    var reviewOpen by rememberSaveable(c.taskId) { mutableStateOf(false) }
    var review by rememberSaveable(c.taskId) { mutableStateOf("") }
    var blocking by rememberSaveable(c.taskId) { mutableStateOf(false) }
    LaunchedEffect(c) { c.load() }
    val p = s.plan
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("方法设计", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                p?.let {
                    Text(
                        "v${it.version} · ${methodStatuses[it.status] ?: it.status}",
                        fontSize = 13.sp,
                    )
                }
            }
        }
        item { Text(p?.researchQuestion ?: "选择一种适合研究问题的路径，再逐步补充研究设计。", fontSize = 16.sp) }
        if (s.loading) item { AgentLiquid(label = "正在恢复方法计划…") }
        s.error?.let { item { LibraryNotice(it, true, "重新加载", c::load) } }
        s.notice?.let { item { Text(it, fontSize = 13.sp) } }
        if (s.unknown) item { EpButton("重试原操作", c::retry, enabled = !s.busy) }
        if (s.conflict)
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("版本已变化。读取最新计划不会覆盖这里的草稿。", fontSize = 13.sp)
                    EpButton("采用最新版本并保留修改", c::rebase, enabled = !s.busy && !s.unknown)
                }
            }
        if (p == null) {
            item {
                SettingsChoice("先选一个路径", s.draft.kind, methodKinds.toList(), !s.busy) {
                    c.edit(kind = it)
                }
            }
            item { Text(methodDescriptions[s.draft.kind].orEmpty(), fontSize = 16.sp) }
            item {
                EpButton(
                    "建立方法计划草案",
                    c::create,
                    primary = true,
                    enabled = !s.busy && !s.loading && !s.unknown,
                )
            }
        } else {
            if (p.status == "stale")
                item {
                    LibraryCard {
                        Text("这份计划所依据的框架或理论已经变化。", style = MaterialTheme.typography.titleMedium)
                        Text(p.staleReason ?: "旧版本仍可在历史中查看，但不能继续确认或编辑。")
                        EpButton(
                            "根据当前依据重新建立计划",
                            c::create,
                            primary = true,
                            enabled = !s.busy && !s.unknown,
                        )
                    }
                }
            item { Text("研究路径", style = MaterialTheme.typography.titleMedium) }
            item {
                SettingsChoice("选择研究路径", s.draft.kind, methodKinds.toList(), !s.locked) {
                    c.edit(kind = it)
                }
            }
            item {
                Text(
                    methodDescriptions[s.draft.kind].orEmpty(),
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                EpField(
                    "方法理由",
                    s.draft.rationale,
                    { c.edit(rationale = it) },
                    multiline = true,
                    minLines = 4,
                    minHeight = 120,
                    enabled = !s.locked,
                    monospace = false,
                )
            }
            item {
                Row {
                    Text("计划章节", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${s.draft.sections.count{it.source=="user"}}/${s.draft.sections.size} 已由用户决定",
                        fontSize = 13.sp,
                    )
                }
            }
            items(s.draft.sections.size) { index ->
                val section = s.draft.sections[index]
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${index+1}  ${section.title} · ${if(section.source=="user")"用户决定" else "系统建议"}",
                        fontSize = 14.sp,
                    )
                    EpField(
                        section.title,
                        section.content,
                        { c.edit(index = index, content = it) },
                        multiline = true,
                        minLines = 5,
                        minHeight = 140,
                        enabled = !s.locked,
                        monospace = false,
                        showLabel = false,
                    )
                }
            }
            item {
                Text("确认前检查", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (s.missing == 0) "所有章节已由用户决定" else "还有 ${s.missing} 个章节保留为系统建议",
                    fontSize = 14.sp,
                )
                Text(
                    if (s.blockers == 0) "没有未处理的阻断审校" else "有 ${s.blockers} 条阻断审校待处理",
                    fontSize = 14.sp,
                )
                Text(
                    if (p.status == "stale") p.staleReason ?: "依据版本已变化，请重新建立计划" else "理论与材料依据已固定",
                    fontSize = 14.sp,
                )
            }
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EpButton(
                        "保存新版本",
                        c::save,
                        primary = true,
                        enabled = !s.locked && !s.conflict && !s.unknown,
                    )
                    EpButton("确认计划", c::confirm, enabled = s.canConfirm)
                }
            }
            item { EpButton("理论、证据与约束", { context = !context }, selected = context) }
            if (context) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        listOf(
                                "理论摘要" to p.theorySummary,
                                "理论概念" to p.theoryConcepts.joinToString("；").ifBlank { "当前框架未列出" },
                                "证据引用" to p.evidenceRefIds.joinToString("、").ifBlank { "当前框架未列出" },
                                "材料约束" to p.materialConstraints.joinToString("；").ifBlank { "未记录" },
                                "伦理约束" to p.ethicalConstraints.joinToString("；").ifBlank { "未记录" },
                                "知识发布版本" to (p.knowledgeReleaseId ?: "未记录"),
                            )
                            .forEach { (label, value) ->
                                Text(
                                    label,
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(value, fontSize = 14.sp)
                            }
                    }
                }
                if (p.sharedContext.isNotEmpty())
                    item { Text("已固定的上游依据", style = MaterialTheme.typography.titleMedium) }
                items(p.sharedContext, key = { it.key }) { record ->
                    LibraryCard {
                        Text(record.title, style = MaterialTheme.typography.titleMedium)
                        Text(record.content, fontSize = 14.sp)
                        if (record.evidenceRefs.isNotEmpty())
                            Text(
                                "证据定位：${record.evidenceRefs.joinToString("、"){it.evidenceRefId}}",
                                fontSize = 13.sp,
                            )
                    }
                }
            }
            item {
                EpButton(
                    "审校记录",
                    { reviewOpen = !reviewOpen },
                    selected = reviewOpen || s.blockers > 0,
                )
            }
            if (reviewOpen || s.blockers > 0) {
                item {
                    EpField(
                        "审校意见",
                        review,
                        { review = it },
                        multiline = true,
                        minLines = 3,
                        minHeight = 100,
                        enabled = !s.locked,
                        monospace = false,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(blocking, { blocking = it }, enabled = !s.locked)
                        Text("阻断确认", fontSize = 14.sp)
                    }
                    EpButton(
                        "提交审校",
                        { c.review(review, blocking) },
                        enabled = !s.locked && review.isNotBlank() && !s.unknown,
                    )
                }
                if (p.reviews.isEmpty()) item { Text("尚无审校意见。", fontSize = 13.sp) }
                items(p.reviews, key = { it.reviewId }) { item ->
                    LibraryCard {
                        Text(if (item.blocking) "阻断审校" else "建议", fontSize = 14.sp)
                        Text(item.note, fontSize = 14.sp)
                        if (item.resolvedAt != null) Text("已处理", fontSize = 13.sp)
                        else
                            EpButton(
                                "标记已处理",
                                { c.resolve(item.reviewId) },
                                enabled = !s.busy && p.status != "stale" && !s.unknown,
                            )
                    }
                }
            }
            item { EpButton("历史版本", { history = !history }, selected = history) }
            if (history)
                items(s.versions, key = { "${it.planId}:${it.version}" }) { version ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("v${version.version} · ${version.changeSummary}", fontSize = 14.sp)
                            Text(if (version.actor == "user") "用户决定" else "系统记录", fontSize = 13.sp)
                        }
                        if (version.version == p.version) Text("当前版本", fontSize = 13.sp)
                        else
                            EpButton(
                                "恢复",
                                { c.restore(version.version) },
                                enabled = !s.busy && p.status != "stale" && !s.unknown,
                            )
                    }
                }
        }
    }
}
