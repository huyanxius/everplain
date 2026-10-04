import Foundation

/// A stop remains pending until the SAME run reports a terminal execution state.
/// HTTP success/202, a failed request or an empty history result are not confirmation.
public struct StopConfirmation: Codable, Equatable, Sendable {
    public let requestKey: String
    public private(set) var runId: String?
    public private(set) var conversationId: String?
    public private(set) var observedStatus: String?
    public private(set) var lastError: String?
    public private(set) var terminalStatus: String?
    public private(set) var quiescentStatus: String?
    public var isPending: Bool { terminalStatus == nil && quiescentStatus == nil }
    public var idempotencyKey: String? { runId.map { "stop-" + $0 } }
    public init(requestKey: String, runId: String? = nil, conversationId: String? = nil) {
        self.requestKey = requestKey; self.runId = runId; self.conversationId = conversationId
    }
    public mutating func bind(runId: String, conversationId: String) throws {
        guard self.runId == nil || self.runId == runId,
              self.conversationId == nil || self.conversationId == conversationId else { throw ClientError.malformedEvent }
        self.runId = runId; self.conversationId = conversationId
    }
    public mutating func observeLookup(_ response: AgentRunLookupResponse) throws {
        guard response.idempotencyKey == requestKey else { throw ClientError.malformedEvent }
        try bind(runId: response.runId, conversationId: response.conversationId)
        try observe(AgentRunStopResponse(cancelRequested: response.cancelRequested, runId: response.runId, status: response.status))
    }
    public mutating func observe(_ response: AgentRunStopResponse) throws {
        guard let runId, response.runId == runId else { throw ClientError.malformedEvent }
        observedStatus = response.status
        lastError = nil
        if ["completed", "failed", "interrupted"].contains(response.status) { terminalStatus = response.status }
        else if ["awaiting_clarification", "awaiting_plan_confirmation"].contains(response.status) { quiescentStatus = response.status }
    }
    /// Completed/interrupted SSE belongs to the original generation. A generic turn_failed
    /// may mean timeout/run-in-progress and therefore cannot prove the run is terminal.
    public mutating func observeTerminalEvent(_ status: String) {
        if ["completed", "interrupted"].contains(status) { observedStatus = status; terminalStatus = status; lastError = nil }
    }
    /// Valid only when the native task is canceled before any transport is dispatched.
    public mutating func confirmNeverDispatched() throws {
        guard runId == nil else { throw ClientError.malformedEvent }
        observedStatus = "not_dispatched"; terminalStatus = "not_dispatched"; lastError = nil
    }
    public mutating func recordFailure(_ message: String) { lastError = message }
}

/// Encrypted owner-scoped recovery record. Ending local waiting never changes the server outcome.
public struct StopRecoveryRecord: Codable, Equatable, Sendable {
    public var confirmation: StopConfirmation
    public var turn: PendingTurn
    public var localWaitEnded: Bool
    public init(confirmation: StopConfirmation, turn: PendingTurn, localWaitEnded: Bool = false) {
        self.confirmation = confirmation; self.turn = turn; self.localWaitEnded = localWaitEnded
    }
}
