package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import app.everplain.core.*
import app.everplain.shared.*
import kotlin.math.*

@Composable
internal fun ResearchLaunchScreen(s: AppState, vm: AppViewModel) {
    var pane by rememberSaveable(s.materialScope) { mutableStateOf("agent") }
    val map =
        s.pending?.signals?.canvas
            ?: s.conversation?.researchMap
            ?: AgentResearchMapResponse(emptyList(), emptyList(), 1)
    LaunchedEffect(s.conversation?.conversationId, s.conversation?.turnCount, s.streaming) {
        if (!s.streaming && s.conversation != null) vm.loadJourney()
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EpIcon(
                EpIcons.ArrowLeft,
                "返回研究",
                { vm.navigate(Destination.Research) },
                enabled = !s.streaming,
            )
            Spacer(Modifier.weight(1f))
            EpButton("Agent", { pane = "agent" }, selected = pane == "agent")
            EpButton("研究地图", { pane = "map" }, selected = pane == "map")
        }
        s.journeyError?.let { LibraryNotice(it, true, "恢复研究状态", vm::loadJourney) }
        s.journey
            ?.proposal
            ?.takeIf { it.requiresUserConfirmation && it.status != "confirmed" }
            ?.let { proposal ->
                LibraryCard {
                    Text(
                        "研究起点",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(proposal.phenomenon, style = MaterialTheme.typography.titleLarge)
                    Text("意图：${proposal.researchIntent ?: "待补充"}", fontSize = 14.sp)
                    Text("情境：${proposal.context ?: "待补充"}", fontSize = 14.sp)
                    FlowRow {
                        EpButton(
                            if (s.journeyBusy) "正在建立研究…" else "确认研究起点",
                            { vm.confirmResearchStart(proposal) },
                            primary = true,
                            enabled = !s.journeyBusy && !s.streaming,
                        )
                        EpButton(
                            "继续修改",
                            {
                                pane = "agent"
                                vm.setDraft("我想修改这个研究起点。")
                            },
                            enabled = !s.journeyBusy,
                        )
                    }
                }
            }
        Box(Modifier.weight(1f)) {
            if (pane == "agent") ConversationScreen(s, vm)
            else
                ResearchMapNative(map, s, vm) { node ->
                    pane = "agent"
                    vm.setDraft("请围绕「${node.title}」继续推进。先说明已有依据和待解决的问题，需要我判断时提出一个具体问题。")
                }
        }
    }
}

private val canvasKindLabels =
    mapOf(
        "question" to "研究问题",
        "phenomenon" to "核心现象",
        "theory" to "理论视角",
        "claim" to "核心主张",
        "evidence" to "经验依据",
        "gap" to "证据缺口",
        "synthesis" to "阶段综合",
        "document" to "研究章节",
    )
private val canvasStatusLabels =
    mapOf(
        "developing" to "形成中",
        "grounded" to "已有依据",
        "open" to "待处理",
        "verified" to "已核验",
        "challenged" to "有争议",
        "complete" to "已完成",
    )

