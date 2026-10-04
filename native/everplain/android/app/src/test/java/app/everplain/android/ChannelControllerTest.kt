package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(ExperimentalCoroutinesApi::class)
class ChannelControllerTest {
    @Test
    fun `read only entry never creates code and consent is required for each selected bot`() =
        runTest {
            val api = ChannelApi()
            val c = ChannelController(api, this) {}
            c.enter()
            runCurrent()
            assertEquals(0, api.creates)
            c.generate()
            runCurrent()
            assertEquals(0, api.creates)
            c.consent(true)
            c.generate()
            c.generate()
            runCurrent()
            assertEquals(1, api.creates)
            assertNotNull(c.state.value.grant)
            c.select("two")
            assertFalse(c.state.value.consent)
            assertNull(c.state.value.grant)
            c.generate()
            runCurrent()
            assertEquals(1, api.creates)
            c.close()
        }

    @Test
    fun `leaving hides sensitive code and stops read polling without invalidating server code`() =
        runTest {
            val api = ChannelApi()
            val c = ChannelController(api, this) {}
            c.enter()
            runCurrent()
            c.consent(true)
            c.generate()
            runCurrent()
            val reads = api.reads
            c.leave()
            advanceTimeBy(10000)
            runCurrent()
            assertNull(c.state.value.grant)
            assertEquals(reads, api.reads)
            assertEquals(0, api.cancels)
            c.close()
        }

    @Test
    fun `late grant from a dismissed owner view never reappears`() = runTest {
        val api = ChannelApi().apply { defer = CompletableDeferred() }
        val c = ChannelController(api, this) {}
        c.enter()
        runCurrent()
        c.consent(true)
        c.generate()
        runCurrent()
        c.leave()
        c.enter()
        api.defer!!.complete(Unit)
        runCurrent()
        assertNull(c.state.value.grant)
        c.close()
    }
}

private class ChannelApi :
    EverplainApi(Endpoint.parse("https://channel-fixture.example.invalid"), MemoryStore()) {
    var creates = 0
    var reads = 0
    var cancels = 0
    var defer: CompletableDeferred<Unit>? = null

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val text =
            when {
                path.endsWith("/gateways") ->
                    WireJson.encodeToString(
                        listOf(
                            ChannelGatewayInfoResponse(null, "one", "合成机器人", "telegram"),
                            ChannelGatewayInfoResponse(null, "two", "另一机器人", "feishu"),
                        )
                    )
                path.endsWith("/bindings") -> {
                    reads++
                    "[]"
                }
                path.endsWith("/link-codes") -> {
                    creates++
                    assertTrue(
                        WireJson.decodeFromString<ChannelLinkCodeRequest>(body!!)
                            .acknowledgePrivateDataAndUsage
                    )
                    defer?.await()
                    WireJson.encodeToString(
                        ChannelLinkCodeResponse(
                            "synthetic-test-only",
                            System.currentTimeMillis() / 1000 + 300,
                            "one",
                        )
                    )
                }
                else -> error("Unexpected fixture path $path")
            }
        return WireJson.decodeFromString(serializer, text)
    }

    override suspend fun contractUnit(
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ) {
        cancels++
    }
}
