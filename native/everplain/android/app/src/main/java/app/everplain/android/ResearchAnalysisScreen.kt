package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*

@Composable
internal fun ResearchAnalysisScreen(c: ResearchAnalysisController) {
    val s by c.state.collectAsStateWithLifecycle()
    val compact = LocalConfiguration.current.screenWidthDp <= 760
    val snapshot = s.snapshot
    var cycleOpen by rememberSaveable(c.taskId) { mutableStateOf(false) }
    LaunchedEffect(c) { c.load() }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.widthIn(max = 840.dp).fillMaxSize().imePadding(),
            contentPadding =
                PaddingValues(
                    horizontal = if (compact) 16.dp else 24.dp,
                    vertical = if (compact) 24.dp else 40.dp,
                ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("研究分析", style = MaterialTheme.typography.headlineSmall)
                    Text("从原文证据到分析结论", style = MaterialTheme.typography.bodyLarge)
                }
            }
            s.notice?.let { item { Text(it, fontSize = 14.sp) } }
            s.error?.let { item { LibraryNotice(it, true, "重试读取分析", c::load) } }
            s.cycleError?.let {
                item { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 14.sp) }
            }
            if (s.unknown) item { EpButton("重试原操作", c::retry, enabled = !s.busy) }
            if (s.loading && snapshot == null) item { AgentLiquid(label = "正在加载分析记录") }
            if (snapshot != null) {
                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "${snapshot.annotations.size} 处标记 · ${snapshot.memos.count { it.status == "confirmed" }} 则备忘 · ${snapshot.comparisons.count { it.status == "confirmed" }} 组比较",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 13.sp,
                        )
                        EpButton(
                            "写分析备忘",
                            { c.editMemo { it.copy(open = true) } },
                            secondary = true,
                            enabled = !s.busy,
                        )
                    }
                }
                if (s.drafts.memo.open) item { AnalysisMemoForm(c, s) }
                val candidates =
                    snapshot.memos.filter { it.status == "candidate" && it.source == "agent" }
                if (candidates.isNotEmpty()) item { AnalysisHeading("待你判断") }
                items(candidates, key = { "candidate:${it.memoId}" }) { memo ->
                    LibraryCard {
                        AnalysisMeta("备忘草稿 · v${memo.version}    Agent 建议 · 待确认")
                        Text(memo.title, style = MaterialTheme.typography.titleLarge)
                        Text(memo.content, style = MaterialTheme.typography.bodyLarge)
                        AnalysisDecision(memo.memoId, "备忘草稿", s.busy || s.unknown) {
                            decision,
                            reason ->
                            c.decideMemo(memo.memoId, decision, reason)
                        }
                    }
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "原文标记",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        EpButton("全部研究", {}, selected = true)
                    }
                }
                items(snapshot.annotations, key = { "annotation:${it.annotationId}" }) { annotation
                    ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(20.dp),
                    ) {
                        Column(
                            Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Row {
                                Box(
                                    Modifier.width(2.dp)
                                        .heightIn(min = 32.dp)
                                        .background(MaterialTheme.colorScheme.outline)
                                )
                                Text(
                                    annotation.quote ?: annotation.unavailableReason.orEmpty(),
                                    Modifier.padding(start = 16.dp),
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontFamily = FontFamily.Serif,
                                )
                            }
                            Text(annotation.note, style = MaterialTheme.typography.bodyLarge)
                            annotation.reflection?.let {
                                AnalysisMeta("研究者反思")
                                Text(
                                    it,
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            AnalysisMeta(
                                listOfNotNull(
                                        s.names[annotation.materialId],
                                        annotation.caseLabel,
                                        annotation.observedAt,
                                        annotation.locator.sectionPath
                                            .takeIf { it.isNotEmpty() }
                                            ?.joinToString(" / "),
                                        annotation.locator.page?.let { "第 $it 页" },
                                        annotation.locator.paragraph?.let { "第 $it 段" },
                                    )
                                    .joinToString(" · ")
                            )
                        }
                    }
                }
                if (snapshot.annotations.isEmpty())
                    item { AnalysisEmpty("先在材料原文中拖选关键片段。原文证据会在这里逐步形成批注、分析备忘与案例比较。") }
                item { AnalysisHeading("分析备忘") }
                val confirmed = snapshot.memos.filter { it.status == "confirmed" }
                items(confirmed, key = { "memo:${it.memoId}" }) { memo ->
                    LibraryCard {
                        AnalysisMeta("研究者确认 · ${memoKinds[memo.memoKind] ?: memo.memoKind}")
                        Text(memo.title, style = MaterialTheme.typography.titleLarge)
                        Text(memo.content, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                if (confirmed.isEmpty()) item { AnalysisEmpty("把观察和判断写成备忘，保留你思考的过程。") }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "案例比较",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        EpButton(
                            "建立案例比较",
                            { c.editComparison { it.copy(open = true) } },
                            secondary = true,
                            enabled = !s.busy,
                        )
                    }
                }
                val comparisons =
                    snapshot.comparisons.filter {
                        it.status == "confirmed" ||
                            (it.status == "candidate" && it.source == "agent")
                    }
                items(comparisons, key = { "comparison:${it.comparisonId}" }) { comparison ->
                    LibraryCard {
                        AnalysisMeta(
                            if (comparison.status == "candidate") "Agent 建议 · 待确认"
                            else "研究者确认 · 案例比较"
                        )
                        AnalysisMeta(comparison.caseLabels.joinToString(" · "))
                        Text(comparison.title, style = MaterialTheme.typography.titleLarge)
                        Text(
                            comparison.question,
                            style = MaterialTheme.typography.bodyLarge,
                            fontFamily = FontFamily.Serif,
                        )
                        ComparisonDetails(comparison)
                        if (comparison.status == "candidate")
                            AnalysisDecision(
                                comparison.comparisonId,
                                "案例比较",
                                s.busy || s.unknown,
                            ) { decision, reason ->
                                c.decideComparison(comparison.comparisonId, decision, reason)
                            }
                    }
                }
                if (comparisons.isEmpty() && !s.drafts.comparison.open)
                    item { AnalysisEmpty("把不同材料、案例或时间点放在一起，比较它们的共同点与差异。") }
                if (s.drafts.comparison.open) item { AnalysisComparisonForm(c, s) }
                s.cycle
                    ?.takeIf { it.gaps.isNotEmpty() }
                    ?.let { cycle ->
                        item {
                            EpButton(
                                "研究检查 · ${cycle.gaps.size} 项待完善",
                                { cycleOpen = !cycleOpen },
                                selected = cycleOpen,
                            )
                        }
                        if (cycleOpen) item { AnalysisCycle(cycle) }
                    }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun AnalysisHeading(text: String) {
    Text(text, Modifier.padding(top = 16.dp), style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun AnalysisMeta(text: String) {
    Text(text, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun AnalysisEmpty(text: String) {
    Text(
        text,
        fontSize = 14.sp,
        lineHeight = 22.4.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun AnalysisSelection(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    toggle: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = toggle),
        verticalAlignment = Alignment.Top,
    ) {
        Checkbox(checked, { toggle() }, enabled = enabled)
        Text(label, Modifier.weight(1f).padding(top = 12.dp), fontSize = 14.sp)
    }
}

private fun List<String>.toggled(id: String) = if (id in this) filterNot { it == id } else this + id

@Composable
private fun AnalysisMemoForm(c: ResearchAnalysisController, s: ResearchAnalysisState) {
    val d = s.drafts.memo
    LibraryCard {
        Text("写分析备忘", style = MaterialTheme.typography.titleMedium)
        EpField(
            "备忘标题",
            d.title,
            { value -> c.editMemo { it.copy(title = value) } },
            enabled = !s.busy,
        )
        SettingsChoice("备忘类型", d.kind, memoKinds.toList(), !s.busy) { value ->
            c.editMemo { it.copy(kind = value) }
        }
        EpField(
            "备忘内容",
            d.content,
            { value -> c.editMemo { it.copy(content = value) } },
            multiline = true,
            minLines = 5,
            monospace = false,
            enabled = !s.busy,
        )
        AnalysisMeta("关联原文标记（可选）")
        s.snapshot?.annotations.orEmpty().forEach { a ->
            AnalysisSelection(a.quote.orEmpty(), a.annotationId in d.annotations, !s.busy) {
                c.editMemo { it.copy(annotations = it.annotations.toggled(a.annotationId)) }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EpButton("取消", { c.editMemo { AnalysisMemoDraft() } }, enabled = !s.busy)
            EpButton(
                if (s.busy) "正在保存" else "保存备忘",
                c::saveMemo,
                primary = true,
                enabled = !s.busy && !s.unknown && d.ready,
            )
        }
    }
}

@Composable
private fun AnalysisDecision(
    id: String,
    kind: String,
    disabled: Boolean,
    decide: (String, String) -> Unit,
) {
    var reason by rememberSaveable(id) { mutableStateOf("") }
    EpField(
        "判断依据",
        reason,
        { reason = it },
        multiline = true,
        minLines = 2,
        monospace = false,
        enabled = !disabled,
        placeholder = "回到原文后，写下你保留或拒绝它的理由",
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        EpButton(
            "拒绝$kind",
            { decide("rejected", reason) },
            enabled = !disabled && reason.isNotBlank(),
        )
        EpButton(
            "确认$kind",
            { decide("confirmed", reason) },
            secondary = true,
            enabled = !disabled && reason.isNotBlank(),
        )
    }
}

@Composable
private fun AnalysisComparisonForm(c: ResearchAnalysisController, s: ResearchAnalysisState) {
    val d = s.drafts.comparison
    LibraryCard {
        Text("建立案例比较", style = MaterialTheme.typography.titleMedium)
        AnalysisMeta("比较单元 · 至少选择两个材料、案例或时间点")
        s.units.forEach { u ->
            AnalysisSelection(u.label, u.id in d.units, !s.busy) {
                c.editComparison { it.copy(units = it.units.toggled(u.id)) }
            }
        }
        AnalysisMeta("原文证据")
        s.snapshot?.annotations.orEmpty().forEach { a ->
            AnalysisSelection(a.quote.orEmpty(), a.annotationId in d.annotations, !s.busy) {
                c.editComparison { it.copy(annotations = it.annotations.toggled(a.annotationId)) }
            }
        }
        EpField(
            "比较标题",
            d.title,
            { value -> c.editComparison { it.copy(title = value) } },
            enabled = !s.busy,
        )
        val fields:
            List<
                Triple<String, String, (AnalysisComparisonDraft, String) -> AnalysisComparisonDraft>
            > =
            listOf(
                Triple("比较问题", d.question) { old, value -> old.copy(question = value) },
                Triple("支持证据", d.support) { old, value -> old.copy(support = value) },
                Triple("反例", d.counterexample) { old, value -> old.copy(counterexample = value) },
                Triple("矛盾材料", d.contradiction) { old, value -> old.copy(contradiction = value) },
                Triple("竞争解释", d.competing) { old, value -> old.copy(competing = value) },
                Triple("证据缺口", d.gap) { old, value -> old.copy(gap = value) },
                Triple("理论含义", d.implication) { old, value -> old.copy(implication = value) },
            )
        fields.forEach { (label, value, change) ->
            EpField(
                label,
                value,
                { text -> c.editComparison { change(it, text) } },
                multiline = true,
                minLines = 2,
                monospace = false,
                enabled = !s.busy,
            )
        }
        SettingsChoice("行动类型", d.nextKind, nextStepKinds.toList(), !s.busy) { value ->
            c.editComparison { it.copy(nextKind = value) }
        }
        SettingsChoice(
            "优先级",
            d.priority,
            listOf("high" to "高", "medium" to "中", "low" to "低"),
            !s.busy,
        ) { value ->
            c.editComparison { it.copy(priority = value) }
        }
        EpField(
            "下一步行动",
            d.nextAction,
            { value -> c.editComparison { it.copy(nextAction = value) } },
            multiline = true,
            minLines = 2,
            monospace = false,
            enabled = !s.busy,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EpButton("取消", { c.editComparison { AnalysisComparisonDraft() } }, enabled = !s.busy)
            EpButton(
                if (s.busy) "正在保存" else "保存案例比较",
                c::saveComparison,
                primary = true,
                enabled = !s.busy && !s.unknown && d.ready,
            )
        }
    }
}

@Composable
private fun ComparisonDetails(p: CaseComparisonResponse) {
    findingKinds.forEach { (key, label) ->
        val values =
            (p.findings.filter { it.kind == key }.map { it.statement } +
                    when (key) {
                        "competing_explanation" -> p.competingExplanations
                        "evidence_gap" -> p.evidenceGaps
                        else -> emptyList()
                    })
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
        if (values.isNotEmpty()) {
            AnalysisMeta(label)
            values.forEach { Text(it, fontSize = 14.sp) }
        }
    }
    if (p.nextSteps.isNotEmpty()) {
        AnalysisMeta("下一步行动")
        p.nextSteps.forEach {
            Text("${nextStepKinds[it.kind] ?: it.kind}  ${it.action}", fontSize = 14.sp)
        }
    }
    AnalysisMeta("理论含义")
    Text(p.theoryImplication, fontSize = 14.sp)
}

@Composable
private fun AnalysisCycle(cycle: ResearchCycleResponse) {
    var reports by rememberSaveable(cycle.taskId) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("证据缺口与下一轮材料", style = MaterialTheme.typography.titleMedium)
        AnalysisMeta("循环 v${cycle.version}")
        cycle.gaps.forEach { gap ->
            Column(
                Modifier.border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AnalysisMeta(
                    "${mapOf("material_screening" to "材料筛选", "sampling" to "下一轮取样")[gap.destination] ?: gap.destination} · ${mapOf("high" to "高优先级", "medium" to "中优先级", "low" to "低优先级")[gap.priority] ?: gap.priority}"
                )
                Text(gap.description, style = MaterialTheme.typography.titleLarge)
                Text(gap.suggestedAction, style = MaterialTheme.typography.bodyLarge)
                AnalysisMeta(
                    "依据：${mapOf("analysis" to "分析", "theory" to "理论判断")[gap.sourceKind] ?: gap.sourceKind} ${gap.sourceId}${gap.theoryPlanVersion?.let { " · 理论计划 v$it" }.orEmpty()} · 循环 v${cycle.version}"
                )
            }
        }
        val hints = cycle.reportingHints.filter { it.status != "present" }
        if (hints.isNotEmpty()) {
            EpButton("报告覆盖提示（${hints.size}）", { reports = !reports }, selected = reports)
            if (reports) {
                AnalysisMeta("只提示报告覆盖，不影响理论或方法判断。")
                hints.forEach {
                    Text("${it.guideline} · ${it.label}", fontSize = 14.sp)
                    Text(it.message, fontSize = 14.sp)
                }
            }
        }
    }
}
