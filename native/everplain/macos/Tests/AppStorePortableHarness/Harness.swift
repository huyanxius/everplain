extension AppStore {
    func probeImmediateWorkspaceSwitch() -> (String?, String?, Bool) {
        session = SessionResponse(allowedActions: [], expiresAt: "2099-01-01T00:00:00Z", sessionId: "synthetic-session", status: "active", user: SessionUserResponse(email: "probe@example.invalid", userId: "synthetic-owner"), version: 1)
        route = .workspace; workspaceTaskId = "old-project"; workspace.taskId = "old-project"
        pendingConversationId = "old-conversation"; composer = "Synthetic unsent scope check"
        openResearchWorkspace(taskId: "new-project", conversationId: nil)
        let can = canSend
        send()
        let result = (pending?.request.conversationId, pending?.request.taskId, can)
        resetOwner()
        return result
    }
    func probeSettingsPreservesStream() async -> (Bool, String?, Route, Route) {
        session = SessionResponse(allowedActions: [], expiresAt: "2099-01-01T00:00:00Z", sessionId: "synthetic-session", status: "active", user: SessionUserResponse(email: "probe@example.invalid", userId: "synthetic-owner"), version: 1)
        route = .chat; pending = PendingTurn(request: AgentTurnRequest(message: "Synthetic not-dispatched turn")); running = true
        await navigate(.account)
        let result = (running, pending?.status, route, settingsBackground)
        resetOwner()
        return result
    }

    func probeImmediateConversationSwitch() -> Bool {
        session = SessionResponse(allowedActions: [], expiresAt: "2099-01-01T00:00:00Z", sessionId: "synthetic-session", status: "active", user: SessionUserResponse(email: "probe@example.invalid", userId: "synthetic-owner"), version: 1)
        route = .chat; pendingConversationId = "old-conversation"; composer = "Synthetic unsent conversation check"
        openConversation("00000000-0000-4000-8000-000000000002")
        let result = canSend
        resetOwner()
        return result
    }

    private func seedRecoveryProbe() {
        session = SessionResponse(allowedActions: [], expiresAt: "2099-01-01T00:00:00Z", sessionId: "synthetic-session", status: "active", user: SessionUserResponse(email: "probe@example.invalid", userId: "synthetic-owner"), version: 1)
        client = nil; route = .chat; pendingConversationId = "synthetic-conversation"
    }
    private func canonicalProbe(turns: [AgentTurnResponse] = [], runs: [AgentRunRecoveryResponse] = []) -> AgentConversationResponse {
        AgentConversationResponse(conversationId: "synthetic-conversation", createdAt: "2026-10-04T00:00:00Z", researchMap: AgentResearchMapResponse(nodes: [], relations: [], schemaVersion: 1), title: "Offline recovery", turnCount: turns.count, turns: turns, unfinishedRuns: runs, updatedAt: "2026-10-04T00:00:00Z")
    }
    private func failedProbe(key: String, run: String? = nil, message: String = "Repeated question") -> PendingTurn {
        var turn = PendingTurn(request: AgentTurnRequest(conversationId: "synthetic-conversation", materialIds: ["material-original"], message: message, mode: "standard", modelId: "original-model", reasoningEffort: "high", referenceKnowledgeBaseId: "original-reference", webSearch: false), key: key, runId: run)
        turn.answer = "Saved partial " + key; turn.status = "failed"
        return turn
    }
    func probeRetainedRequestsAndOwner() {
        seedRecoveryProbe()
        let first = failedProbe(key: "first-key", run: "first-run")
        pending = first; composer = "Second question"; send()
        let secondKey = pending!.key
        pending?.answer = "Second partial"; pending?.status = "interrupted"
        composer = "Third question"; send()
        precondition(unfinishedTurns.count == 3, "A new send dropped an older failed/interrupted question")
        precondition(unfinishedTurns.first(where: { $0.key == first.key })?.answer == first.answer)
        precondition(unfinishedTurns.first(where: { $0.key == secondKey })?.answer == "Second partial")
        let thirdKey = pending!.key
        pending?.status = "interrupted"
        retry(first.key)
        precondition(pending?.key == first.key && pending?.request == first.request, "Retry changed the selected request/key")
        precondition(unfinishedTurns.count == 3 && unfinishedTurns.contains(where: { $0.key == thirdKey }), "Selecting an old retry dropped the newer turn")
        precondition(pending?.key != secondKey, "An old row retried the current request")
        resetOwner()
        precondition(unfinishedTurns.isEmpty && retainedUnfinishedTurns.isEmpty && completedRunTurnIds.isEmpty, "Owner reset leaked recovery content")
    }
    func probeCanonicalRecoveryAndWaiting() {
        seedRecoveryProbe()
        let waitingRequest = AgentTurnRequest(conversationId: "synthetic-conversation", message: "Saved research question", mode: "deep_research")
        let waiting = AgentRunRecoveryResponse(cancelRequested: false, idempotencyKey: "waiting-key", partialAnswer: "Saved plan introduction", request: waitingRequest, runId: "waiting-run", status: "awaiting_plan_confirmation", toolSummary: [["kind": .string("deep_research_pending"), "title": .string("Actual saved plan"), "steps": .array([.string("Read existing evidence"), .string("Compare sources")])]], updatedAt: "2026-10-04T00:00:00Z")
        let failed = AgentRunRecoveryResponse(cancelRequested: false, idempotencyKey: "failed-key", partialAnswer: "Saved failed answer", request: failedProbe(key: "failed-key").request, runId: "failed-run", status: "failed", updatedAt: "2026-10-04T00:00:00Z")
        mergeCanonicalConversation(canonicalProbe(runs: [failed, waiting]), selectRecovery: true)
        precondition(unfinishedTurns.count == 2 && pending?.key == failed.idempotencyKey, "History restored only one unfinished run")
        precondition(selectUnfinishedTurn(waiting.idempotencyKey))
        precondition(pending?.research?.question == "Actual saved plan" && pending?.research?.steps.count == 2, "Waiting card did not use saved confirmation data")
        precondition(!running && pending?.request == waitingRequest && !canRetryUnfinishedTurn(waiting.idempotencyKey), "Selecting waiting research resumed or rewrote it")
        let before = pending
        retry(waiting.idempotencyKey)
        precondition(pending == before, "Generic retry resumed waiting research")
        mergeCanonicalConversation(canonicalProbe(runs: [failed, waiting]))
        precondition(unfinishedTurns.count == 2, "Re-reading canonical history duplicated runs")
        openConversation("different-conversation")
        precondition(retainedUnfinishedTurns.isEmpty, "Conversation switch did not synchronously clear retained turns")
        resetOwner()
    }
    func probeUnknownStopBlocksReplay() {
        seedRecoveryProbe()
        let unknown = failedProbe(key: "unknown-key")
        retainedUnfinishedTurns = [unknown]
        pending = failedProbe(key: "different-current-key", run: "different-run")
        stopRecords = [StopRecoveryRecord(confirmation: StopConfirmation(requestKey: unknown.key), turn: unknown, localWaitEnded: true)]
        let before = pending
        precondition(!isCurrentStopPending, "Fixture must exercise per-key protection without known conversation identity")
        retry(unknown.key)
        precondition(pending == before && !canRetryUnfinishedTurn(unknown.key), "Unknown stopped key replayed after selecting another pending request")
        precondition(selectUnfinishedTurn(unknown.key), "Unknown stopped turn must remain viewable")
        precondition(isCurrentStopPending && isStopPending(for: unknown.key))
        resetOwner()
    }
    func probeCanonicalCompletionIdentity() async {
        seedRecoveryProbe()
        let first = failedProbe(key: "first-key", run: "first-run")
        let second = failedProbe(key: "second-key", run: "second-run")
        retainedUnfinishedTurns = [first]; pending = second
        let turn = AgentTurnResponse(assistant: AgentMessageResponse(content: "Canonical completed answer", createdAt: "2026-10-04T00:00:00Z", messageId: "assistant", role: "assistant", sequence: 2), turnId: "real-turn-id", user: AgentMessageResponse(content: first.request.message, createdAt: "2026-10-04T00:00:00Z", messageId: "user", role: "user", sequence: 1))
        mergeCanonicalConversation(canonicalProbe(turns: [turn]))
        precondition(unfinishedTurns.count == 2, "Question text was incorrectly treated as completion identity")
        let api = APIClient(endpoint: try! Endpoint("https://example.invalid"))
        api.readFixture = { path, key in
            precondition(path == EverplainEndpoint.lookupAgentRun)
            let isFirst = key == first.key
            return try JSONEncoder().encode(AgentRunLookupResponse(cancelRequested: false, conversationId: "synthetic-conversation", idempotencyKey: key!, partialAnswer: isFirst ? "Canonical completed answer" : second.answer, runId: isFirst ? "first-run" : "second-run", status: isFirst ? "completed" : "failed", turnId: isFirst ? "real-turn-id" : nil, updatedAt: "2026-10-04T00:00:00Z"))
        }
        client = api
        await reconcileCompletedRuns(api, epoch: ownerEpoch, navigation: navigationEpoch)
        precondition(unfinishedTurns.count == 1 && unfinishedTurns[0].key == second.key, "Completed run was duplicated or an equal-text unfinished run was removed")
        precondition(completedRunTurnIds["first-run"] == "real-turn-id" && api.reads.count == 2)
        let staleRun = AgentRunRecoveryResponse(cancelRequested: false, idempotencyKey: first.key, partialAnswer: first.answer, request: first.request, runId: first.runId!, status: "failed", updatedAt: "2026-10-04T00:00:00Z")
        mergeCanonicalConversation(canonicalProbe(turns: [turn], runs: [staleRun]))
        precondition(!unfinishedTurns.contains(where: { $0.key == first.key }), "A stale unfinished snapshot revived a completed run")
        resetOwner()
    }
    func probeCompletionEventPreservesOtherFailures() {
        seedRecoveryProbe()
        let first = failedProbe(key: "first-key", run: "first-run")
        let second = failedProbe(key: "second-key", run: "second-run")
        retainedUnfinishedTurns = [first]; pending = second
        mergeCanonicalConversation(canonicalProbe(), completed: second)
        precondition(unfinishedTurns.map(\.key) == [first.key] && pending == nil, "Completion removed another unfinished request")
        resetOwner()
    }

    func probeRetryDispatchAndLateCanonicalRead() async {
        seedRecoveryProbe()
        let original = failedProbe(key: "original-key", run: "original-run")
        retainedUnfinishedTurns = [original]; pending = failedProbe(key: "newer-key", run: "newer-run")
        let api = APIClient(endpoint: try! Endpoint("https://example.invalid")); client = api
        retry(original.key)
        await streamTask?.value
        precondition(api.streamedRequests.count == 1 && api.streamedRequests[0].key == original.key && api.streamedRequests[0].request == original.request, "Actual retry dispatcher sent the wrong immutable request/key")
        var continuation: CheckedContinuation<Data, Error>?
        let stale = canonicalProbe(runs: [AgentRunRecoveryResponse(cancelRequested: false, idempotencyKey: original.key, partialAnswer: "Old canonical answer", request: original.request, runId: original.runId!, status: "failed", updatedAt: "2026-10-04T00:00:00Z")])
        api.readFixture = { _, _ in try await withCheckedThrowingContinuation { continuation = $0 } }
        let read = Task { await refreshUnfinishedTurns() }
        while continuation == nil { await Task.yield() }
        composer = "New question after read began"; send()
        let newKey = pending!.key
        continuation!.resume(returning: try! JSONEncoder().encode(stale))
        await read.value; await streamTask?.value
        precondition(pending?.key == newKey && pending?.request.message == "New question after read began", "A late canonical read replaced the newly sent request")
        precondition(unfinishedTurns.contains(where: { $0.key == original.key }), "A late read lost the retained original turn")
        resetOwner()
    }
    func probeLateOwnerReadAndRunningRecovery() async {
        seedRecoveryProbe()
        var live = failedProbe(key: "live-key", run: "live-run"); live.status = "running"
        retainedUnfinishedTurns = [live]; pending = failedProbe(key: "old-key", run: "old-run")
        composer = "Blocked while retained run is live"
        precondition(!canSend && !canRetryUnfinishedTurn("old-key") && canRetryUnfinishedTurn("live-key"), "Selecting an old failure bypassed the retained running scope")
        let api = APIClient(endpoint: try! Endpoint("https://example.invalid")); client = api
        var continuation: CheckedContinuation<Data, Error>?
        let stale = canonicalProbe()
        api.readFixture = { _, _ in try await withCheckedThrowingContinuation { continuation = $0 } }
        let read = Task { await refreshUnfinishedTurns() }
        while continuation == nil { await Task.yield() }
        resetOwner()
        continuation!.resume(returning: try! JSONEncoder().encode(stale))
        await read.value
        precondition(conversation == nil && unfinishedTurns.isEmpty && session == nil, "A prior-owner read restored conversation content")
    }

}
@main enum ScopeHarness {
    @MainActor static func main() async {
        let result = AppStore().probeImmediateWorkspaceSwitch()
        let blocked = !AppStore().probeImmediateConversationSwitch()
        precondition(blocked, "Conversation switching must block sending before any Task executes")
        precondition(!result.2 && result.0 == nil && result.1 == nil, "A workspace switch constructed a request with mixed old/new scope")
        let settings = await AppStore().probeSettingsPreservesStream()
        precondition(settings.0 && settings.1 == "thinking" && settings.2 == .account && settings.3 == .chat, "Opening settings stopped or reset the background turn")
        print("Settings overlay: running=\(settings.0), status=\(settings.1 ?? "nil"), route=\(settings.2), background=\(settings.3)")
        print("Ordinary conversation switch blocked before suspension: \(blocked)")
        print("Immediate workspace switch: canSend=\(result.2), conversation=\(result.0 ?? "nil"), project=\(result.1 ?? "nil")")
        AppStore().probeRetainedRequestsAndOwner()
        AppStore().probeCanonicalRecoveryAndWaiting()
        AppStore().probeUnknownStopBlocksReplay()
        await AppStore().probeCanonicalCompletionIdentity()
        AppStore().probeCompletionEventPreservesOtherFailures()
        await AppStore().probeRetryDispatchAndLateCanonicalRead()
        await AppStore().probeLateOwnerReadAndRunningRecovery()
        print("Passed 10 offline AppStore scope/overlay/recovery checks. All responses are synthetic; no API call or model request occurred.")
    }
}
