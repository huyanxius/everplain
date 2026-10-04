package app.everplain.android

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.core.*
import app.everplain.shared.*
import kotlin.math.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun GraphScreen(
    graphController: GraphController,
    libraries: LibraryController,
    vm: AppViewModel,
) {
    val g by graphController.state.collectAsStateWithLifecycle()
    val library by libraries.state.collectAsStateWithLifecycle()
    var points by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var edgeId by rememberSaveable { mutableStateOf<String?>(null) }
    var add by rememberSaveable { mutableStateOf(false) }
    var sourceTarget by remember { mutableStateOf<Triple<String, String, String?>?>(null) }
    var allNodes by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    FeatureVisibility(
        graphController,
        {
            graphController.enter()
            libraries.enter()
        },
        {
            graphController.leave()
            libraries.leave()
            libraries.closeSource()
        },
    )
    LaunchedEffect(library.selectedId, points) {
        selected = null
        edgeId = null
        query = ""
    }
    val personal = library.selected == null
    val projection =
        remember(g.graph, library.selected) {
            library.selected?.let(::libraryProjection) ?: g.graph?.let(::personalProjection)
        }
    val personalRecord = selected?.let { g.graph?.sources?.get(it) }.takeIf { personal }
    LaunchedEffect(personalRecord) {
        if (personalRecord != null) {
            sourceTarget =
                Triple(
                    personalRecord.libraryId,
                    personalRecord.documentId,
                    personalRecord.segmentId,
                )
            libraries.source(
                personalRecord.libraryId,
                personalRecord.documentId,
                personalRecord.segmentId,
            )
        }
    }
    if (add) LibraryImportSheet(libraries, "extension") { add = false }
    if (library.source != null || library.sourceBusy || library.sourceError != null)
        LibrarySourceSheet(
            library,
            {
                libraries.closeSource()
                sourceTarget = null
            },
        ) {
            sourceTarget?.let { libraries.source(it.first, it.second, it.third) }
        }
    fun openSource(libraryId: String, documentId: String, segment: String? = null) {
        sourceTarget = Triple(libraryId, documentId, segment)
        libraries.source(libraryId, documentId, segment)
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                Row(
                    Modifier.clickable { menu = true },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        library.selected?.name ?: "全部资料",
                        style = MaterialTheme.typography.headlineSmall,
                        modifier = Modifier.weight(1f, false),
                    )
                    Icon(EpIcons.ExpandMore, null, Modifier.size(18.dp))
                }
                DropdownMenu(
                    menu,
                    { menu = false },
                    shape = RoundedCornerShape(20.dp),
                    containerColor = MaterialTheme.colorScheme.surface,
                ) {
                    DropdownMenuItem(
                        text = { Text("全部资料") },
                        onClick = {
                            libraries.select(null)
                            menu = false
                        },
                    )
                    library.owned.forEach { value ->
                        DropdownMenuItem(
                            text = { Text(value.name.orEmpty()) },
                            onClick = {
                                libraries.select(value.id)
                                menu = false
                            },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("管理知识库") },
                        onClick = {
                            menu = false
                            vm.navigate(Destination.Library)
                        },
                    )
                }
            }
            EpButton("添加", { add = true }, primary = true, enabled = !library.busy)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            KnowledgeViewSwitch(true, { vm.navigate(Destination.Library) }, {})
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow,
            ) {
                Row {
                    EpButton("关系图", { points = false }, selected = !points)
                    EpButton("知识点", { points = true }, selected = points)
                }
            }
        }
        EpField(
            if (personal && !points) "搜索我的图谱" else "搜索知识",
            query,
            {
                query = it
                selected = null
                edgeId = null
            },
            showLabel = false,
            placeholder = if (personal && !points) "找一个节点" else "知识点、概念或方法",
        )
        if (points) {
            if (library.loading) AgentLiquid(label = "正在读取知识…")
            library.error?.let { LibraryNotice(it, true, "重新读取") { libraries.load() } }
            library.catalogError?.let { LibraryNotice(it, true, "重试读取") { libraries.load() } }
            val groups =
                remember(library.materials, query) {
                    library.materials
                        .groupBy { it.library }
                        .map { (owner, docs) ->
                            owner to
                                libraryProjection(
                                        owner.copy(
                                            documents =
                                                docs
                                                    .map { it.document }
                                                    .filter { it.status == "ready" }
                                        )
                                    )
                                    .topics
                                    .values
                                    .filter { topic ->
                                        "${topic.title} ${topic.evidence.joinToString { "${it.summary} ${it.filename}" }}"
                                            .contains(query.trim(), true)
                                    }
                        }
                }
            Text(
                "${groups.sumOf { it.second.size }} 个知识点 · ${library.materials.size} 份资料",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            groups.forEach { (owner, topics) ->
                topics.forEach { topic ->
                    LibraryCard {
                        Text(topic.title, style = MaterialTheme.typography.titleLarge)
                        Text(
                            "${owner.name} · ${topic.evidence.size} 份来源",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        topic.evidence.forEach { source ->
                            Text(source.summary, fontFamily = FontFamily.Serif)
                            Text(
                                source.filename,
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (source.segmentIds.isEmpty())
                                EpButton("阅读原文", { openSource(owner.id, source.documentId) })
                            else
                                source.segmentIds.forEachIndexed { i, segment ->
                                    EpButton(
                                        "阅读原文${if(source.segmentIds.size>1)" · ${i+1}" else ""}",
                                        { openSource(owner.id, source.documentId, segment) },
                                    )
                                }
                        }
                    }
                }
            }
            if (!library.loading && groups.all { it.second.isEmpty() })
                Text(
                    if (query.isBlank()) "知识尚未整理完成。资料仍可打开阅读，处理状态可在资料页中查看。" else "没有找到相关知识点。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        } else {
            if (personal && g.loading || !personal && library.loading)
                AgentLiquid(label = "正在展开你的知识图谱")
            (if (personal) g.error else library.error)?.let {
                LibraryNotice(it, true, "重新读取") {
                    if (personal) graphController.load() else libraries.load()
                }
            }
            if (projection != null) {
                if (personal) {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        projection.nodes
                            .filter { it.type == "topic" }
                            .forEach { node ->
                                EpButton(
                                    node.label,
                                    {
                                        selected = if (selected == node.id) null else node.id
                                        query = ""
                                    },
                                    selected = selected == node.id,
                                )
                            }
                    }
                    Text(
                        "${g.graph!!.documentCount} 份资料 · ${g.graph!!.topicCount} 个主题 · ${projection.nodes.size} 节点 · ${projection.edges.size} 关系",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow {
                        EpButton(
                            if (g.refreshing) "正在更新…" else if (g.unresolved) "重试原更新请求" else "更新图谱",
                            graphController::refresh,
                            enabled = !g.refreshing,
                        )
                        EpButton(
                            "和 ${g.graph!!.name} 聊聊",
                            { vm.newChatWithLibrary(personalRecord?.libraryId) },
                        )
                    }
                } else
                    Text(
                        "${projection.topics.size} 个知识点 · ${library.selected?.documents?.size ?: 0} 份资料",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                if (personal || projection.topics.isNotEmpty()) {
                    NativeGraphCanvas(
                        projection,
                        personal,
                        selected,
                        edgeId,
                        g.graph?.avatarId,
                        g.graph?.color,
                        onSelect = {
                            selected = it
                            edgeId = null
                        },
                        onEdge = {
                            edgeId = it
                            selected = null
                        },
                        browse = { allNodes = true },
                    )
                } else
                    Text(
                        "知识尚未整理完成。资料仍可打开阅读，处理状态可在资料页中查看。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                if (personal && g.graph!!.documentCount == 0L) {
                    Text("每个想法，都可以从这里开始。", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "导入几份收藏或笔记，慢慢长出你的知识图谱。",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EpButton("带来第一份资料", { add = true }, secondary = true)
                }
                if (personal && g.graph!!.pendingCount > 0)
                    Text(
                        "${g.graph!!.pendingCount} 份资料等待归类${if(g.graph!!.mode=="semantic")"，需要完成语义索引" else ""}",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                if (!personal)
                    Text(
                        "同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                val selectedNode = projection.nodes.firstOrNull { it.id == selected }
                val topic = projection.topics[selected]
                val edge = projection.edges.firstOrNull { it.id == edgeId }
                val doc =
                    library.selected?.documents?.firstOrNull { "document:${it.id}" == selected }
                val neighbors =
                    projection.edges
                        .flatMap {
                            if (it.source == selected) listOf(it.target)
                            else if (it.target == selected) listOf(it.source) else emptyList()
                        }
                        .toSet()
                val results =
                    projection.nodes.filter {
                        it.type != "self" &&
                            (if (query.isNotBlank()) it.label.contains(query.trim(), true)
                            else if (allNodes) true else it.id in neighbors)
                    }
                if (query.isNotBlank() || allNodes || selected != null || edgeId != null)
                    LibraryCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (personalRecord != null) "原文"
                                else if (query.isNotBlank() || allNodes) "找到 ${results.size} 个结果"
                                else if (!personal) "原文依据" else "节点详情",
                                Modifier.weight(1f),
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            EpIcon(
                                EpIcons.Close,
                                "关闭节点面板",
                                {
                                    query = ""
                                    selected = null
                                    edgeId = null
                                    allNodes = false
                                },
                            )
                        }
                        selectedNode?.let {
                            Text(it.label, style = MaterialTheme.typography.titleLarge)
                        }
                        when {
                            personalRecord != null -> {
                                EpButton(
                                    "阅读原文",
                                    {
                                        openSource(
                                            personalRecord.libraryId,
                                            personalRecord.documentId,
                                            personalRecord.segmentId,
                                        )
                                    },
                                    primary = true,
                                )
                                EpButton(
                                    "在资料库中打开",
                                    {
                                        libraries.select(personalRecord.libraryId)
                                        vm.navigate(Destination.Library)
                                    },
                                )
                                personalRecord.sourceUrl
                                    ?.takeIf {
                                        it.startsWith("https://") || it.startsWith("http://")
                                    }
                                    ?.let { url -> EpButton("访问来源网页", { uriHandler.openUri(url) }) }
                            }
                            topic != null ->
                                topic.evidence.forEach { source ->
                                    Text(source.summary, fontFamily = FontFamily.Serif)
                                    Text(
                                        source.filename,
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    source.segmentIds.forEachIndexed { i, segment ->
                                        EpButton(
                                            "阅读原文 · ${source.filename}${if(source.segmentIds.size>1)" · ${i+1}" else ""}",
                                            {
                                                openSource(
                                                    library.selectedId!!,
                                                    source.documentId,
                                                    segment,
                                                )
                                            },
                                        )
                                    }
                                }
                            doc != null -> {
                                Text(doc.knowledge?.summary.orEmpty())
                                EpButton(
                                    "阅读原文",
                                    { openSource(library.selectedId!!, doc.id) },
                                    primary = true,
                                )
                            }
                            edge?.documentId != null -> {
                                Text(edge.label)
                                edge.segmentIds.forEachIndexed { i, segment ->
                                    EpButton(
                                        "阅读关系依据 · ${i+1}",
                                        {
                                            openSource(
                                                library.selectedId!!,
                                                edge.documentId!!,
                                                segment,
                                            )
                                        },
                                    )
                                }
                            }
                            else -> {
                                results.take(80).forEach { node ->
                                    Row(
                                        Modifier.fillMaxWidth()
                                            .clip(RoundedCornerShape(10.dp))
                                            .clickable {
                                                selected = node.id
                                                query = ""
                                                allNodes = false
                                            }
                                            .padding(12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Icon(EpIcons.FileText, null, Modifier.size(17.dp))
                                        Column(Modifier.weight(1f)) {
                                            Text(node.label, fontSize = 14.sp)
                                            Text(
                                                when (node.type) {
                                                    "topic" -> "主题"
                                                    "document" -> "资料"
                                                    else -> "知识点"
                                                },
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Icon(EpIcons.ArrowUpRight, null, Modifier.size(14.dp))
                                    }
                                }
                                if (results.isEmpty())
                                    Text(
                                        if (query.isNotBlank()) "换一个词试试看。" else "这个节点暂时还没有关联资料。",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                            }
                        }
                    }
                if (personal && g.graph!!.mode == "mock")
                    Text(
                        "当前为本地演示归类；接入专用模型后可进行语义归类与主题命名。",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        }
    }
}

@Composable
internal fun KnowledgeViewSwitch(graph: Boolean, cards: () -> Unit, map: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Row(Modifier.padding(4.dp)) {
            Surface(
                onClick = cards,
                shape = CircleShape,
                color = if (!graph) MaterialTheme.colorScheme.surface else Color.Transparent,
            ) {
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    Icon(EpIcons.SquaresFour, "资料卡片", Modifier.size(18.dp))
                }
            }
            Surface(
                onClick = map,
                shape = CircleShape,
                color = if (graph) MaterialTheme.colorScheme.surface else Color.Transparent,
            ) {
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    Icon(EpIcons.Graph, "图谱", Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun NativeGraphCanvas(
    graph: NativeGraph,
    personal: Boolean,
    selected: String?,
    selectedEdge: String?,
    avatar: String?,
    color: String?,
    onSelect: (String) -> Unit,
    onEdge: (String) -> Unit,
    browse: () -> Unit,
) {
    var seed by remember { mutableIntStateOf(0) }
    var positions by remember { mutableStateOf<Map<String, GraphPoint>>(emptyMap()) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var layoutBusy by remember { mutableStateOf(true) }
    val density = LocalDensity.current.density
    val scheme = MaterialTheme.colorScheme
    val ink = scheme.onSurface
    val faint = scheme.onSurfaceVariant
    val surface = scheme.surface
    val rule = scheme.outline
    val neighbors =
        remember(graph, selected) {
            graph.edges
                .flatMap {
                    if (it.source == selected) listOf(it.target)
                    else if (it.target == selected) listOf(it.source) else emptyList()
                }
                .toSet()
        }
    fun fit() {
        if (positions.isEmpty() || canvasSize.width == 0 || graph.nodes.any { it.id !in positions })
            return
        val minX = graph.nodes.minOf { positions[it.id]!!.x - it.diameter / 2 }
        val maxX = graph.nodes.maxOf { positions[it.id]!!.x + it.diameter / 2 }
        val minY = graph.nodes.minOf { positions[it.id]!!.y - it.diameter / 2 }
        val maxY = graph.nodes.maxOf { positions[it.id]!!.y + it.diameter / 2 }
        val pad = min(canvasSize.width, canvasSize.height) * .22f
        zoom =
            min(
                    (canvasSize.width - 2 * pad) / ((maxX - minX).coerceAtLeast(1.0) * density),
                    (canvasSize.height - 2 * pad) / ((maxY - minY).coerceAtLeast(1.0) * density),
                )
                .toFloat()
                .coerceIn(.16f, 3.2f)
        pan =
            Offset(
                (-(minX + maxX) / 2 * density * zoom).toFloat(),
                (-(minY + maxY) / 2 * density * zoom).toFloat(),
            )
    }
    LaunchedEffect(graph, seed) {
        layoutBusy = true
        positions =
            withContext(Dispatchers.Default) {
                if (personal) personalConcentricLayout(graph.nodes)
                else libraryCoseLayout(graph, seed)
            }
        layoutBusy = false
        fit()
    }
    LaunchedEffect(canvasSize) { fit() }
    fun screen(point: GraphPoint) =
        Offset(canvasSize.width / 2f, canvasSize.height / 2f) +
            pan +
            Offset((point.x * density * zoom).toFloat(), (point.y * density * zoom).toFloat())
    Box(
        Modifier.fillMaxWidth()
            .height(440.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(surface)
            .onSizeChanged { canvasSize = it }
    ) {
        Canvas(
            Modifier.fillMaxSize()
                .semantics {
                    contentDescription = "节点式知识图谱，${graph.nodes.size} 个节点，${graph.edges.size} 个关系"
                }
                .pointerInput(graph, positions, zoom, pan) {
                    detectTransformGestures { centroid, panning, scale, _ ->
                        val old = zoom
                        val next = (old * scale).coerceIn(.16f, 3.2f)
                        val center = Offset(canvasSize.width / 2f, canvasSize.height / 2f)
                        pan =
                            (pan - (centroid - center)) * (next / old) +
                                (centroid - center) +
                                panning
                        zoom = next
                    }
                }
                .pointerInput(graph, positions, zoom, pan) {
                    detectTapGestures { tap ->
                        val node =
                            graph.nodes.minByOrNull {
                                positions[it.id]?.let { p -> (screen(p) - tap).getDistance() }
                                    ?: Float.MAX_VALUE
                            }
                        if (
                            node != null &&
                                positions[node.id] != null &&
                                (screen(positions[node.id]!!) - tap).getDistance() <=
                                    max(
                                        22 * density,
                                        (node.diameter / 2 * density * zoom).toFloat(),
                                    )
                        )
                            onSelect(node.id)
                        else
                            graph.edges
                                .minByOrNull { e ->
                                    val a = positions[e.source]?.let(::screen)
                                    val b = positions[e.target]?.let(::screen)
                                    if (a != null && b != null) pointSegmentDistance(tap, a, b)
                                    else Float.MAX_VALUE
                                }
                                ?.let { e ->
                                    val a = positions[e.source]?.let(::screen)
                                    val b = positions[e.target]?.let(::screen)
                                    if (
                                        a != null &&
                                            b != null &&
                                            pointSegmentDistance(tap, a, b) < 12 * density
                                    )
                                        onEdge(e.id)
                                }
                    }
                }
        ) {
            if (positions.isEmpty()) return@Canvas
            graph.edges.forEach { edge ->
                val a = positions[edge.source]?.let(::screen) ?: return@forEach
                val b = positions[edge.target]?.let(::screen) ?: return@forEach
                val related = selected == null || edge.source == selected || edge.target == selected
                val alpha = if (edge.id == selectedEdge) .9f else if (related) .32f else .12f
                drawLine(
                    faint.copy(alpha = alpha),
                    a,
                    b,
                    strokeWidth = (if (edge.id == selectedEdge) 2.2f else 1f) * density,
                    pathEffect =
                        if (edge.layer == "candidate")
                            PathEffect.dashPathEffect(floatArrayOf(4 * density, 4 * density))
                        else null,
                )
                if (edge.direction in setOf("directed", "outbound", "bidirectional")) {
                    val direction = b - a
                    val length = direction.getDistance()
                    if (length > 0) {
                        val unit = direction / length
                        val radius =
                            graph.nodes
                                .firstOrNull { it.id == edge.target }
                                ?.diameter
                                ?.div(2)
                                ?.toFloat() ?: 5f
                        val tip = b - unit * (radius * density * zoom + 3 * density)
                        val back = tip - unit * (5 * density)
                        val normal = Offset(-unit.y, unit.x) * 2.8f * density
                        drawPath(
                            Path().apply {
                                moveTo(tip.x, tip.y)
                                lineTo((back + normal).x, (back + normal).y)
                                lineTo((back - normal).x, (back - normal).y)
                                close()
                            },
                            faint.copy(alpha = alpha),
                        )
                    }
                }
            }
            val paint =
                Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    typeface = Typeface.SERIF
                    textAlign = Paint.Align.CENTER
                }
            graph.nodes.forEach { node ->
                val point = positions[node.id]?.let(::screen) ?: return@forEach
                val context = selected != null && node.id != selected && node.id !in neighbors
                val r = (node.diameter / 2 * density * zoom).toFloat()
                val selectedNode = node.id == selected
                if (node.type != "self") {
                    if (selectedNode) drawCircle(faint.copy(alpha = .15f), r + 7 * density, point)
                    drawCircle(
                        (if (selectedNode || node.type == "dimension") ink else faint).copy(
                            alpha = if (context) .42f else .92f
                        ),
                        r,
                        point,
                    )
                    drawCircle(
                        if (selectedNode) rule else surface,
                        r,
                        point,
                        style = Stroke(1.5f * density * zoom),
                    )
                }
                val font =
                    when (node.type) {
                        "topic" -> 12f
                        "knowledge" -> 9f
                        else -> 10f
                    } * zoom
                if (!context && font >= 8) {
                    paint.textSize = font * density
                    paint.color = ink.toArgb()
                    paint.alpha = 235
                    val label = node.label.take(80)
                    drawContext.canvas.nativeCanvas.drawText(
                        label,
                        point.x,
                        point.y - r - 8 * density * zoom,
                        paint,
                    )
                }
            }
        }
        graph.nodes
            .firstOrNull { it.type == "self" }
            ?.let { node ->
                positions[node.id]?.let { p ->
                    val point = screen(p)
                    Box(
                        Modifier.offset {
                                IntOffset(
                                    (point.x - 35 * density).roundToInt(),
                                    (point.y - 35 * density).roundToInt(),
                                )
                            }
                            .graphicsLayer {
                                scaleX = zoom
                                scaleY = zoom
                            }
                    ) {
                        AgentAvatar(
                            avatar ?: "cheng",
                            color,
                            node.label,
                            70,
                            playing = false,
                            decorative = true,
                        )
                    }
                }
            }
        Column(
            Modifier.align(Alignment.TopStart).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            EpIcon(
                EpIcons.Add,
                "放大",
                {
                    zoom = (zoom * 1.2f).coerceAtMost(3.2f)
                    pan *= 1.2f
                },
            )
            EpIcon(
                EpIcons.Minus,
                "缩小",
                {
                    zoom = (zoom / 1.2f).coerceAtLeast(.16f)
                    pan /= 1.2f
                },
            )
        }
        Row(Modifier.align(Alignment.TopEnd).padding(12.dp)) {
            EpIcon(EpIcons.CornersOut, "适应画布", ::fit)
            EpIcon(EpIcons.Shuffle, "重新布局", { seed++ })
        }
        if (personal)
            Row(
                Modifier.align(Alignment.BottomEnd).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                listOf("我", "主题", "资料", "知识点").forEach { Text(it, fontSize = 12.sp, color = faint) }
            }
        EpButton(
            "浏览节点",
            browse,
            modifier =
                Modifier.align(Alignment.BottomStart).semantics { contentDescription = "以列表浏览图谱节点" },
        )
        if (layoutBusy)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                AgentLiquid(label = "正在展开图谱")
            }
    }
}

private fun pointSegmentDistance(point: Offset, a: Offset, b: Offset): Float {
    val v = b - a
    val w = point - a
    val length = v.x * v.x + v.y * v.y
    val t = if (length == 0f) 0f else ((w.x * v.x + w.y * v.y) / length).coerceIn(0f, 1f)
    return (point - (a + v * t)).getDistance()
}
