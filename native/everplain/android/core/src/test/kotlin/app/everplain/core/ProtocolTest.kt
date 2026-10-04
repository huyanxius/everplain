package app.everplain.core

import app.everplain.shared.*
import java.io.File
import java.util.Base64
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.*
import okhttp3.Cookie
import okhttp3.mockwebserver.*

class ProtocolTest {
    private fun fixture(name: String) =
        WireJson.parseToJsonElement(File(System.getProperty("everplain.fixtures"), name).readText())
            .jsonObject

    @Test
    fun `all shared codec samples decode using generated DTOs`() {
        val samples = fixture("codec.json").getValue("schemas").jsonObject
        samples.forEach { (name, json) ->
            when (name) {
                "SessionResponse" -> WireJson.decodeFromJsonElement<SessionResponse>(json)
                "AgentModelCatalogResponse" ->
                    WireJson.decodeFromJsonElement<AgentModelCatalogResponse>(json)
                "AgentProfileUpdate" -> WireJson.decodeFromJsonElement<AgentProfileUpdate>(json)
                "LoginSessionRequest" -> WireJson.decodeFromJsonElement<LoginSessionRequest>(json)
                "AgentTurnRequest" -> WireJson.decodeFromJsonElement<AgentTurnRequest>(json)
                "AgentProfileResponse" -> WireJson.decodeFromJsonElement<AgentProfileResponse>(json)
                "AgentConversationResponse" ->
                    WireJson.decodeFromJsonElement<AgentConversationResponse>(json)
                "AgentConversationListResponse" ->
                    WireJson.decodeFromJsonElement<AgentConversationListResponse>(json)
                "AccountResponse" -> WireJson.decodeFromJsonElement<AccountResponse>(json)
                "AccountSessionPageResponse" ->
                    WireJson.decodeFromJsonElement<AccountSessionPageResponse>(json)
                "CreditSummaryResponse" ->
                    WireJson.decodeFromJsonElement<CreditSummaryResponse>(json)
                "ErrorResponse" -> WireJson.decodeFromJsonElement<ErrorResponse>(json)
                "AgentRunLookupResponse" ->
                    WireJson.decodeFromJsonElement<AgentRunLookupResponse>(json)
                "AgentRunStopResponse" -> WireJson.decodeFromJsonElement<AgentRunStopResponse>(json)
                else -> fail("Uncovered shared DTO: $name")
            }
        }
    }

