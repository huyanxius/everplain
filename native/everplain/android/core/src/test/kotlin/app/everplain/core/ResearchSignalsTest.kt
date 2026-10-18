package app.everplain.core

import java.io.File
import kotlin.test.*
import kotlinx.serialization.json.*

class ResearchSignalsTest {
    @Test
    fun `shared real semantic shapes preserve wait state tools citations canvas and exact integers`() {
        val events =
            WireJson.parseToJsonElement(
                    File(System.getProperty("everplain.fixtures"), "research-events.json")
                        .readText()
                )
                .jsonObject
                .getValue("events")
                .jsonArray
        var state = NativeTurnSignals()
        events.forEach { v ->
            val item = v.jsonObject
            state =
                reduceTurnSignals(
                    state,
                    item.getValue("event").jsonPrimitive.content,
                    item.getValue("payload").jsonObject,
                )
        }
        assertEquals("awaiting_plan_confirmation", state.research.waitingState)
        assertEquals("planning", state.research.stage)
        assertEquals(2, state.tools.size)
        assertEquals(
            9007199254740993L,
            state.tools.first().output!!.jsonObject.getValue("opaque_integer").jsonPrimitive.long,
        )
        assertEquals("synthetic-citation", state.citations.single().citationId)
        assertEquals("synthetic-node", state.canvas!!.nodes.single().id)
        val patch = events.last().jsonObject.getValue("payload").jsonObject
        assertEquals(state, reduceTurnSignals(state, "canvas_patch", patch))
    }

    @Test
    fun `unknown semantic event is forward compatible without completing generation`() {
        val state = NativeTurnSignals(research = NativeResearchProgress(stage = "researching"))
        assertEquals(
            state,
            reduceTurnSignals(state, "future_event", buildJsonObject { put("completed", true) }),
        )
    }
}
