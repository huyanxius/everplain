import XCTest
@testable import EverplainCore

final class AgentProgressTests: XCTestCase {
    func testEverySharedResearchSemanticEventDecodes() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "research-events", withExtension: "json", subdirectory: "Fixtures"))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let events = try XCTUnwrap(value["events"] as? [[String: Any]])
        XCTAssertEqual(events.count, 11)
        for item in events {
            let name = try XCTUnwrap(item["event"] as? String)
            let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(item["payload"]))
            let event = try AgentEvent(SSEFrame(event: name, data: String(decoding: data, as: UTF8.self)))
            XCTAssertNotEqual(event, .ignored, "\(name) must be understood by native research")
        }
    }
    func testHistoricalToolPhasesReduceToOneActionWithoutLosingEvidence() {
        let steps = NativeToolStep.fromTraces([
            AgentToolTraceResponse(callId: "same-call", input: ["query": .string("original")], phase: "started", tool: "search_knowledge"),
            AgentToolTraceResponse(callId: "same-call", output: .object(["count": .integer(1)]), phase: "finished", tool: "search_knowledge")
        ])
        XCTAssertEqual(steps.count, 1); XCTAssertEqual(steps[0].status, "completed")
        XCTAssertEqual(steps[0].input, .object(["query": .string("original")]))
        XCTAssertEqual(steps[0].output, .object(["count": .integer(1)]))
    }
    func testDeepWaitingIsQuiescentAndPreservesExactRunState() throws {
        let event = try AgentEvent(SSEFrame(event: "research_waiting", data: #"{"run_id":"8fd44df0-1f21-4fa9-a0d4-8f17acd21d6e","state":"awaiting_clarification","question":"研究哪个角度？","options":["制度","经历"],"prompt":"原问题"}"#))
        guard case .researchWaiting(let waiting) = event else { return XCTFail("Waiting must be a distinct nonterminal event") }
        var state = NativeResearchProgress(); state.apply(waiting)
        XCTAssertEqual(state.stage, "clarifying"); XCTAssertEqual(state.options, ["制度", "经历"])
        XCTAssertEqual(state.prompt, "原问题")
        XCTAssertThrowsError(try AgentEvent(SSEFrame(event: "research_waiting", data: #"{"state":"completed"}"#)))
    }
    func testResearchConfirmationKeepsOriginalKeyModelMaterialsAndScope() throws {
        let request = AgentTurnRequest(conversationId: "conversation", materialIds: ["material-a"], message: "原始问题", mode: "deep_research", modelId: "catalog-model", reasoningEffort: "high", taskId: "task-owner", webSearch: true, workspace: "research")
        var previous = PendingTurn(request: request, key: "original-key", runId: "known-run")
        previous.status = "awaiting_plan_confirmation"
        let next = try previous.researchContinuation(action: "confirm", selection: nil, conversationId: "conversation")
        XCTAssertEqual(next.key, previous.key); XCTAssertEqual(next.runId, previous.runId)
        XCTAssertEqual(next.request.modelId, request.modelId); XCTAssertEqual(next.request.reasoningEffort, request.reasoningEffort)
        XCTAssertEqual(next.request.materialIds, request.materialIds); XCTAssertEqual(next.request.taskId, request.taskId)
        XCTAssertEqual(next.request.deepResearchRunId, "known-run"); XCTAssertEqual(next.request.deepResearchAction, "confirm")
        XCTAssertThrowsError(try previous.researchContinuation(action: "clarify", selection: "方向", conversationId: nil))
        previous.status = "interrupted"
        XCTAssertThrowsError(try previous.researchContinuation(action: "confirm", selection: nil, conversationId: nil))
    }
    func testInterleavedToolsAreMatchedByCallIdAndStatusIsReal() throws {
        let payloads = [
            ("tool_started", #"{"tool":"search_knowledge","call_id":"a","input":{"query":"真实查询"}}"#),
            ("tool_started", #"{"tool":"search_knowledge","call_id":"b","input":{"query":"第二查询"}}"#),
            ("tool_finished", #"{"tool":"search_knowledge","call_id":"a","output":{"count":2}}"#)
        ]
        var steps: [NativeToolStep] = []
        for (name, body) in payloads {
            guard case .tool(let event) = try AgentEvent(SSEFrame(event: name, data: body)) else { return XCTFail("Missing tool") }
            steps = NativeToolStep.applying(event, to: steps)
        }
        XCTAssertEqual(steps.map(\.status), ["completed", "running"])
        XCTAssertEqual(steps[0].output, .object(["count": .integer(2)]))
        var pending = PendingTurn(request: AgentTurnRequest(message: "问题")); pending.toolSteps = steps
        XCTAssertEqual(pending.statusText, "正在检索知识库")
    }
    func testOldOwnerRecoveryJSONRemainsReadableAfterEventExpansion() throws {
        let bytes = Data(#"{"request":{"message":"旧草稿"},"key":"original-key","answer":"部分回答","status":"stopping"}"#.utf8)
        let old = try JSONDecoder().decode(PendingTurn.self, from: bytes)
        XCTAssertNil(old.research); XCTAssertNil(old.toolSteps); XCTAssertEqual(old.answer, "部分回答")
    }
    func testQueryAndMultipartDoNotAllowHeaderOrURLInjection() throws {
        let url = try Endpoint("https://example.com").url("/api/memories", query: ["q": "a&owner=other#fragment", "expected_version": "2"])
        let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertNil(parts.fragment); XCTAssertEqual(parts.queryItems?.count, 2)
        XCTAssertEqual(parts.queryItems?.first(where: { $0.name == "q" })?.value, "a&owner=other#fragment")
        let form = try MultipartBody(parts: [.file(name: "file", filename: "bad\r\nInjected: true\".txt", mimeType: "text/plain", bytes: Data([0, 255, 1])), .field(name: "defer_processing", value: "true")], boundary: "test-boundary")
        XCTAssertTrue(form.data.contains(255))
        XCTAssertFalse(String(decoding: form.data, as: UTF8.self).contains("\r\nInjected:"))
        XCTAssertThrowsError(try MultipartBody(parts: [], boundary: "bad\r\n"))
        XCTAssertThrowsError(try MultipartBody(parts: [.file(name: "file", filename: "file", mimeType: "text/plain\r\nSecret: value", bytes: Data())]))
    }
}
