import XCTest
@testable import EverplainCore

final class CoreTests: XCTestCase {
    func testSecureOriginsAndNoCredentialsInURLs() throws {
        for value in ["https://api.example.com", "https://api.example.com:8443/"] { XCTAssertNoThrow(try Endpoint(value)) }
        for value in ["http://api.example.com", "file:///tmp", "https://user:secret@example.com", "https://example.com/api", "https://example.com?q=secret", "https://example.com#fragment"] {
            XCTAssertThrowsError(try Endpoint(value), value)
        }
        XCTAssertThrowsError(try Endpoint("http://localhost:8297", allowLoopback:false))
        XCTAssertNoThrow(try Endpoint("http://127.0.0.1:8297", allowLoopback:true))
        XCTAssertThrowsError(try Endpoint("http://127.0.0.1.evil.example", allowLoopback:true))
    }
    func testRequestMatchesCookieContractWithoutFabricatedBearer() throws {
        let endpoint=try Endpoint("https://api.example.com")
        let payload=AgentTurnRequest(message:"你好",mode:"standard",modelId:"server-model",reasoningEffort:"high",webSearch:false,workspace:"agent")
        let request=try endpoint.request("/api/agent/turns",method:"POST",body:JSONEncoder().encode(payload),idempotencyKey:"test-key-0001",stream:true)
        XCTAssertEqual(request.httpMethod,"POST")
        XCTAssertEqual(request.value(forHTTPHeaderField:"Accept"),"text/event-stream")
        XCTAssertEqual(request.value(forHTTPHeaderField:"Idempotency-Key"),"test-key-0001")
        XCTAssertNil(request.value(forHTTPHeaderField:"Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField:"Cookie"),"URLSession owns the cookie jar")
        XCTAssertNil(request.value(forHTTPHeaderField:"Origin"))
        let body=try XCTUnwrap(JSONSerialization.jsonObject(with:request.httpBody!) as? [String:Any])
        XCTAssertEqual(body["workspace"] as? String,"agent")
        XCTAssertEqual(body["mode"] as? String,"standard")
        XCTAssertEqual(body["reasoning_effort"] as? String,"high")
        XCTAssertNil(body["task_id"])
        XCTAssertThrowsError(try endpoint.url("/api/agent/conversations/not-a-uuid"))
        XCTAssertThrowsError(try endpoint.url("//evil.example/api/session"))
        XCTAssertThrowsError(try endpoint.url("/api/../session"))
    }
    func testEverySharedSSEFramingCase() throws {
        let object=try fixture("sse")
        let cases=try XCTUnwrap(object["cases"] as? [[String:Any]])
        XCTAssertGreaterThanOrEqual(cases.count,10)
        for test in cases {
            let name=try XCTUnwrap(test["name"] as? String)
            let chunks=try XCTUnwrap(test["chunks_base64"] as? [String])
            var parser=SSEParser(), actual:[SSEFrame]=[]
            for chunk in chunks { actual += try parser.append(XCTUnwrap(Data(base64Encoded:chunk))) }
            let expected=try XCTUnwrap(test["expected_events"] as? [[String:String]])
            XCTAssertEqual(actual,expected.map { SSEFrame(event:$0["event"]!,data:$0["data"]!) },name)
        }
    }
    func testParserBoundsAndDoesNotFinishTruncatedFrame() throws {
        var parser=SSEParser(maximumEventBytes:30)
        XCTAssertThrowsError(try parser.append(Data(("data: "+String(repeating:"x",count:32)).utf8)))
        var truncated=SSEParser()
        XCTAssertEqual(try truncated.append(Data("event: turn_completed\ndata: {}".utf8)),[])
        var broken=SSEParser()
        XCTAssertThrowsError(try broken.append(Data([0xFF,0x0A])))
    }
    func testEventsDoNotTreatStatusOrUnknownAsCompletion() throws {
        XCTAssertEqual(try AgentEvent(SSEFrame(event:"agent_status",data:"{\"status\":\"answering\"}")),.status("answering"))
        XCTAssertEqual(try AgentEvent(SSEFrame(event:"future_event",data:"future")),.ignored)
        XCTAssertEqual(try AgentEvent(SSEFrame(event:"turn_interrupted",data:"{\"code\":\"interrupted\",\"message\":\"停止\"}")),.interrupted("停止"))
        XCTAssertThrowsError(try AgentEvent(SSEFrame(event:"assistant_delta",data:"{}")))
        XCTAssertThrowsError(try AgentEvent(SSEFrame(event:"research_waiting",data:"{}")))
    }
    func testRetryKeepsExactRequestAndKey() throws {
        let request=AgentTurnRequest(message:"first",mode:"standard",modelId:"server-model",reasoningEffort:"high",workspace:"agent")
        let original=PendingTurn(request:request,key:"one-logical-turn")
        var retry=original; retry.answer="partial"; retry.runId="a-run"; retry.answer=""
        XCTAssertEqual(original.request,retry.request)
        XCTAssertEqual(original.key,retry.key)
        let encoder=JSONEncoder(); encoder.outputFormatting = .sortedKeys
        XCTAssertEqual(try encoder.encode(original.request),try encoder.encode(retry.request))
    }
    func testSharedWireModelsAndHighPrecisionOperations() throws {
        let schemas=try XCTUnwrap(fixture("codec")["schemas"] as? [String:Any])
        func decode<T:Decodable>(_ type:T.Type,_ name:String) throws->T {
            try JSONDecoder().decode(type,from:JSONSerialization.data(withJSONObject:XCTUnwrap(schemas[name])))
        }
        _ = try decode(SessionResponse.self,"SessionResponse")
        _ = try decode(AgentModelCatalogResponse.self,"AgentModelCatalogResponse")
        _ = try decode(AgentProfileResponse.self,"AgentProfileResponse")
        _ = try decode(AccountResponse.self,"AccountResponse")
        _ = try decode(AgentRunLookupResponse.self,"AgentRunLookupResponse")
        _ = try decode(AgentConversationResponse.self,"AgentConversationResponse")
        let credits=try decode(CreditSummaryResponse.self,"CreditSummaryResponse")
        XCTAssertNotNil(credits.activeUsageBuckets?.first?.settledRemainingPoints)
        let precise=try JSONDecoder().decode(JSONValue.self,from:Data("9007199254740993".utf8))
        XCTAssertEqual(precise,.integer(9_007_199_254_740_993))
        XCTAssertEqual(String(data:try JSONEncoder().encode(precise),encoding:.utf8),"9007199254740993")
    }
    func testGeneratedTokensHaveBothThemes() {
        XCTAssertEqual(EverplainTokens.textDisplay,36)
        XCTAssertEqual(EverplainTokens.radiusPanel,28)
        XCTAssertNotEqual(EverplainTokens.colorCanvas(dark:false),EverplainTokens.colorCanvas(dark:true))
        XCTAssertEqual(EverplainTokens.shadowComposer(dark:false).count,2)
    }
    func testStop202RunningRemainsPendingUntilSameRunTerminal() throws {
        let run = "00000000-0000-4000-8000-000000000123"
        var stop = StopConfirmation(requestKey:"original-message-key",runId:run,conversationId:"conversation")
        let key = stop.idempotencyKey
        try stop.observe(AgentRunStopResponse(cancelRequested:true,runId:run,status:"running"))
        XCTAssertTrue(stop.isPending)
        XCTAssertEqual(stop.observedStatus,"running")
        try stop.observe(AgentRunStopResponse(cancelRequested:true,runId:run,status:"running"))
        XCTAssertTrue(stop.isPending,"Repeated 202/running is not a completion")
        stop.recordFailure("network offline")
        XCTAssertTrue(stop.isPending)
        XCTAssertEqual(stop.runId,run)
        XCTAssertEqual(stop.idempotencyKey,key)
        XCTAssertEqual(stop.requestKey,"original-message-key")
        try stop.observe(AgentRunStopResponse(cancelRequested:true,runId:run,status:"interrupted"))
        XCTAssertFalse(stop.isPending)
        XCTAssertEqual(stop.terminalStatus,"interrupted")
        XCTAssertNil(stop.lastError)
        XCTAssertEqual(stop.idempotencyKey,key)
    }
    func testStopCannotSettleAnotherRunOrMissingHistory() throws {
        let run = "00000000-0000-4000-8000-000000000123"
        var stop=StopConfirmation(requestKey:"original-message-key")
        stop.recordFailure("No identity found yet")
        XCTAssertTrue(stop.isPending)
        XCTAssertNil(stop.idempotencyKey)
        try stop.bind(runId:run,conversationId:"conversation")
        XCTAssertThrowsError(try stop.bind(runId:"other",conversationId:"conversation"))
        XCTAssertThrowsError(try stop.observe(AgentRunStopResponse(cancelRequested:true,runId:"other",status:"interrupted")))
        XCTAssertTrue(stop.isPending)
        stop.observeTerminalEvent("failed")
        XCTAssertTrue(stop.isPending,"A generic SSE failure is not necessarily the run outcome")
        try stop.observe(AgentRunStopResponse(cancelRequested:false,runId:run,status:"awaiting_plan_confirmation"))
        XCTAssertFalse(stop.isPending,"Server verified a quiescent state, with no model generation")
        XCTAssertNil(stop.terminalStatus,"Paused research is never mislabeled interrupted/completed")
        XCTAssertEqual(stop.quiescentStatus,"awaiting_plan_confirmation")
        XCTAssertEqual(stop.requestKey,"original-message-key")
    }
    func testStopRequestStableKeyNeverTargetsModelEndpoint() throws {
        let run="00000000-0000-4000-8000-000000000123"
        let stop=StopConfirmation(requestKey:"original-key",runId:run)
        let endpoint=try Endpoint("https://api.example.com")
        let first=try endpoint.request("/api/agent/runs/\(run)/stop",method:"POST",idempotencyKey:stop.idempotencyKey)
        let second=try endpoint.request("/api/agent/runs/\(run)/stop",method:"POST",idempotencyKey:stop.idempotencyKey)
        XCTAssertEqual(first.url,second.url)
        XCTAssertEqual(first.value(forHTTPHeaderField:"Idempotency-Key"),second.value(forHTTPHeaderField:"Idempotency-Key"))
        XCTAssertNil(first.httpBody)
        XCTAssertFalse(first.url!.path.contains("/turns"))
    }
    func testReadOnlyLookupCarriesOriginalKeyOnlyInHeader() throws {
        let endpoint=try Endpoint("https://api.example.com")
        let request=try endpoint.request("/api/agent/runs/by-idempotency-key",idempotencyKey:"original-turn-key")
        XCTAssertEqual(request.httpMethod,"GET")
        XCTAssertEqual(request.value(forHTTPHeaderField:"Idempotency-Key"),"original-turn-key")
        XCTAssertNil(request.httpBody)
        XCTAssertNil(request.url?.query)
        XCTAssertThrowsError(try endpoint.request("/api/agent/runs/by-idempotency-key",idempotencyKey:"bad\nvalue"))
        XCTAssertThrowsError(try endpoint.url("/api/agent/runs/by-idempotency-key/stop"))
    }
    func testOnlyUndispatchedTaskCanBeConfirmedLocally() throws {
        var undispatched=StopConfirmation(requestKey:"original-key")
        try undispatched.confirmNeverDispatched()
        XCTAssertFalse(undispatched.isPending)
        XCTAssertEqual(undispatched.terminalStatus,"not_dispatched")
        var known=StopConfirmation(requestKey:"original-key",runId:"known-run")
        XCTAssertThrowsError(try known.confirmNeverDispatched())
        XCTAssertTrue(known.isPending)
    }
    func testLookupResolvesPrestartStopWithoutReplayingTurn() throws {
        let key="original-turn-key",run="00000000-0000-4000-8000-000000000123",conversation="00000000-0000-4000-8000-000000000456"
        var stop=StopConfirmation(requestKey:key)
        stop.recordFailure("HTTP 404 provisional")
        XCTAssertTrue(stop.isPending)
        let found=AgentRunLookupResponse(cancelRequested:false,conversationId:conversation,idempotencyKey:key,partialAnswer:"partial",runId:run,status:"running",updatedAt:"2026-10-04T00:00:00Z")
        try stop.observeLookup(found)
        XCTAssertEqual(stop.runId,run)
        XCTAssertEqual(stop.conversationId,conversation)
        XCTAssertTrue(stop.isPending)
        XCTAssertEqual(stop.idempotencyKey,"stop-"+run)
        var completed=found; completed.status="completed"
        try stop.observeLookup(completed)
        XCTAssertFalse(stop.isPending)
        XCTAssertEqual(stop.terminalStatus,"completed")
        XCTAssertEqual(stop.requestKey,key)
    }
    func testLookupCannotBindAnotherRequestKey() throws {
        var stop=StopConfirmation(requestKey:"original-turn-key")
        let other=AgentRunLookupResponse(cancelRequested:true,conversationId:"conversation",idempotencyKey:"other-turn-key",partialAnswer:"",runId:"run",status:"interrupted",updatedAt:"2026-10-04T00:00:00Z")
        XCTAssertThrowsError(try stop.observeLookup(other))
        XCTAssertTrue(stop.isPending)
        XCTAssertNil(stop.runId)
        XCTAssertNil(stop.terminalStatus)
    }
    func testEndingLocalWaitPreservesUnknownOriginalRequestForRecovery() throws {
        let turn=PendingTurn(request:AgentTurnRequest(message:"original",mode:"standard",workspace:"agent"),key:"original-key")
        let confirmation=StopConfirmation(requestKey:turn.key)
        let record=StopRecoveryRecord(confirmation:confirmation,turn:turn,localWaitEnded:true)
        let decoded=try JSONDecoder().decode(StopRecoveryRecord.self,from:JSONEncoder().encode(record))
        XCTAssertEqual(decoded.turn.request,turn.request)
        XCTAssertEqual(decoded.turn.key,turn.key)
        XCTAssertTrue(decoded.localWaitEnded)
        XCTAssertTrue(decoded.confirmation.isPending,"Ending local waiting must never label the server stopped")
        XCTAssertNil(decoded.confirmation.terminalStatus)
    }
    func testStaleRunningStopSettlesOnlyAfterCanonicalRecoveryLookup() throws {
        let run="00000000-0000-4000-8000-000000000123",key="stale-original-key"
        var stop=StopConfirmation(requestKey:key,runId:run,conversationId:"00000000-0000-4000-8000-000000000456")
        try stop.observe(AgentRunStopResponse(cancelRequested:true,runId:run,status:"running"))
        XCTAssertTrue(stop.isPending)
        // The controller reads canonical history to recover expired leases, then
        // consumes this read-only lookup. Time elapsed alone never settles a stop.
        let recovered=AgentRunLookupResponse(cancelRequested:true,conversationId:"00000000-0000-4000-8000-000000000456",idempotencyKey:key,partialAnswer:"saved partial",runId:run,status:"interrupted",updatedAt:"2026-10-04T00:00:00Z")
        try stop.observeLookup(recovered)
        XCTAssertFalse(stop.isPending)
        XCTAssertEqual(stop.terminalStatus,"interrupted")
        XCTAssertEqual(stop.requestKey,key)
    }
    private func fixture(_ name:String) throws->[String:Any] {
        let url=try XCTUnwrap(Bundle.module.url(forResource:name,withExtension:"json",subdirectory:"Fixtures"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:url)) as? [String:Any])
    }
}
