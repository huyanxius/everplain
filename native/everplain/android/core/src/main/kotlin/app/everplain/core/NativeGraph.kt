package app.everplain.core

import app.everplain.shared.*
import java.text.Normalizer
import kotlin.math.*
import kotlin.random.Random
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

data class GraphPoint(val x: Double, val y: Double)

data class NativeGraphNode(
    val id: String,
    val label: String,
    val type: String,
    val level: Long = 2,
) {
    val diameter: Double
        get() =
            when (type) {
                "self" -> 70.0
                "topic" -> 18.0
                "knowledge" -> 6.0
                "dimension" -> 20.0
                "category" -> 12.0
                else -> 10.0
            }
}

data class NativeGraphEdge(
    val id: String,
    val source: String,
    val target: String,
    val label: String,
    val layer: String = "structure",
    val direction: String = "directed",
    val documentId: String? = null,
    val segmentIds: List<String> = emptyList(),
)

data class GraphEvidence(
    val documentId: String,
    val filename: String,
    val summary: String,
    val segmentIds: List<String>,
)

data class GraphTopic(val title: String, val evidence: List<GraphEvidence>)

data class NativeGraph(
    val nodes: List<NativeGraphNode>,
    val edges: List<NativeGraphEdge>,
    val topics: Map<String, GraphTopic> = emptyMap(),
)

fun personalProjection(value: PersonalGraphResponse) =
    NativeGraph(
        value.nodes.map { NativeGraphNode(it.id, it.label, it.nodeType, it.level) },
        value.edges.map {
            NativeGraphEdge(it.id, it.source, it.target, it.relationType, "structure", it.direction)
        },
    )

/** Exact CourseKnowledgePage identity/grouping rules; same-title explanations remain separate. */
fun libraryProjection(library: SharedKnowledgeResponse): NativeGraph {
    val nodes =
        mutableListOf(NativeGraphNode("course:${library.id}", library.name ?: "知识库", "dimension"))
    val edges = mutableListOf<NativeGraphEdge>()
    val topics = linkedMapOf<String, GraphTopic>()
    fun key(title: String) = "topic:" + Normalizer.normalize(title, Normalizer.Form.NFKC).trim()
    library.documents
        .orEmpty()
        .filter { it.knowledgeStatus == "ready" && it.knowledge != null }
        .forEach { document ->
            val docId = "document:${document.id}"
            nodes += NativeGraphNode(docId, document.filename, "category")
            edges += NativeGraphEdge("contains:${document.id}", nodes.first().id, docId, "资料")
            document.knowledge!!.topics.forEach { topic ->
                val id = key(topic.title)
                val existing = topics[id]
                topics[id] =
                    GraphTopic(
                        existing?.title ?: topic.title,
                        existing?.evidence.orEmpty() +
                            GraphEvidence(
                                document.id,
                                document.filename,
                                topic.summary,
                                topic.segmentIds,
                            ),
                    )
                edges += NativeGraphEdge("$docId:$id", docId, id, "涉及")
            }
            document.knowledge.relations.orEmpty().forEachIndexed { i, relation ->
                edges +=
                    NativeGraphEdge(
                        "relation:${document.id}:$i",
                        key(relation.source),
                        key(relation.target),
                        relation.label,
                        "candidate",
                        "directed",
                        document.id,
                        relation.segmentIds,
                    )
            }
        }
    topics.forEach { (id, topic) -> nodes += NativeGraphNode(id, topic.title, "entry") }
    val ids = nodes.map { it.id }.toSet()
    return NativeGraph(
        nodes,
        edges.distinctBy { it.id }.filter { it.source in ids && it.target in ids },
        topics,
    )
}

/** Ports the source Cytoscape concentric metrics (MIT): 4-level, width1, spacing38, equidistant. */
fun personalConcentricLayout(nodes: List<NativeGraphNode>): Map<String, GraphPoint> {
    if (nodes.isEmpty()) return emptyMap()
    val levels = nodes.sortedBy { it.level }.groupBy { it.level }.values.toList()
    val minDistance = nodes.maxOf { it.diameter + if (it.type == "self") 0.0 else 3.0 } + 38.0
    var radius = 0.0
    val radii =
        levels.map { level ->
            if (level.size > 1) {
                val angle = 2 * PI / level.size
                radius =
                    max(
                        radius,
                        sqrt(
                            minDistance * minDistance /
                                ((cos(angle) - 1).pow(2) + sin(angle).pow(2))
                        ),
                    )
            }
            radius.also { radius += minDistance }
        }
    // Cytoscape's equidistant pass takes max absolute ring radius, not adjacent radius delta.
    val step = radii.maxOrNull() ?: 0.0
    return buildMap {
        levels.forEachIndexed { i, level ->
            val r = radii.first() + step * i
            level.forEachIndexed { j, node ->
                val angle = 1.5 * PI + 2 * PI * j / level.size
                put(node.id, GraphPoint(r * cos(angle), r * sin(angle)))
            }
        }
    }
}

