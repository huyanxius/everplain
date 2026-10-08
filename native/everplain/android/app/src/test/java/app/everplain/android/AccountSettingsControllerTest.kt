package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(ExperimentalCoroutinesApi::class)
class AccountSettingsControllerTest {
    @Test
    fun `preference double tap sends once and unknown retry retains exact key and body`() =
        runTest {
            val api = SettingsApi()
            val c = AccountSettingsController(api, this, api.account, {}, {}, {})
            api.lose = true
            c.savePreferences("en-US", "UTC", 3)
            c.savePreferences("en-US", "UTC", 3)
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertTrue(c.state.value.unknown)
            c.savePreferences("zh-CN", "UTC", 3)
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            api.lose = false
            c.savePreferences("en-US", "UTC", 3)
            advanceUntilIdle()
            assertEquals(api.writes[0], api.writes[1])
            assertEquals("en-US", c.state.value.account!!.preferences.locale)
            assertFalse(c.state.value.unknown)
            c.close()
        }

    @Test
    fun `CAS refresh reads without replay and does not quietly use a new version`() = runTest {
        val api = SettingsApi()
        val c = AccountSettingsController(api, this, api.account, {}, {}, {})
        api.conflict = true
        c.savePreferences("en-US", "UTC", 3)
        advanceUntilIdle()
        assertTrue(c.state.value.conflict)
        api.account = api.account.copy(preferences = api.account.preferences.copy(version = 9))
        c.load()
        advanceUntilIdle()
        assertEquals(1, api.writes.size)
        assertEquals(9, c.state.value.account!!.preferences.version)
        c.endLocalWait()
        api.conflict = false
        c.savePreferences("en-US", "UTC", 9)
        advanceUntilIdle()
        assertTrue(api.writes.last().second.contains("\"expected_version\":9"))
        c.close()
    }

    @Test
    fun `password length confirmation and current session guards avoid network writes`() = runTest {
        val api = SettingsApi()
        val c = AccountSettingsController(api, this, api.account, {}, {}, {})
        c.changePassword("test current", "short", "short", true)
        c.changePassword("test current", "twelve characters", "does not match", true)
        c.revoke(api.session)
        advanceUntilIdle()
        assertEquals(0, api.writes.size)
        c.changePassword(
            "synthetic-current",
            "synthetic-next-password",
            "synthetic-next-password",
            true,
        )
        advanceUntilIdle()
        assertEquals(1, api.writes.size)
        assertEquals("password", c.state.value.completedAction)
        c.close()
    }

    @Test
    fun `protected administrator cannot deactivate or delete and closed owner discards reads`() =
        runTest {
            val api = SettingsApi()
            api.account = api.account.copy(isProtectedAdmin = true)
            var updates = 0
            val c =
                AccountSettingsController(
                    api,
                    this,
                    api.account,
                    { updates++ },
                    { fail("Must not end access") },
                    {},
                )
            c.deactivate("synthetic", "reason")
            c.delete("synthetic", api.account.email)
            advanceUntilIdle()
            assertTrue(api.writes.isEmpty())
            c.load()
            c.close()
            advanceUntilIdle()
            assertEquals(0, updates)
        }
}

private class SettingsApi :
    EverplainApi(Endpoint.parse("https://settings-fixture.example.invalid"), MemoryStore()) {
    var account =
        AccountResponse(
            "",
            "测试",
            "fixture@example.invalid",
            false,
            null,
            AccountPreferencesResponse("v1", null, "zh-CN", false, true, "Asia/Shanghai", 3),
            "member",
            "active",
            "",
            "owner",
            1,
        )
    val session = AccountSessionResponse("", true, "测试设备", "", null, "", "session")
    val writes = mutableListOf<Pair<String?, String>>()
    var lose = false
    var conflict = false

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        val payload =
            when {
                method == "GET" && path == "/api/account" -> WireJson.encodeToString(account)
                method == "GET" && path.endsWith("/sessions") ->
                    WireJson.encodeToString(AccountSessionPageResponse(listOf(session)))
                path.endsWith("/preferences") -> {
                    writes += key to body!!
                    if (lose) throw IOException("Synthetic lost reply")
                    if (conflict) throw ApiFailure(409, "version_conflict", "Changed")
                    val r = WireJson.decodeFromString<UpdatePreferencesRequest>(body)
                    account =
                        account.copy(
                            preferences =
                                account.preferences.copy(
                                    locale = r.locale,
                                    timezone = r.timezone,
                                    version = r.expectedVersion + 1,
                                )
                        )
                    WireJson.encodeToString(account.preferences)
                }
                path.endsWith("/password/change") -> {
                    writes += key to body!!
                    WireJson.encodeToString(ChangePasswordResponse(0))
                }
                else -> error("Unexpected fixture request $method $path")
            }
        return WireJson.decodeFromString(serializer, payload)
    }
}
