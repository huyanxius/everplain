import Foundation

public struct SSEFrame: Equatable, Sendable {
    public let event: String
    public let data: String
    public init(event: String, data: String) { self.event = event; self.data = data }
}

/// Incremental SSE framing over raw bytes. UTF-8 is decoded only after a complete line.
/// Supports LF, CRLF, CR, comments and multi-line data. EOF never fabricates a terminal event.
public struct SSEParser: Sendable {
    private var line = Data()
    private var event = "message"
    private var dataLines: [String] = []
    private var eventSize = 0
    private var previousCR = false
    private var firstLine = true
    public let maximumEventBytes: Int
    public init(maximumEventBytes: Int = 2_097_152) { self.maximumEventBytes = maximumEventBytes }
    public mutating func append(_ bytes: Data) throws -> [SSEFrame] {
        var frames: [SSEFrame] = []
        for byte in bytes {
            if byte == 10 && previousCR { previousCR = false; continue }
            previousCR = false
            if byte == 10 || byte == 13 {
                if let frame = try consumeLine() { frames.append(frame) }
                previousCR = byte == 13
            } else {
                line.append(byte)
                if line.count + eventSize > maximumEventBytes { throw ClientError.eventTooLarge }
            }
        }
        return frames
    }
    private mutating func consumeLine() throws -> SSEFrame? {
        guard var text = String(data: line, encoding: .utf8) else { throw ClientError.malformedEvent }
        line.removeAll(keepingCapacity: true)
        if firstLine { if text.hasPrefix("\u{FEFF}") { text.removeFirst() }; firstLine = false }
        if text.isEmpty {
            let frame = dataLines.isEmpty ? nil : SSEFrame(event: event, data: dataLines.joined(separator: "\n"))
            event = "message"; dataLines.removeAll(keepingCapacity: true); eventSize = 0
            return frame
        }
        if text.hasPrefix(":") { return nil }
        let split = text.firstIndex(of: ":")
        let field = split.map { String(text[..<$0]) } ?? text
        var value = split.map { String(text[text.index(after: $0)...]) } ?? ""
        if value.hasPrefix(" ") { value.removeFirst() }
        if field == "event" { event = value }
        if field == "data" { dataLines.append(value); eventSize += value.utf8.count + 1 }
        if eventSize > maximumEventBytes { throw ClientError.eventTooLarge }
        return nil
    }
}

public enum AgentEvent: Sendable, Equatable {
    case status(String)
    case started(conversationId: String, runId: String, replayed: Bool, runtimeMode: String?)
    case delta(String)
    case completed(AgentConversationResponse)
    case interrupted(String)
    case research(ResearchStreamEvent)
    case researchWaiting(ResearchStreamEvent)
    case citation(AgentCitationResponse)
    case canvasPatch(AgentResearchMapPatchResponse)
    case failed(code: String, message: String)
    case tool(ToolStreamEvent)
    case ignored

    public init(_ frame: SSEFrame) throws {
        guard let bytes = frame.data.data(using: .utf8) else { throw ClientError.malformedEvent }
        let decoder = JSONDecoder()
        switch frame.event {
        case "agent_status": self = .status(try decoder.decode(Status.self, from: bytes).status)
        case "turn_started":
            let payload = try decoder.decode(Started.self, from: bytes)
            self = .started(conversationId: payload.conversation_id, runId: payload.run_id, replayed: payload.replayed ?? false, runtimeMode: payload.runtime_mode)
        case "assistant_delta": self = .delta(try decoder.decode(Delta.self, from: bytes).delta)
        case "turn_completed": self = .completed(try decoder.decode(Completed.self, from: bytes).conversation)
        case "research_waiting":
            let payload = try decoder.decode(ResearchStreamEvent.self, from: bytes)
            guard payload.runId != nil, ["awaiting_clarification", "awaiting_plan_confirmation"].contains(payload.state ?? "") else { throw ClientError.malformedEvent }
            self = .researchWaiting(payload.withEvent(frame.event))
        case "research_ask", "research_plan", "research_step", "research_result":
            self = .research(try decoder.decode(ResearchStreamEvent.self, from: bytes).withEvent(frame.event))
        case "citation_added": self = .citation(try decoder.decode(AgentCitationResponse.self, from: bytes))
        case "canvas_patch": self = .canvasPatch(try decoder.decode(AgentResearchMapPatchResponse.self, from: bytes))
        case "turn_interrupted": self = .interrupted(try decoder.decode(Failure.self, from: bytes).message)
        case "turn_failed":
            let payload = try decoder.decode(Failure.self, from: bytes)
            self = .failed(code: payload.code ?? "unknown", message: payload.message)
        case "tool_started", "tool_finished", "tool_failed":
            self = .tool(try decoder.decode(ToolStreamEvent.self, from: bytes).withPhase(frame.event))
        default: self = .ignored
        }
    }
    private struct Status: Decodable { let status: String }
    private struct Started: Decodable { let conversation_id: String; let run_id: String; let replayed: Bool?; let runtime_mode: String? }
    private struct Delta: Decodable { let delta: String }
    private struct Completed: Decodable { let conversation: AgentConversationResponse }
    private struct Failure: Decodable { let code: String?; let message: String }
}

/// Request and key remain paired across retries, including retrying a run recovered from history.
public struct PendingTurn: Codable, Equatable, Sendable {
    public let request: AgentTurnRequest
    public let key: String
    public var runId: String?
    public var answer = ""
    public var status = "thinking"
    // Optional additions keep previously persisted owner recovery records readable.
    public var toolSteps: [NativeToolStep]?
    public var research: NativeResearchProgress?
    public var citations: [AgentCitationResponse]?
    public var canvasPatches: [AgentResearchMapPatchResponse]?
    public init(request: AgentTurnRequest, key: String = UUID().uuidString, runId: String? = nil) {
        self.request = request; self.key = key; self.runId = runId
    }
}
