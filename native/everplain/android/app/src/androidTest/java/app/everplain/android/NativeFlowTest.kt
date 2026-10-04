package app.everplain.android

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Test-only transport drives the actual Android ViewModel. It never calls a server. */
@RunWith(AndroidJUnit4::class)
class NativeFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun stopBeforeIdentityRecoveryAndCasRemainSafe() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val schemas =
            instrumentation.context.assets.open("codec.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("schemas").jsonObject
            }
        val session =
            WireJson.decodeFromJsonElement<SessionResponse>(schemas.getValue("SessionResponse"))
        val profile =
            WireJson.decodeFromJsonElement<AgentProfileResponse>(
                schemas.getValue("AgentProfileResponse")
            )
        val catalog =
            WireJson.decodeFromJsonElement<AgentModelCatalogResponse>(
                schemas.getValue("AgentModelCatalogResponse")
            )
        val originalConversation =
            WireJson.decodeFromJsonElement<AgentConversationResponse>(
                schemas.getValue("AgentConversationResponse")
            )
        val fake = TestApi(session, profile, originalConversation)
        lateinit var vm: AppViewModel
        compose.runOnUiThread {
            EncryptedStore(compose.activity).clear()
            vm = ViewModelProvider(compose.activity)[AppViewModel::class.java]
            AppViewModel::class
                .java
                .getDeclaredField("api")
                .apply { isAccessible = true }
                .set(vm, fake)
            AppViewModel::class
                .java
                .getDeclaredField("sessionOwner")
                .apply { isAccessible = true }
                .set(vm, session.user.userId)
            @Suppress("UNCHECKED_CAST")
            val mutable =
                AppViewModel::class
                    .java
                    .getDeclaredField("mutable")
                    .apply { isAccessible = true }
                    .get(vm) as MutableStateFlow<AppState>
            mutable.value =
                AppState(
                    starting = false,
                    session = session,
                    profile = profile,
                    catalog = catalog,
                    model = catalog.items.first().modelId,
                    effort = catalog.items.first().defaultReasoningEffort,
                    destination = Destination.Chat,
                    draft = "测试取消，不调用真实模型",
                )
            vm.send()
            vm.send()
        }
        compose.waitUntil(60000) { fake.calls.size == 1 }
        val key = fake.calls.single().second
        compose.runOnUiThread { vm.stop() }
        compose.waitUntil(60000) { !vm.state.value.stopping && !vm.state.value.streaming }
        assertEquals(key, vm.state.value.pending?.key)
        assertFalse(vm.state.value.pending!!.outcomeConfirmed)
        compose.runOnUiThread { vm.resume() }
        compose.waitUntil(60000) { !vm.state.value.busy }
        assertEquals(1, fake.calls.size) // Unknown Stop cannot secretly resume/duplicate.
        fake.visible = true
        compose.runOnUiThread { vm.checkPending() }
        compose.waitUntil(60000) { vm.state.value.pending?.outcomeConfirmed == true }
        fake.startImmediately = true
        compose.runOnUiThread { vm.resume() }
        compose.waitUntil(60000) { fake.calls.size == 2 && vm.state.value.pending?.runId != null }
        assertEquals(key, fake.calls[1].second)
        assertEquals(fake.calls[0].first, fake.calls[1].first)
        compose.runOnUiThread { vm.stop() }
        compose.waitUntil(60000) { !vm.state.value.stopping && !vm.state.value.streaming }
        assertTrue(vm.state.value.pending!!.outcomeConfirmed)
        compose.runOnUiThread {
            vm.saveProfile("新名字", "clear", "测试草稿", "cheng", "#5d8fe6", profile.version)
        }
        compose.waitUntil(60000) { vm.state.value.settingsConflictReady }
        assertEquals(profile.version, fake.profileExpected)
        assertEquals(profile.version + 1, vm.state.value.profile!!.version)
        fake.rejectProfile = false
        compose.runOnUiThread {
            vm.acknowledgeConflict()
            vm.saveProfile("新名字", "clear", "测试草稿", "cheng", "#5d8fe6", profile.version + 1)
        }
        compose.waitUntil(60000) { vm.state.value.settingsSaved == 1L }
        assertEquals("新名字", vm.state.value.profile!!.name)
        // Ending the local wait preserves the old intent and rejects a late stop response,
        // including a transport that finishes despite cancellation.
        fake.stopGate = CompletableDeferred()
        compose.runOnUiThread {
            vm.newChat()
            vm.setDraft("旧请求等待取消")
            vm.send()
        }
        compose.waitUntil(60000) {
            vm.state.value.streaming && vm.state.value.pending?.runId != null
        }
        val abandonedKey = vm.state.value.pending!!.key
        compose.runOnUiThread { vm.stop() }
        compose.waitUntil(60000) { fake.stopWaiting }
        compose.runOnUiThread { vm.endStopWait() }
        assertFalse(vm.state.value.pending!!.outcomeConfirmed)
        assertTrue(vm.state.value.recoveries.any { it.key == abandonedKey })
        compose.runOnUiThread {
            vm.newChat()
            vm.setDraft("独立的新对话")
            vm.send()
        }
        compose.waitUntil(60000) {
            vm.state.value.streaming && vm.state.value.pending?.runId != null
        }
        val independentKey = vm.state.value.pending!!.key
        assertNotEquals(abandonedKey, independentKey)
        fake.stopGate!!.complete(Unit)
        compose.waitUntil(60000) { fake.stopReturned }
        compose.waitForIdle()
        assertTrue(vm.state.value.streaming)
        assertEquals(independentKey, vm.state.value.pending!!.key)
        fake.expired = true
        compose.runOnUiThread { vm.onForeground() }
        compose.waitUntil(60000) { vm.state.value.session == null }
        assertNull(vm.state.value.profile)
        assertNull(vm.state.value.pending)
        assertTrue(vm.state.value.history.isEmpty())
        compose.runOnUiThread { EncryptedStore(compose.activity).clear() }
    }

    private class TestApi(
        val fixtureSession: SessionResponse,
        var fixtureProfile: AgentProfileResponse,
        val fixtureConversation: AgentConversationResponse,
    ) : NativeFixtureApi(Endpoint.parse("https://native-fixture.example.invalid"), MemoryStore()) {
        val calls = mutableListOf<Pair<AgentTurnRequest, String>>()
        var visible = false
        var startImmediately = false
        var expired = false
        var rejectProfile = true
        var profileExpected = -1L
        var stopGate: CompletableDeferred<Unit>? = null
        @Volatile var stopWaiting = false
        @Volatile var stopReturned = false
        private val runId = "00000000-0000-4000-8000-000000000009"

        override suspend fun session(): SessionResponse {
            if (expired) throw ApiFailure(401, "unauthorized", "fixture expired")
            return fixtureSession
        }

        override suspend fun history() = emptyList<AgentConversationSummaryResponse>()

        override suspend fun profile() = fixtureProfile.copy(version = fixtureProfile.version + 1)

        override suspend fun updateProfile(
            update: AgentProfileUpdate,
            key: String,
        ): AgentProfileResponse {
            profileExpected = update.expectedVersion
            if (rejectProfile) throw ApiFailure(409, "conflict", "fixture conflict")
            return fixtureProfile
                .copy(name = update.name!!, version = update.expectedVersion + 1)
                .also { fixtureProfile = it }
        }

        override fun stream(body: AgentTurnRequest, key: String): Flow<SseFrame> = flow {
            calls += body to key
            if (startImmediately) {
                emit(
                    SseFrame(
                        "turn_started",
                        "{\"run_id\":\"$runId\",\"conversation_id\":\"${fixtureConversation.conversationId}\"}",
                    )
                )
                emit(SseFrame("assistant_delta", "{\"delta\":\"测试部分回答\"}"))
            }
            awaitCancellation()
        }

        override suspend fun lookupRun(key: String): AgentRunLookupResponse {
            if (!visible) throw ApiFailure(404, "not_found", "fixture not found")
            return AgentRunLookupResponse(
                true,
                fixtureConversation.conversationId,
                key,
                "测试部分回答",
                calls.last().first,
                runId,
                "interrupted",
                null,
                "2026-10-04T00:00:00Z",
            )
        }

        override suspend fun conversation(id: String) =
            fixtureConversation.copy(
                turns = emptyList(),
                turnCount = 0,
                unfinishedRuns =
                    listOf(
                        AgentRunRecoveryResponse(
                            true,
                            calls.last().second,
                            "测试部分回答",
                            calls.last().first,
                            runId,
                            "interrupted",
                            emptyList(),
                            "2026-10-04T00:00:00Z",
                        )
                    ),
            )

        override suspend fun stop(id: String, key: String): AgentRunStopResponse {
            stopGate?.let { gate ->
                stopWaiting = true
                try {
                    withContext(NonCancellable) { gate.await() }
                } catch (_: CancellationException) {
                    // Deliberately model a transport callback that arrives after cancellation.
                }
                stopReturned = true
            }
            return AgentRunStopResponse(true, id, "interrupted")
        }
    }
}
