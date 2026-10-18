package app.everplain.core

import app.everplain.shared.AgentResearchMapNodeResponse
import kotlin.math.abs

data class ResearchCanvasStage(val title: String, val description: String, val kinds: List<String>)

val researchCanvasStages =
    listOf(
        ResearchCanvasStage("研究起点", "问题与现象", listOf("question", "phenomenon")),
        ResearchCanvasStage("解释与主张", "如何理解这个问题", listOf("theory", "claim")),
        ResearchCanvasStage("证据与待证", "已有依据与尚待回答", listOf("evidence", "gap")),
        ResearchCanvasStage("综合与写作", "形成判断，写入文稿", listOf("synthesis", "document")),
    )

/** Exact original researchCanvasLayout.ts spacing and stable prior-position policy. */
fun arrangeResearchCanvas(
    nodes: List<AgentResearchMapNodeResponse>,
    previous: Map<String, GraphPoint> = emptyMap(),
): Map<String, GraphPoint> {
    val positions = linkedMapOf<String, GraphPoint>()
    nodes.forEach { node -> previous[node.id]?.let { positions[node.id] = it } }
    fun stage(node: AgentResearchMapNodeResponse) =
        researchCanvasStages.indexOfFirst { node.kind in it.kinds }.let { if (it < 0) 3 else it }
    nodes
        .sortedWith(
            compareBy<AgentResearchMapNodeResponse> { stage(it) }
                .thenBy { researchCanvasStages[stage(it)].kinds.indexOf(it.kind) }
                .thenBy { it.id }
        )
        .forEach { node ->
            if (node.id !in positions) {
                val x = stage(node) * 440.0
                var y = 84.0
                while (positions.values.any { abs(it.x - x) < 328 && abs(it.y - y) < 252 }) y += 284
                positions[node.id] = GraphPoint(x, y)
            }
        }
    return positions
}