/**
 * Non-compound connected COSE used by CourseKnowledgePage. Source forces and defaults, in native
 * math.
 */
suspend fun libraryCoseLayout(graph: NativeGraph, seed: Int = 0): Map<String, GraphPoint> {
    if (graph.nodes.size <= 1) return graph.nodes.associate { it.id to GraphPoint(0.0, 0.0) }
    data class Particle(
        val node: NativeGraphNode,
        var x: Double,
        var y: Double,
        var fx: Double = 0.0,
        var fy: Double = 0.0,
    )
    val random = Random(seed)
    val nodes =
        graph.nodes.map { Particle(it, random.nextDouble() * 600, random.nextDouble() * 600) }
    val byId = nodes.associateBy { it.node.id }
    fun clip(n: Particle, dx: Double, dy: Double): GraphPoint {
        val half = (n.node.diameter + 3) / 2
        if (dx == 0.0) return GraphPoint(n.x, n.y + half) // preserved source vertical branch
        val slope = dy / dx
        return if (abs(slope) <= 1) {
            val side = if (dx > 0) half else -half
            GraphPoint(n.x + side, n.y + side * slope)
        } else {
            val side = if (dy > 0) half else -half
            GraphPoint(n.x + side * dx / dy, n.y + side)
        }
    }
    var temperature = 1000.0
    for (iteration in 0 until 800) {
        if (iteration % 8 == 0) currentCoroutineContext().ensureActive()
        for (i in nodes.indices) for (j in i + 1 until nodes.size) {
            val a = nodes[i]
            val b = nodes[j]
            var dx = b.x - a.x
            var dy = b.y - a.y
            if (dx == 0.0 && dy == 0.0) {
                dx = random.nextDouble(-1.0, 1.0)
                dy = random.nextDouble(-1.0, 1.0)
            }
            // COSE updatePositions stores +/- full node width in its overlap boundaries.
            val boundFactor = if (iteration == 0) .5 else 1.0
            val ox = (a.node.diameter + b.node.diameter + 6) * boundFactor - abs(dx)
            val oy = (a.node.diameter + b.node.diameter + 6) * boundFactor - abs(dy)
            val fx: Double
            val fy: Double
            if (ox >= 0 && oy >= 0) {
                val d = hypot(dx, dy).coerceAtLeast(.0001)
                val force = 14 * hypot(ox, oy)
                fx = force * dx / d
                fy = force * dy / d
            } else {
                val p = clip(a, dx, dy)
                val q = clip(b, -dx, -dy)
                val x = q.x - p.x
                val y = q.y - p.y
                val d = hypot(x, y).coerceAtLeast(.0001)
                val force = 180000 / (d * d)
                fx = force * x / d
                fy = force * y / d
            }
            a.fx -= fx
            a.fy -= fy
            b.fx += fx
            b.fy += fy
        }
        graph.edges.forEach { edge ->
            val a = byId[edge.source] ?: return@forEach
            val b = byId[edge.target] ?: return@forEach
            val dx = b.x - a.x
            val dy = b.y - a.y
            if (dx != 0.0 || dy != 0.0) {
                val p = clip(a, dx, dy)
                val q = clip(b, -dx, -dy)
                val x = q.x - p.x
                val y = q.y - p.y
                val d = hypot(x, y)
                if (d > 0) {
                    val force = (54 - d).pow(2) / 120
                    val fx = force * x / d
                    val fy = force * y / d
                    a.fx += fx
                    a.fy += fy
                    b.fx -= fx
                    b.fy -= fy
                }
            }
        }
        nodes.forEach { n ->
            val x = 300 - n.x
            val y = 300 - n.y
            val d = hypot(x, y)
            if (d > 1) {
                n.fx += .34 * x / d
                n.fy += .34 * y / d
            }
            val force = hypot(n.fx, n.fy)
            val scale = if (force > temperature) temperature / force else 1.0
            n.x += n.fx * scale
            n.y += n.fy * scale
            n.fx = 0.0
            n.fy = 0.0
        }
        temperature *= .99
        if (temperature < 1) break
    }
    val cx = (nodes.minOf { it.x } + nodes.maxOf { it.x }) / 2
    val cy = (nodes.minOf { it.y } + nodes.maxOf { it.y }) / 2
    return nodes.associate { it.node.id to GraphPoint(it.x - cx, it.y - cy) }
}
