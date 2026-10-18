import Foundation

/// SSE events have their own wire contract; these are not alternate REST DTOs.
public struct ToolStreamEvent: Codable, Equatable, Sendable {
    public var tool: String
    public var callId: String?
    public var input: JSONValue?
    public var arguments: JSONValue?
    public var output: JSONValue?
    public var detail: String?
    public var message: String?
    public var errorCode: String?
    public var phase: String?
    enum CodingKeys: String, CodingKey {
        case tool, input, arguments, output, detail, message, phase
        case callId = "call_id", errorCode = "error_code"
    }
    func withPhase(_ value: String) -> Self { var next = self; next.phase = value; return next }
}

public struct ResearchStreamEvent: Codable, Equatable, Sendable {
    public var event: String?
    public var runId: String?
    public var state: String?
    public var title: String?
    public var question: String?
    public var options: [String]?
    public var steps: [String]?
    public var step: String?
    public var status: String?
    public var prompt: String?
    public var selectedIntent: String?
    public var summary: String?
    public var knowledgeCount: Int?
    public var webCount: Int?
    enum CodingKeys: String, CodingKey {
        case event, state, title, question, options, steps, step, status, prompt, summary
        case runId = "run_id", selectedIntent = "selected_intent", knowledgeCount = "knowledge_count", webCount = "web_count"
    }
    func withEvent(_ value: String) -> Self { var next = self; next.event = value; return next }
}

public struct NativeToolStep: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var tool: String
    public var status: String
    public var input: JSONValue?
    public var output: JSONValue?
    public var detail: String?
    public var label: String { Self.labels[tool] ?? tool }
    public static func fromTraces(_ traces: [AgentToolTraceResponse]) -> [Self] {
        var result: [Self] = []
        for trace in traces {
            let status = ["started", "tool_started"].contains(trace.phase) ? "running" : ["failed", "tool_failed"].contains(trace.phase) ? "failed" : "completed"
            if let index = result.firstIndex(where: { $0.id == trace.callId }) {
                result[index].status = status
                if let input = trace.input { result[index].input = .object(input) }
                if let output = trace.output { result[index].output = output }
                result[index].detail = trace.detail ?? trace.error ?? result[index].detail
            } else { result.append(Self(id: trace.callId, tool: trace.tool, status: status, input: trace.input.map(JSONValue.object), output: trace.output, detail: trace.detail ?? trace.error)) }
        }
        return result
    }
    public static let labels = [
        "search_knowledge": "检索知识库", "read_knowledge_entry": "读取知识条目", "read_sources": "读取来源",
        "browse_knowledge_directory": "浏览知识目录", "search_research_materials": "检索研究材料",
        "read_research_material_context": "读取研究材料原文", "search_web": "搜索公开网页", "read_web_page": "读取网页正文",
        "ask_research_question": "讨论研究下一步", "update_research_map": "更新研究地图",
        "propose_start_research": "整理研究起点", "get_research_workflow_state": "读取研究进度",
        "start_theory_matching": "启动理论匹配", "save_confirmed_theory_plan": "保存已确认理论方案",
        "read_research_document": "读取研究文档", "propose_document_revision": "整理文档修订提议",
        "propose_document_creation": "整理文档创建提议"
    ]
    public static func applying(_ event: ToolStreamEvent, to current: [Self]) -> [Self] {
        var result = current
        let index = event.callId.flatMap { id in result.firstIndex { $0.id == id } }
            ?? (event.phase == "tool_started" ? nil : result.lastIndex { $0.tool == event.tool && $0.status == "running" })
        let status = event.phase == "tool_started" ? "running" : event.phase == "tool_failed" ? "failed" : "completed"
        if let index {
            result[index].status = status
            if let input = event.input ?? event.arguments { result[index].input = input }
            if let output = event.output { result[index].output = output }
            result[index].detail = event.message ?? event.detail ?? result[index].detail
        } else {
            result.append(Self(id: event.callId ?? UUID().uuidString, tool: event.tool, status: status,
                               input: event.input ?? event.arguments, output: event.output, detail: event.message ?? event.detail))
        }
        return result
    }
}

public struct NativeResearchProgress: Codable, Equatable, Sendable {
    public var stage = "researching"
    public var question = ""
    public var options: [String] = []
    public var steps: [String] = []
    public var currentStep: String?
    public var prompt: String?
    public var selectedIntent: String?
    public var conclusion: String?
    public var knowledgeCount: Int?
    public var webCount: Int?
    public init() {}
    public mutating func apply(_ event: ResearchStreamEvent) {
        if let prompt = event.prompt { self.prompt = prompt }
        if let intent = event.selectedIntent { selectedIntent = intent }
        switch event.event {
        case "research_ask": stage = "clarifying"; question = event.question ?? ""; options = event.options ?? []
        case "research_plan": stage = "planning"; question = event.title ?? ""; steps = event.steps ?? []
        case "research_step": stage = "researching"; currentStep = event.step
        case "research_result":
            stage = "completed"; conclusion = event.summary; knowledgeCount = event.knowledgeCount; webCount = event.webCount
        case "research_waiting":
            stage = event.state == "awaiting_clarification" ? "clarifying" : "planning"
            question = event.question ?? event.title ?? question
            options = event.options ?? options; steps = event.steps ?? steps
        default: break
        }
    }
}

public extension PendingTurn {
    func researchContinuation(action: String, selection: String?, conversationId: String?) throws -> PendingTurn {
        guard let runId, request.mode == "deep_research",
              ["awaiting_clarification", "awaiting_plan_confirmation"].contains(status),
              ["clarify", "confirm", "skip"].contains(action),
              action != "confirm" || status == "awaiting_plan_confirmation",
              action == "confirm" || status == "awaiting_clarification" else { throw ClientError.invalidResponse }
        let choice = selection?.trimmingCharacters(in: .whitespacesAndNewlines)
        if action == "clarify", choice?.isEmpty != false { throw ClientError.invalidResponse }
        var nextRequest = request
        nextRequest.conversationId = conversationId ?? request.conversationId
        nextRequest.deepResearchRunId = runId
        nextRequest.deepResearchAction = action
        nextRequest.deepResearchSelection = action == "clarify" ? choice : nil
        var next = PendingTurn(request: nextRequest, key: key, runId: runId)
        next.research = research
        if action == "confirm" { next.research?.stage = "researching" }
        return next
    }
    var statusText: String {
        let tool = toolSteps?.last(where: { $0.status == "running" })?.tool
        if let tool {
            if ["read_knowledge_entry", "read_sources", "read_research_document", "read_research_material_context"].contains(tool) { return "正在阅读研究材料" }
            if tool == "search_research_materials" { return "正在检索个人材料" }
            if ["search_knowledge", "browse_knowledge_directory"].contains(tool) { return "正在检索知识库" }
            if tool == "start_theory_matching" { return "正在比较理论视角" }
            if ["propose_document_creation", "propose_document_revision"].contains(tool) { return "正在整理研究框架" }
            return "正在更新研究进度"
        }
        return status == "answering" ? "正在生成回答" : "正在理解并整理研究问题"
    }
}
