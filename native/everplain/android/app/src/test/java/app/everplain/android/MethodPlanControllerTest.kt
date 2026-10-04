package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MethodPlanControllerTest {
    @Test
    fun `confirmation requires saved user decisions and no blocking reviews`() = runTest {
        val api = MethodApi()
        val c = MethodPlanController(api, this, MemoryStore(), "owner", "task") {}
        c.load()
        advanceUntilIdle()
        assertFalse(c.state.value.canConfirm)
        c.confirm()
        advanceUntilIdle()
        assertTrue(api.writes.isEmpty())
        c.edit(index = 0, content = "用户明确选择暂缓，先补充材料")
        assertFalse(c.state.value.canConfirm)
        c.save()
        c.save()
        advanceUntilIdle()
        assertEquals(1, api.writes.size)
        assertTrue(c.state.value.canConfirm)
        c.confirm()
        advanceUntilIdle()
        assertEquals("confirmed", c.state.value.plan!!.status)
        assertTrue(c.state.value.locked)
        c.edit(rationale = "不可改确认版本")
        assertNotEquals("不可改确认版本", c.state.value.draft.rationale)
        c.close()
    }

    @Test
    fun `conflict reload preserves unsaved rationale until explicit rebase`() = runTest {
        val api = MethodApi()
        val c = MethodPlanController(api, this, MemoryStore(), "owner", "task") {}
        c.load()
        advanceUntilIdle()
        c.edit(rationale = "我的判断")
        api.plan = api.plan.copy(version = 2, rationale = "其他设备")
        c.save()
        advanceUntilIdle()
        assertTrue(c.state.value.conflict)
        c.load()
        advanceUntilIdle()
        assertEquals("我的判断", c.state.value.draft.rationale)
        assertEquals(1, c.state.value.draft.version)
        c.rebase()
        c.save()
        advanceUntilIdle()
        assertEquals(3, c.state.value.plan!!.version)
        assertEquals("我的判断", api.plan.rationale)
        c.close()
    }

    @Test
    fun `ambiguous method save survives recreation and retries the original immutable request`() =
        runTest {
            val api = MethodApi()
            val store = MemoryStore()
            val c = MethodPlanController(api, this, store, "owner", "task") {}
            c.load()
            advanceUntilIdle()
            c.edit(rationale = "待核对修改")
            api.lose = true
            c.save()
            advanceUntilIdle()
            assertTrue(c.state.value.unknown)
            c.close()
            val recovered = MethodPlanController(api, this, store, "owner", "task") {}
            recovered.load()
            advanceUntilIdle()
            assertEquals(1, api.writes.size)
            assertTrue(recovered.state.value.unknown)
            api.lose = false
            recovered.retry()
            advanceUntilIdle()
            assertEquals(api.writes[0], api.writes[1])
            assertFalse(recovered.state.value.unknown)
            recovered.close()
        }

    @Test
    fun `confirming an older save preserves later edits and rebases their version`() = runTest {
        val api = MethodApi()
        val store = MemoryStore()
        val c = MethodPlanController(api, this, store, "owner", "task") {}
        c.load()
        advanceUntilIdle()
        c.edit(rationale = "原请求的判断")
        api.lose = true
        c.save()
        advanceUntilIdle()
        c.edit(rationale = "等待期间进一步修改")
        api.lose = false
        c.retry()
        advanceUntilIdle()
        assertEquals(api.writes[0], api.writes[1])
        assertEquals("原请求的判断", api.plan.rationale)
        assertEquals("等待期间进一步修改", c.state.value.draft.rationale)
        assertEquals(2, c.state.value.draft.version)
        assertTrue(c.state.value.dirty)
        assertFalse(c.state.value.unknown)
        c.close()
        val restored = MethodPlanController(api, this, store, "owner", "task") {}
        restored.load()
        advanceUntilIdle()
        assertEquals("等待期间进一步修改", restored.state.value.draft.rationale)
        assertFalse(restored.state.value.conflict)
        restored.save()
        advanceUntilIdle()
        assertEquals("等待期间进一步修改", api.plan.rationale)
        assertEquals(3, api.plan.version)
        assertFalse(restored.state.value.dirty)
        restored.close()
    }
}

private class MethodApi :
    EverplainApi(Endpoint.parse("https://method-fixture.example.invalid"), MemoryStore()) {
    var plan =
        MethodPlanResponse(
            actor = "system",
            changeSummary = "合成初始计划",
            createdAt = "",
            decisionSource = "system",
            ethicalConstraints = emptyList(),
            evidenceRefIds = emptyList(),
            frameworkId = "framework",
            frameworkVersion = 1,
            materialConstraints = emptyList(),
            methodKind = "undecided",
            planId = "plan",
            rationale = "先比较路径",
            researchQuestion = "合成研究问题",
            reviews = emptyList(),
            revisionId = "revision",
            sections = listOf(MethodPlanSectionContract("待用户决定", "decision", "system", "路径判断")),
            sharedContext = emptyList(),
            status = "draft",
            taskId = "task",
            theoryConcepts = emptyList(),
            theoryPlanId = "theory",
            theoryPlanVersion = 1,
            theorySummary = "合成理论",
            version = 1,
        )
    val writes = mutableListOf<Pair<String?, String>>()
    var lose = false

    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        if (method != "GET") {
            writes += key to body!!
            if (lose) throw IOException("Synthetic unknown response")
            if (path.endsWith("/confirm")) {
                val b = WireJson.decodeFromString<ConfirmMethodPlanRequest>(body)
                if (b.expectedVersion != plan.version)
                    throw ApiFailure(409, "version_conflict", "changed")
                plan = plan.copy(version = plan.version + 1, status = "confirmed")
            } else {
                val b = WireJson.decodeFromString<UpdateMethodPlanRequest>(body)
                if (b.expectedVersion != plan.version)
                    throw ApiFailure(409, "version_conflict", "changed")
                plan =
                    plan.copy(
                        version = plan.version + 1,
                        rationale = b.rationale,
                        sections = b.sections,
                        methodKind = b.methodKind,
                    )
            }
        }
        val json =
            if (path.endsWith("/versions"))
                WireJson.encodeToString(MethodPlanVersionListResponse(listOf(plan), plan.planId))
            else WireJson.encodeToString(plan)
        return WireJson.decodeFromString(serializer, json)
    }
}