    @Test
    fun `expanded module codecs preserve provided fields and exact large integers`() {
        val roundTripJson = Json(WireJson) { explicitNulls = true }
        fun assertFields(input: JsonElement, output: JsonElement) {
            if (input is JsonObject)
                input.forEach { (key, value) ->
                    assertTrue(output.jsonObject.containsKey(key), "Missing wire key $key")
                    assertFields(value, output.jsonObject.getValue(key))
                }
            else if (input is JsonArray) {
                assertEquals(input.size, output.jsonArray.size)
                input.forEachIndexed { i, value -> assertFields(value, output.jsonArray[i]) }
            } else assertEquals(input, output)
        }
        fixture("codec-core.json").getValue("schemas").jsonObject.forEach { (name, data) ->
            val encoded =
                when (name) {
                    "PersonalGraphResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<PersonalGraphResponse>(data)
                        )
                    "SharedKnowledgeResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<SharedKnowledgeResponse>(data)
                        )
                    "MemorySettings" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<MemorySettings>(data)
                        )
                    "ResearchTaskResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<ResearchTaskResponse>(data)
                        )
                    "ResearchMaterialResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<ResearchMaterialResponse>(data)
                        )
                    "ResearchDocumentResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<ResearchDocumentResponse>(data)
                        )
                    "SubscriptionOverviewResponse" ->
                        roundTripJson.encodeToJsonElement(
                            roundTripJson.decodeFromJsonElement<SubscriptionOverviewResponse>(data)
                        )
                    else -> fail("Uncovered expanded DTO $name")
                }
            assertFields(data, encoded)
        }
    }

    @Test
    fun `registration uses actual generated bodies and cookie transport`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val session =
                fixture("codec.json")
                    .getValue("schemas")
                    .jsonObject
                    .getValue("SessionResponse")
                    .toString()
            server.enqueue(
                MockResponse().setBody("{\"status\":\"sent\",\"resend_after_seconds\":60}")
            )
            server.enqueue(
                MockResponse()
                    .setHeader("Set-Cookie", "everplain_session=synthetic; Path=/; HttpOnly")
                    .setBody(session)
            )
            server.enqueue(MockResponse().setBody(session))
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            assertEquals(
                60,
                api.sendRegistrationCode("synthetic@example.invalid").resendAfterSeconds,
            )
            val code = server.takeRequest()
            assertEquals("/api/session/registration-code", code.path)
            assertEquals("POST", code.method)
            assertFalse(code.getHeader("Idempotency-Key").isNullOrBlank())
            assertEquals(
                "synthetic@example.invalid",
                WireJson.decodeFromString<RegistrationCodeRequest>(code.body.readUtf8()).email,
            )
            api.register("synthetic@example.invalid", "synthetic-only-password", "123456")
            val register = server.takeRequest()
            assertEquals("/api/session/register", register.path)
            val body = WireJson.decodeFromString<RegisterSessionRequest>(register.body.readUtf8())
            assertEquals("123456", body.verificationCode)
            assertNull(body.displayName)
            assertNotEquals(
                code.getHeader("Idempotency-Key"),
                register.getHeader("Idempotency-Key"),
            )
            api.session()
            assertEquals("everplain_session=synthetic", server.takeRequest().getHeader("Cookie"))
        }
    }

    @Test
    fun `shared SSE cases survive every wire chunk boundary`() {
        fixture("sse.json").getValue("cases").jsonArray.forEach { element ->
            val case = element.jsonObject
            val parser = SseDecoder()
            val actual = mutableListOf<SseFrame>()
            case.getValue("chunks_base64").jsonArray.forEach { chunk ->
                actual += parser.feed(Base64.getDecoder().decode(chunk.jsonPrimitive.content))
            }
            val expected =
                case.getValue("expected_events").jsonArray.map {
                    it.jsonObject.let { event ->
                        SseFrame(
                            event.getValue("event").jsonPrimitive.content,
                            event.getValue("data").jsonPrimitive.content,
                        )
                    }
                }
            assertEquals(expected, actual, case.getValue("name").jsonPrimitive.content)
        }
    }

    @Test
    fun `oversized SSE cannot exhaust memory`() {
        val parser = SseParser(12)
        assertFailsWith<IllegalArgumentException> { parser.line("data: " + "x".repeat(50)) }
    }

    @Test
    fun `production endpoint rejects http embedded credentials path query fragment`() {
        listOf(
                "http://example.com",
                "https://user:password@example.com",
                "https://example.com/api",
                "https://example.com/?x=1",
                "https://example.com/#x",
            )
            .forEach { assertFails { Endpoint.parse(it) } }
        assertEquals("https://example.com/", Endpoint.parse("https://example.com").url.toString())
        assertFails { Endpoint.parse("http://example.com", true) }
    }

    @Test
    fun `cookies persist in supplied private store and never cross origins`() {
        val origin = Endpoint.parse("https://example.com").url
        val store = MemoryStore()
        val jar = SessionCookies(origin, store)
        jar.saveFromResponse(
            origin,
            listOf(
                Cookie.parse(
                    origin,
                    "everplain_session=opaque; Path=/; HttpOnly; Secure; Max-Age=600",
                )!!
            ),
        )
        assertEquals("opaque", SessionCookies(origin, store).loadForRequest(origin).single().value)
        assertTrue(jar.loadForRequest(Endpoint.parse("https://other.example.com").url).isEmpty())
        assertTrue(jar.loadForRequest(Endpoint.parse("https://example.com:8443").url).isEmpty())
        jar.saveFromResponse(
            origin,
            listOf(Cookie.parse(origin, "everplain_session=; Path=/; Max-Age=0")!!),
        )
        assertTrue(jar.loadForRequest(origin).isEmpty())
    }

    @Test
    fun `login cookie authenticates subsequent stream and retry keeps intent key`(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.start()
                val session =
                    fixture("codec.json")
                        .getValue("schemas")
                        .jsonObject
                        .getValue("SessionResponse")
                        .toString()
                server.enqueue(
                    MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setHeader("Set-Cookie", "everplain_session=opaque; Path=/; HttpOnly")
                        .setBody(session)
                )
                repeat(2) {
                    server.enqueue(
                        MockResponse()
                            .setHeader("Content-Type", "text/event-stream")
                            .setBody("event: turn_interrupted\ndata: {\"message\":\"stopped\"}\n\n")
                    )
                }
                val api =
                    EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
                api.login("fixture", "user-entered-test-only")
                val login = server.takeRequest()
                assertEquals("POST", login.method)
                assertNotNull(login.getHeader("Idempotency-Key"))
                val request =
                    AgentTurnRequest(message = "fixture", mode = "standard", workspace = "agent")
                repeat(2) {
                    api.stream(request, "fixed-intent-key").toList()
                    val sent = server.takeRequest()
                    assertEquals("everplain_session=opaque", sent.getHeader("Cookie"))
                    assertEquals("fixed-intent-key", sent.getHeader("Idempotency-Key"))
                    assertEquals("text/event-stream", sent.getHeader("Accept"))
                    assertEquals("POST", sent.method)
                }
            }
        }

    @Test
    fun `EOF without terminal is interruption and wrong MIME is rejected`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "text/event-stream")
                    .setBody("event: assistant_delta\ndata: {\"delta\":\"partial\"}\n\n")
            )
            assertFailsWith<StreamDisconnected> {
                api.stream(AgentTurnRequest(message = "fixture"), "unique-key").toList()
            }
            server.enqueue(
                MockResponse().setHeader("Content-Type", "text/html").setBody("<html>Login</html>")
            )
            assertFailsWith<java.io.IOException> {
                api.stream(AgentTurnRequest(message = "fixture"), "unique-key").toList()
            }
        }
    }

    @Test
    fun `authorization and CAS errors preserve status and message`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            listOf(401, 403, 409).forEach { status ->
                server.enqueue(
                    MockResponse()
                        .setResponseCode(status)
                        .setHeader("Content-Type", "application/json")
                        .setChunkedBody(
                            "{\"error\":{\"code\":\"fixture\",\"message\":\"specific failure\",\"trace_id\":\"fixture\"}}",
                            3,
                        )
                )
                val error = assertFailsWith<ApiFailure> { api.session() }
                assertEquals(status, error.status)
                assertEquals("specific failure", error.message)
            }
        }
    }

    @Test
    fun `redirects are rejected instead of forwarding login credentials`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            server.enqueue(
                MockResponse().setResponseCode(307).setHeader("Location", "https://other.invalid")
            )
            assertFailsWith<ApiFailure> { api.login("fixture", "test") }
            assertEquals(1, server.requestCount)
        }
    }

    @Test
    fun `cancellation closes an idle SSE socket promptly`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "text/event-stream")
                    .setBody(": heartbeat\n\n")
                    .setSocketPolicy(SocketPolicy.KEEP_OPEN)
                    .throttleBody(1, 1, java.util.concurrent.TimeUnit.SECONDS)
            )
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            withTimeout(5000) {
                val work = launch {
                    api.stream(AgentTurnRequest(message = "fixture"), "cancel-intent-key").toList()
                }
                delay(100)
                work.cancelAndJoin()
            }
        }
    }

    @Test
    fun `cancellation closes a JSON body after headers arrived`(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val session =
                fixture("codec.json")
                    .getValue("schemas")
                    .jsonObject
                    .getValue("SessionResponse")
                    .toString()
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody(session)
                    .throttleBody(1, 1, java.util.concurrent.TimeUnit.SECONDS)
            )
            val api = EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
            val work = launch { api.session() }
            withContext(Dispatchers.IO) { server.takeRequest() }
            delay(150) // First body byte has arrived, subsequent bytes are deliberately slow.
            withTimeout(3000) { work.cancelAndJoin() }
            assertTrue(work.isCancelled)
        }
    }

    @Test
    fun `stop retains stable intent and distinguishes requested from confirmed`(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.start()
                val id = "00000000-0000-4000-8000-000000000001"
                server.enqueue(
                    MockResponse()
                        .setResponseCode(202)
                        .setHeader("Content-Type", "application/json")
                        .setBody(
                            "{\"run_id\":\"$id\",\"status\":\"running\",\"cancel_requested\":true}"
                        )
                )
                server.enqueue(MockResponse().setResponseCode(204))
                val api =
                    EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
                assertEquals("running", api.stop(id, "stop-intent-key").status)
                assertEquals("interrupted", api.stop(id, "stop-intent-key").status)
                repeat(2) {
                    assertEquals(
                        "stop-intent-key",
                        server.takeRequest().getHeader("Idempotency-Key"),
                    )
                }
            }
        }

    @Test
    fun `run key lookup is read only uses original header and keeps 404 uncertain`(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.start()
                val api =
                    EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
                server.enqueue(
                    MockResponse()
                        .setResponseCode(404)
                        .setHeader("Content-Type", "application/json")
                        .setBody(
                            "{\"error\":{\"code\":\"not_found\",\"message\":\"not found\",\"trace_id\":\"fixture\"}}"
                        )
                )
                assertEquals(
                    404,
                    assertFailsWith<ApiFailure> { api.lookupRun("original-turn-key") }.status,
                )
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/agent/runs/by-idempotency-key", request.path)
                assertEquals("original-turn-key", request.getHeader("Idempotency-Key"))
                assertEquals(0L, request.bodySize)
                assertEquals(1, server.requestCount)
            }
        }
}
