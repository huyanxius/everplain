package app.everplain.android

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import kotlin.math.min

@Composable
internal fun HomeContext(vm: AppViewModel) {
    val research = vm.research()
    val projects by research.state.collectAsStateWithLifecycle()
    val graph = vm.graph()
    val g by graph.state.collectAsStateWithLifecycle()
    LaunchedEffect(research, graph) {
        research.load(includeFiles = false)
        graph.load()
    }
    val top = projects.projects.sortedByDescending { it.updatedAt }.firstOrNull()
    val pending = g.graph?.pendingCount ?: 0
    when {
        projects.error != null || g.error != null ->
            EpButton(
                "重新读取伙伴设置",
                {
                    vm.refresh()
                    research.load(includeFiles = false)
                    graph.load()
                },
            )
        projects.loading || g.loading ->
            Text(
                "正在读取你的近况…",
                fontSize = 16.sp,
                lineHeight = 27.2.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        top != null || pending > 0 ->
            FlowRow {
                if (top != null) {
                    Text(
                        "上次停在",
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "《${researchTitle(top)}》",
                        Modifier.clickable { vm.openResearch(top) },
                        fontSize = 16.sp,
                    )
                }
                if (pending > 0)
                    Text(
                        "${if(top!=null)"，还有 " else ""}$pending 份资料没整理。",
                        Modifier.clickable { vm.navigate(Destination.Library) },
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        else ->
            Text(
                "这里还空着。丢一份资料，或者问一个你想弄清楚的问题。",
                fontSize = 16.sp,
                lineHeight = 27.2.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
    }
}

@Composable
internal fun HomeContents(s: AppState, vm: AppViewModel) {
    val research by vm.research().state.collectAsStateWithLifecycle()
    val graph by vm.graph().state.collectAsStateWithLifecycle()
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        EpButton(
            "找回以前收藏过的资料",
            {
                vm.newChat()
                vm.setDraft("帮我找回以前收藏过的资料")
            },
            secondary = true,
        )
        EpButton(
            "把资料串起来",
            {
                vm.newChat()
                vm.setDraft("帮我把资料之间的联系整理一下")
            },
            secondary = true,
        )
    }
    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "接着研究",
            Modifier.weight(1f),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (open == "hand") EpButton("收起", { open = null })
        Text(
            "全部 →",
            Modifier.clickable { vm.navigate(Destination.Research) }.padding(vertical = 6.dp),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    val projects = research.projects.sortedByDescending { it.updatedAt }.take(3)
    when {
        research.loading ->
            LibraryCard {
                Text(
                    "正在读取最近研究",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        research.error != null ->
            LibraryNotice(research.error!!, true, "重新加载研究") {
                vm.research().load(includeFiles = false)
            }
        projects.isEmpty() ->
            Surface(
                onClick = vm::newResearch,
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().height(212.dp),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(EpIcons.Add, null, Modifier.size(22.dp))
                    Text("开始第一项研究", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "还没有研究项目",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "问 ${s.profile?.name ?: "Agent"} 一个问题，或者从一份资料出发",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        else ->
            HomePile(
                "hand",
                projects.size,
                open == "hand",
                { open = if (it) "hand" else null },
                navigate = { vm.openResearch(projects[it]) },
            ) { i, expanded ->
                val project = projects[i]
                Text(
                    project.stageLabel,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    researchTitle(project),
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (expanded || i == 0) {
                    project.phenomenonSummary
                        ?.phenomenon
                        ?.takeIf { it != researchTitle(project) }
                        ?.let {
                            Text(
                                it,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    project.blocker?.let {
                        Text(
                            it.message,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "更新于 ${researchDate(project.updatedAt)} · ${project.nextActionLabel.ifBlank { "继续研究" }} →",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "我的资料",
            Modifier.weight(1f),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (open == "deck") EpButton("收起", { open = null })
        Text(
            "知识库 →",
            Modifier.clickable { vm.navigate(Destination.Library) }.padding(vertical = 6.dp),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    val documents =
        graph.graph
            ?.nodes
            .orEmpty()
            .filter {
                it.nodeType == "document" && graph.graph?.sources?.containsKey(it.id) == true
            }
            .take(3)
    when {
        graph.loading ->
            LibraryCard {
                Text("正在读取资料", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        graph.error != null -> LibraryNotice(graph.error!!, true, "重试") { vm.graph().load() }
        (graph.graph?.documentCount ?: 0) == 0L ->
            Surface(
                onClick = { vm.navigate(Destination.Library) },
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                modifier = Modifier.fillMaxWidth().heightIn(min = 138.dp),
            ) {
                Row(
                    Modifier.padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(EpIcons.UploadSimple, null, Modifier.size(22.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("把第一份资料，放进来。", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "浏览器收藏、Obsidian、Markdown 或 PDF",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        else ->
            HomePile(
                "deck",
                documents.size,
                open == "deck",
                { open = if (it) "deck" else null },
                navigate = { i ->
                    val source = graph.graph!!.sources.getValue(documents[i].id)
                    vm.library().select(source.libraryId)
                    vm.navigate(Destination.Library)
                    vm.library().source(source.libraryId, source.documentId)
                },
                cover = {
                    Text(
                        "${graph.graph!!.documentCount} 份资料 · ${graph.graph!!.topicCount} 个主题",
                        fontSize = 17.sp,
                    )
                    documents.take(2).forEach {
                        Text(
                            it.label,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (graph.graph!!.pendingCount > 0)
                        Text(
                            "${graph.graph!!.pendingCount} 份待整理",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                },
            ) { i, _ ->
                val node = documents[i]
                val source = graph.graph!!.sources.getValue(node.id)
                Text(
                    if (source.sourceUrl != null) "网页收藏" else "我的笔记",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    node.label,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
    }
}

/**
 * Original Pile geometry/timing: native hit testing, same hand/deck offsets, 600ms overshooting
 * curve.
 */
@Composable
private fun HomePile(
    kind: String,
    count: Int,
    open: Boolean,
    toggle: (Boolean) -> Unit,
    navigate: (Int) -> Unit,
    cover: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.(Int, Boolean) -> Unit,
) {
    val motion = rememberMotionEnabled()
    val t by
        animateFloatAsState(
            if (open) 1f else 0f,
            tween(if (motion) 600 else 0, easing = CubicBezierEasing(.22f, 1.28f, .36f, 1f)),
            label = "source pile",
        )
    val row = if (kind == "hand") 196f else 112f
    val closed = if (kind == "hand") 236f else 152f
    val card = if (kind == "hand") 212f else 138f
    val height = closed + (maxOf(0f, count * (row + 12) - 12) - closed) * t
    BoxWithConstraints(Modifier.fillMaxWidth().height(height.coerceAtLeast(0f).dp)) {
        val width = maxWidth
        for (i in (count - 1) downTo 0) {
            val depth = min(i + if (cover != null) 1 else 0, 2)
            val x = if (kind == "hand") depth * 22f else depth * 6f
            val y = if (kind == "hand") depth * 10f else depth * 6f
            Surface(
                onClick = { if (open) navigate(i) else toggle(true) },
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 2.dp,
                modifier =
                    Modifier.offset((x * (1 - t)).dp, (y * (1 - t) + i * (row + 12) * t).dp)
                        .width(width - 44.dp * (1 - t))
                        .height((card + (row - card) * t).dp)
                        .graphicsLayer {
                            rotationZ = if (kind == "hand") depth * 2.5f * (1 - t) else 0f
                            transformOrigin = androidx.compose.ui.graphics.TransformOrigin(.3f, 1f)
                            alpha =
                                if (i + (if (cover != null) 1 else 0) >= 3) t.coerceIn(0f, 1f)
                                else 1f
                        },
            ) {
                Column(
                    Modifier.padding(20.dp).graphicsLayer {
                        alpha = if (i == 0 && cover == null) 1f else t.coerceIn(0f, 1f)
                    },
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    content(i, open)
                }
            }
        }
        if (cover != null && t < 1f)
            Surface(
                onClick = { toggle(true) },
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 2.dp,
                modifier =
                    Modifier.width(width - 44.dp).height(card.dp).graphicsLayer {
                        alpha = (1 - t).coerceIn(0f, 1f)
                        translationY = -8 * t
                        scaleX = 1 - .03f * t
                        scaleY = scaleX
                    },
            ) {
                Column(
                    Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    content = cover,
                )
            }
        if (!open)
            Box(
                Modifier.fillMaxSize()
                    .clickable { toggle(true) }
                    .semantics { contentDescription = if (kind == "hand") "展开研究" else "展开资料" }
            )
    }
}