@Composable
private fun ResearchMapNative(
    map: AgentResearchMapResponse,
    s: AppState,
    vm: AppViewModel,
    continueNode: (AgentResearchMapNodeResponse) -> Unit,
) {
    var positions by
        remember(s.conversation?.conversationId) {
            mutableStateOf<Map<String, GraphPoint>>(emptyMap())
        }
    var selected by
        rememberSaveable(s.conversation?.conversationId) { mutableStateOf<String?>(null) }
    var depth by rememberSaveable { mutableIntStateOf(0) }
    var directory by rememberSaveable { mutableStateOf(false) }
    var allRelations by rememberSaveable { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(.45f) }
    var pan by remember { mutableStateOf(Offset(24f, 24f)) }
    var bounds by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current.density
    val surface = MaterialTheme.colorScheme.surface
    val rule = MaterialTheme.colorScheme.outline
    val ink = MaterialTheme.colorScheme.onSurface
    fun fit() {
        if (map.nodes.isEmpty() || bounds.width == 0 || positions.isEmpty()) return
        val width = (positions.values.maxOf { it.x } + 304).toFloat()
        val height = (positions.values.maxOf { it.y } + 220).toFloat()
        zoom =
            min(bounds.width * .7f / (width * density), bounds.height * .7f / (height * density))
                .coerceIn(.08f, .9f)
        pan =
            Offset(
                (bounds.width / density - width * zoom) / 2,
                (bounds.height / density - height * zoom) / 2,
            )
    }
    LaunchedEffect(map.nodes) {
        val initial = positions.isEmpty()
        positions = arrangeResearchCanvas(map.nodes, positions)
        if (initial) fit()
    }
    LaunchedEffect(bounds) { fit() }
    val visible =
        remember(map, selected, depth) {
            if (selected == null || depth == 0) map.nodes.map { it.id }.toSet()
            else
                buildSet {
                    add(selected!!)
                    repeat(depth) {
                        val current = toSet()
                        map.relations.forEach { edge ->
                            if (edge.source in current) add(edge.target)
                            if (edge.target in current) add(edge.source)
                        }
                    }
                }
        }
    val picked = map.nodes.firstOrNull { it.id == selected }
    Column(Modifier.fillMaxSize()) {
        if (map.nodes.isNotEmpty())
            Row(
                Modifier.fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("关联范围", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                listOf(0 to "全部", 1 to "直接相关", 2 to "延伸关联").forEach { (n, label) ->
                    EpButton(
                        label,
                        { depth = n },
                        selected = depth == n,
                        enabled = n == 0 || selected != null,
                    )
                }
                EpIcon(EpIcons.CornersOut, "适应画布", ::fit)
                EpIcon(
                    EpIcons.Shuffle,
                    "重新排列",
                    {
                        positions = arrangeResearchCanvas(map.nodes)
                        fit()
                    },
                )
                EpButton("节点目录", { directory = !directory })
                EpButton("所有关系", { allRelations = !allRelations }, selected = allRelations)
            }
        Box(
            Modifier.fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(20.dp))
                .background(surface)
                .onSizeChanged { bounds = it }
                .semantics {
                    contentDescription = if (map.nodes.isEmpty()) "空白研究画布" else "可缩放、可拖动的研究画布"
                }
        ) {
            if (map.nodes.isEmpty())
                Column(
                    Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    AgentAvatar(
                        s.profile?.avatarId ?: "shi",
                        s.profile?.color,
                        s.profile?.name ?: "Agent",
                        96,
                        state = "greet",
                    )
                    Text("从一个问题开始", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "对话中形成的研究结构会在这里展开。",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "直接提问，或先放入一批材料",
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EpButton(
                        "从材料开始研究",
                        {
                            vm.research().tab("files")
                            vm.navigate(Destination.Research)
                        },
                        secondary = true,
                    )
                }
            else {
                Canvas(
                    Modifier.fillMaxSize().pointerInput(zoom, pan) {
                        detectTransformGestures { centroid, panning, scale, _ ->
                            val previous = zoom
                            zoom = (zoom * scale).coerceIn(.08f, 1.7f)
                            val center = centroid / density
                            pan = (pan - center) * (zoom / previous) + center + panning / density
                        }
                    }
                ) {
                    val step = 24 * density * zoom
                    if (step >= 3) {
                        var x = pan.x * density % step
                        while (x < size.width) {
                            var y = pan.y * density % step
                            while (y < size.height) {
                                drawCircle(
                                    rule.copy(alpha = .6f),
                                    max(.5f, zoom * density),
                                    Offset(x, y),
                                )
                                y += step
                            }
                            x += step
                        }
                    }
                    map.relations
                        .filter { it.source in visible && it.target in visible }
                        .forEach { edge ->
                            val from = positions[edge.source] ?: return@forEach
                            val to = positions[edge.target] ?: return@forEach
                            val right = to.x >= from.x
                            val a =
                                Offset(
                                    ((from.x + if (right) 304 else 0) * zoom + pan.x).toFloat() *
                                        density,
                                    ((from.y + 110) * zoom + pan.y).toFloat() * density,
                                )
                            val b =
                                Offset(
                                    ((to.x + if (right) 0 else 304) * zoom + pan.x).toFloat() *
                                        density,
                                    ((to.y + 110) * zoom + pan.y).toFloat() * density,
                                )
                            val middle = (a.x + b.x) / 2
                            drawPath(
                                Path().apply {
                                    moveTo(a.x, a.y)
                                    cubicTo(middle, a.y, middle, b.y, b.x, b.y)
                                },
                                if (edge.source == selected || edge.target == selected) ink
                                else rule,
                                style =
                                    androidx.compose.ui.graphics.drawscope.Stroke(
                                        max(1f, 1.5f * density * zoom)
                                    ),
                            )
                            val unit = if (right) 1f else -1f
                            drawPath(
                                Path().apply {
                                    moveTo(b.x, b.y)
                                    lineTo(
                                        b.x - unit * 7 * density * zoom,
                                        b.y - 4 * density * zoom,
                                    )
                                    lineTo(
                                        b.x - unit * 7 * density * zoom,
                                        b.y + 4 * density * zoom,
                                    )
                                    close()
                                },
                                rule,
                            )
                            if (
                                allRelations || edge.source == selected || edge.target == selected
                            ) {
                                val label =
                                    edge.label
                                        ?: mapOf(
                                            "explains" to "解释",
                                            "supports" to "支持",
                                            "challenges" to "质疑",
                                            "derives" to "推导",
                                            "refines" to "细化",
                                        )[edge.relation]
                                        ?: edge.relation
                                val paint =
                                    android.graphics
                                        .Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                                        .apply {
                                            textSize = 12 * density * zoom
                                            color = ink.toArgb()
                                            textAlign = android.graphics.Paint.Align.CENTER
                                        }
                                drawContext.canvas.nativeCanvas.drawText(
                                    label,
                                    middle,
                                    (a.y + b.y) / 2 - 4 * density * zoom,
                                    paint,
                                )
                            }
                        }
                }
                researchCanvasStages.forEachIndexed { i, stage ->
                    Column(
                        Modifier.offset {
                                IntOffset(
                                    ((i * 440 * zoom + pan.x) * density).roundToInt(),
                                    ((pan.y) * density).roundToInt(),
                                )
                            }
                            .width(304.dp)
                            .graphicsLayer {
                                scaleX = zoom
                                scaleY = zoom
                                transformOrigin = TransformOrigin(0f, 0f)
                            }
                    ) {
                        Text(
                            "0${i+1}  ${stage.title}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            stage.description,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                map.nodes
                    .filter { it.id in visible }
                    .forEach { node ->
                        val p = positions[node.id] ?: GraphPoint(0.0, 84.0)
                        Surface(
                            onClick = { selected = node.id },
                            shape = RoundedCornerShape(24.dp),
                            color = surface,
                            border =
                                BorderStroke(
                                    if (selected == node.id) 2.dp else 1.dp,
                                    if (selected == node.id) ink else rule,
                                ),
                            modifier =
                                Modifier.offset {
                                        IntOffset(
                                            ((p.x * zoom + pan.x) * density).roundToInt(),
                                            ((p.y * zoom + pan.y) * density).roundToInt(),
                                        )
                                    }
                                    .width(304.dp)
                                    .height(220.dp)
                                    .graphicsLayer {
                                        scaleX = zoom
                                        scaleY = zoom
                                        transformOrigin = TransformOrigin(0f, 0f)
                                    }
                                    .pointerInput(node.id, zoom) {
                                        detectDragGestures { change, delta ->
                                            change.consume()
                                            val old = positions[node.id] ?: p
                                            positions =
                                                positions +
                                                    (node.id to
                                                        GraphPoint(
                                                            old.x + delta.x / density / zoom,
                                                            old.y + delta.y / density / zoom,
                                                        ))
                                        }
                                    },
                        ) {
                            Column(
                                Modifier.padding(20.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Text(
                                    canvasKindLabels[node.kind] ?: node.kind,
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    node.title,
                                    style = MaterialTheme.typography.titleMedium,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    node.summary.orEmpty(),
                                    fontSize = 14.sp,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.weight(1f))
                                Text(
                                    canvasStatusLabels[node.status] ?: node.status,
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                Row(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
                    EpIcon(EpIcons.Add, "放大", { zoom = (zoom * 1.2f).coerceAtMost(1.7f) })
                    EpIcon(EpIcons.Minus, "缩小", { zoom = (zoom / 1.2f).coerceAtLeast(.08f) })
                }
            }
        }
    }
    if (directory)
        LibrarySheet("节点目录", { directory = false }) {
            map.nodes.forEach { node ->
                EpButton(
                    "${canvasKindLabels[node.kind] ?: node.kind}：${node.title}",
                    {
                        selected = node.id
                        directory = false
                    },
                )
            }
        }
    if (picked != null)
        LibrarySheet("节点检查器", { selected = null }) {
            Text(
                canvasKindLabels[picked.kind] ?: picked.kind,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(picked.title, style = MaterialTheme.typography.titleLarge)
            Text(picked.summary ?: "这个节点暂时没有补充说明。你可以让 Agent 继续拆解或补证。")
            Text("状态：${canvasStatusLabels[picked.status] ?: picked.status}")
            Text("连接：${map.relations.count {it.source==picked.id || it.target==picked.id}} 条关系")
            Text("依据：${if(picked.citationIds.isEmpty())"尚未绑定" else "${picked.citationIds.size} 条"}")
            picked.citationIds.forEach { id ->
                val citation =
                    (s.conversation?.turns.orEmpty().flatMap { it.assistant.citations.orEmpty() } +
                            s.pending?.signals?.citations.orEmpty())
                        .firstOrNull { it.citationId == id }
                if (citation != null) EpButton(citation.label, { vm.selectCitation(citation) })
            }
            CanvasNodeEditor(s, vm, picked)
            EpButton(
                "继续研究",
                {
                    selected = null
                    continueNode(picked)
                },
                primary = true,
                enabled = !s.streaming,
            )
        }
}
