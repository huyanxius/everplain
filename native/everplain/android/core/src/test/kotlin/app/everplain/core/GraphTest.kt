package app.everplain.core

import app.everplain.shared.*
import java.io.File
import kotlin.test.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*

class GraphTest {
    @Test
    fun `native personal rings match real source Cytoscape golden coordinates`() {
        val data =
            WireJson.parseToJsonElement(
                    File(System.getProperty("everplain.graph.fixture")).readText()
                )
                .jsonObject
        data.getValue("cases").jsonArray.forEach { raw ->
            val case = raw.jsonObject
            val nodes =
                case.getValue("nodes").jsonArray.map { v ->
                    val n = v.jsonObject
                    NativeGraphNode(
                        n.getValue("id").jsonPrimitive.content,
                        "",
                        n.getValue("type").jsonPrimitive.content,
                        n.getValue("level").jsonPrimitive.long,
                    )
                }
            val points = personalConcentricLayout(nodes)
            case.getValue("positions").jsonObject.forEach { (id, p) ->
                val expected = p.jsonObject
                val actual = points.getValue(id)
                assertEquals(expected.getValue("x").jsonPrimitive.double, actual.x, 1e-8, "$id.x")
                assertEquals(expected.getValue("y").jsonPrimitive.double, actual.y, 1e-8, "$id.y")
            }
        }
    }

    @Test
    fun `same title knowledge groups NFKC without losing distinct source evidence`() {
        val first =
            SharedDocumentResponse(
                "",
                filename = "first",
                id = "one",
                knowledge =
                    CourseKnowledgeResponse(
                        summary = "",
                        topics = listOf(CourseTopicResponse(listOf("s1"), "first meaning", "ＡI")),
                    ),
                knowledgeStatus = "ready",
                mediaType = "text/plain",
                parseId = "p1",
                sizeBytes = 1,
                status = "ready",
            )
        val second =
            first.copy(
                filename = "second",
                id = "two",
                knowledge =
                    CourseKnowledgeResponse(
                        summary = "",
                        topics = listOf(CourseTopicResponse(listOf("s2"), "second meaning", "AI")),
                    ),
            )
        val g =
            libraryProjection(
                SharedKnowledgeResponse(
                    id = "kb",
                    documents = listOf(first, second),
                    name = "Source",
                    viewerAccess = "owner",
                )
            )
        assertEquals(1, g.topics.size)
        assertEquals(2, g.topics.getValue("topic:AI").evidence.size)
        assertEquals(
            listOf("s1", "s2"),
            g.topics.getValue("topic:AI").evidence.flatMap { it.segmentIds },
        )
        assertEquals(4, g.edges.size)
    }

    @Test
    fun `connected native COSE returns stable finite positions for a fixed seed`() = runBlocking {
        val g =
            NativeGraph(
                listOf(
                    NativeGraphNode("root", "Library", "dimension"),
                    NativeGraphNode("doc", "File", "category"),
                    NativeGraphNode("topic", "Topic", "entry"),
                ),
                listOf(
                    NativeGraphEdge("1", "root", "doc", "资料"),
                    NativeGraphEdge("2", "doc", "topic", "涉及"),
                ),
            )
        val result = libraryCoseLayout(g, 7)
        assertEquals(result, libraryCoseLayout(g, 7))
        assertEquals(g.nodes.size, result.size)
        assertTrue(result.values.all { it.x.isFinite() && it.y.isFinite() })
        assertTrue(result.values.distinct().size == 3)
    }
}

class ResearchCanvasLayoutTest {
    @Test
    fun `source role columns preserve dragged coordinates and avoid new overlaps`() {
        fun node(id: String, kind: String) =
            AgentResearchMapNodeResponse(emptyList(), id, kind, "developing", null, id)
        val nodes =
            listOf(
                node("q", "question"),
                node("p", "phenomenon"),
                node("t", "theory"),
                node("e", "evidence"),
                node("d", "document"),
            )
        val points = arrangeResearchCanvas(nodes)
        assertEquals(GraphPoint(0.0, 84.0), points["q"])
        assertEquals(GraphPoint(0.0, 368.0), points["p"])
        assertEquals(GraphPoint(440.0, 84.0), points["t"])
        assertEquals(GraphPoint(880.0, 84.0), points["e"])
        assertEquals(GraphPoint(1320.0, 84.0), points["d"])
        val dragged = points + ("q" to GraphPoint(100.0, 200.0))
        val next = arrangeResearchCanvas(nodes + node("q2", "question"), dragged)
        assertEquals(dragged["q"], next["q"])
        assertTrue(next.values.distinct().size == 6)
    }
}
