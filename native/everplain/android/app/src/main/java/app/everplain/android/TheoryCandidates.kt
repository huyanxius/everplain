package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
internal fun TheoryCandidates(c: TheoryController) {
    val s by c.state.collectAsStateWithLifecycle()
    val run = s.run
    LaunchedEffect(c) { c.load() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (s.loading) AgentLiquid(label = "正在恢复理论判断…")
        s.error?.let { LibraryNotice(it, true, "重新读取", c::load) }
        s.notice?.let { Text(it, fontSize = 13.sp) }
        if (s.unknown) EpButton("重试原操作", c::retry, enabled = !s.busy)
        if (
            s.navigation?.allowedActions?.contains("start_matching") == true &&
                (run == null || run.status == "no_reliable_candidate")
        ) {
            Column(
                Modifier.padding(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(s.navigation?.blocker?.message ?: "现象已确认，可以开始理论匹配。", fontSize = 14.sp)
                EpButton(
                    if (s.busy) "正在匹配…"
                    else
                        s.navigation?.retry?.label
                            ?: if (run?.status == "no_reliable_candidate") "重新匹配" else "开始理论匹配",
                    c::start,
                    enabled = !s.busy && !s.unknown,
                )
            }
        }
        if (run != null && run.status != "no_reliable_candidate") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "候选理论",
                    Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )
                Text("${run.candidatePage.candidates.size} 个候选", fontSize = 13.sp)
            }
            val evidence =
                listOf(
                    "固定发布" to run.knowledgeReleaseId,
                    "检索模式" to run.retrieval.mode,
                    "索引" to (run.retrieval.retrievalIndexId ?: "未记录"),
                    "Embedding" to (run.retrieval.embeddingModel ?: "未记录"),
                    "Reranker" to (run.retrieval.rerankerModel ?: "未记录"),
                )
            evidence.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { (title, value) ->
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                title,
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                value,
                                fontSize = 13.sp,
                                fontFamily =
                                    if (title in setOf("固定发布", "索引")) FontFamily.Monospace
                                    else FontFamily.SansSerif,
                            )
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (s.draft.runId != null && s.draft.runId != run.matchRunId) {
                Text("匹配结果已变化。上一轮判断草稿仍保留，请确认是否改为当前候选。", fontSize = 14.sp)
                EpButton("保留旧草稿并开始当前判断", c::startNewDraft, enabled = !s.busy && !s.unknown)
            }
            run.candidatePage.candidates.forEach { p ->
                LibraryCard {
                    Text(p.title, style = MaterialTheme.typography.titleLarge)
                    Text(
                        p.applicabilityRationale,
                        fontSize = 16.sp,
                        lineHeight = 25.6.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                                "adopt" to "采用",
                                "combine" to "组合",
                                "retain" to "保留",
                                "exclude" to "排除",
                            )
                            .forEach { (action, label) ->
                                EpButton(
                                    label,
                                    { c.choose(p.candidateId, action) },
                                    selected = s.draft.choices[p.candidateId]?.action == action,
                                    enabled = !s.busy,
                                )
                            }
                    }
                }
            }
            run.failedCandidates.forEach { p ->
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(p.title, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "本次判断未完成 · ${p.failureCode}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                    if (p.retryable)
                        EpButton(
                            "重试此候选",
                            { c.retryCandidate(p.candidateId) },
                            enabled = !s.busy && !s.unknown,
                        )
                }
            }
            if (s.adopted.size > 1)
                Column(
                    Modifier.border(
                            1.dp,
                            MaterialTheme.colorScheme.outline,
                            RoundedCornerShape(20.dp),
                        )
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("说明组合理论的关系", style = MaterialTheme.typography.titleMedium)
                    val r = s.draft.relation
                    TheoryRelationField("组合关系说明", r.explanation, "两个理论如何共同解释研究问题", !s.busy) { v ->
                        c.editRelation { it.copy(explanation = v) }
                    }
                    TheoryRelationField("前提兼容性", r.premise, "两者前提在哪些条件下兼容", !s.busy) { v ->
                        c.editRelation { it.copy(premise = v) }
                    }
                    TheoryRelationField("支持证据要求", r.supporting, "什么证据支持组合解释", !s.busy) { v ->
                        c.editRelation { it.copy(supporting = v) }
                    }
                    TheoryRelationField("排除证据要求", r.excluding, "什么证据会排除组合解释", !s.busy) { v ->
                        c.editRelation { it.copy(excluding = v) }
                    }
                    TheoryRelationField("区分证据要求", r.distinguishing, "什么证据能区分各理论贡献", !s.busy) { v ->
                        c.editRelation { it.copy(distinguishing = v) }
                    }
                }
            if (run.failedCandidateIds.isNotEmpty() && !run.partialCompletionAcknowledged)
                Text(
                    "仍有候选未完成。保存完整理论决定将记录你同意以当前可用候选继续判断。",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            EpButton("保存完整理论决定", c::submit, enabled = s.canSubmit)
            s.decision?.let { decision ->
                EpButton(
                    "确认理论方案，进入 M5",
                    c::confirm,
                    enabled =
                        !s.busy &&
                            !s.unknown &&
                            "confirm_theory_plan" in decision.allowedActions &&
                            decision.decisions.all {
                                s.draft.choices[it.candidateId] ==
                                    TheoryChoice(it.candidateVersion, it.action)
                            },
                )
            }
        }
    }
}

@Composable
private fun TheoryRelationField(
    label: String,
    value: String,
    hint: String,
    enabled: Boolean,
    change: (String) -> Unit,
) {
    EpField(
        label,
        value,
        change,
        multiline = true,
        minLines = 2,
        minHeight = 80,
        monospace = false,
        enabled = enabled,
        placeholder = hint,
    )
}
