package app.everplain.android

import app.everplain.core.WireJson
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.*

class CompanionAssetTest {
    @Test
    fun `authored Xiaoping retains source geometry palette and gradients`() {
        val data =
            WireJson.parseToJsonElement(File("src/main/assets/companion.json").readText())
                .jsonObject
        assertEquals(
            "456b978fa3edaf1e2e8d4f074649411907e46b641fc726dddded36d1ac3d6641",
            data.getValue("sourceSha256").jsonPrimitive.content,
        )
        assertEquals(20, data.getValue("palette").jsonObject.size)
        assertEquals(
            "#e6d8c5",
            data.getValue("palette").jsonObject.getValue("--cp-hair").jsonPrimitive.content,
        )
        assertEquals(4, data.getValue("defs").jsonArray.size)
        val classes = mutableSetOf<String>()
        var count = 0
        fun visit(node: JsonObject) {
            count++
            val attributes = node.getValue("attributes").jsonObject
            attributes["class"]?.jsonPrimitive?.content?.split(' ')?.let { classes.addAll(it) }
            (node["bounds"] as? JsonArray)?.let { bounds ->
                assertEquals(4, bounds.size)
                assertTrue(bounds.all { it.jsonPrimitive.double.isFinite() })
            }
            node.getValue("children").jsonArray.forEach { visit(it.jsonObject) }
        }
        visit(data.getValue("root").jsonObject)
        assertEquals(69, count)
        assertTrue(
            classes.containsAll(
                listOf(
                    "cp-bob",
                    "cp-eyes",
                    "cp-happy",
                    "cp-petal",
                    "cp-ribbon-tail",
                    "cp-strand--c",
                    "cp-ahoge",
                    "cp-hand",
                )
            )
        )
    }
}
