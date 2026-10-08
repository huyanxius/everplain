import Foundation

public enum ResearchWorkspaceTool: String, CaseIterable, Sendable {
    case map, materials, analysis, theory, method, writing, archive
    public var title: String { switch self { case .map: return "地图"; case .materials: return "材料"; case .analysis: return "分析"; case .theory: return "理论"; case .method: return "方法"; case .writing: return "文稿"; case .archive: return "归档" } }
}

/// A retry belongs to one exact operation and payload. Editing any field starts a new attempt.
public struct ResearchMutationAttempt: Equatable, Sendable {
    public let path: String
    public let method: String
    public let body: Data
    public let key: String
    public init<B: Encodable>(path: String, method: String = "POST", body: B, previous: Self? = nil) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let encoded = try encoder.encode(body)
        self.path = path; self.method = method; self.body = encoded
        key = previous.map { $0.path == path && $0.method == method && $0.body == encoded ? $0.key : UUID().uuidString } ?? UUID().uuidString
    }
}

/// Uncertain writes retain their request keys even if an unrelated operation happens between retries.
public struct ResearchMutationJournal: Sendable {
    private var attempts: [ResearchMutationAttempt] = []
    public init() {}
    public mutating func prepare<B: Encodable>(path: String, method: String = "POST", body: B) throws -> ResearchMutationAttempt {
        let candidate = try ResearchMutationAttempt(path: path, method: method, body: body)
        if let existing = attempts.first(where: { $0.path == path && $0.method == method && $0.body == candidate.body }) { return existing }
        attempts.append(candidate); return candidate
    }
    public mutating func complete(_ attempt: ResearchMutationAttempt) {
        // Once the resource has a new acknowledged revision, a deliberate later revert is a new write.
        attempts.removeAll { $0.path == attempt.path && $0.method == attempt.method }
    }
    public mutating func reset() { attempts.removeAll() }
}

public struct ResearchDocumentDraft: Equatable, Sendable {
    public private(set) var base: ResearchDocumentResponse
    public var sections: [ResearchDocumentSectionContract]
    public var formatting: ResearchDocumentFormattingContract
    public private(set) var remote: ResearchDocumentResponse?
    public init(_ document: ResearchDocumentResponse) { base = document; sections = document.sections; formatting = document.formatting }
    public var isDirty: Bool { sections != base.sections || formatting != base.formatting }
    public var hasConflict: Bool { remote.map { $0.version != base.version } ?? false }
    /// Background refresh may update a clean editor; dirty editors retain both versions for review.
    public mutating func receive(_ document: ResearchDocumentResponse) {
        guard document.documentId == base.documentId, document.version >= base.version else { return }
        if isDirty { if document.version > base.version { remote = document } }
        else { self = Self(document) }
    }
    public mutating func discardLocalChanges() { self = Self(remote ?? base) }
    /// Preserve text typed after a save was dispatched; its new base is the acknowledged revision.
    public mutating func acknowledge(_ document: ResearchDocumentResponse, submitted: Self) {
        guard document.documentId == base.documentId, document.version >= base.version else { return }
        let liveSections = sections, liveFormatting = formatting
        self = Self(document)
        if liveSections != submitted.sections { sections = liveSections }
        if liveFormatting != submitted.formatting { formatting = liveFormatting }
    }
    public func saveRequest(changeSummary: String) throws -> UpdateResearchDocumentRequest {
        guard !hasConflict else { throw ResearchWorkspaceError.versionConflict }
        guard Set(sections.map(\.sectionId)).count == sections.count, !sections.contains(where: { $0.sectionId.isEmpty }) else { throw ResearchWorkspaceError.invalidSections }
        return UpdateResearchDocumentRequest(changeSummary: changeSummary, expectedVersion: base.version, formatting: formatting, sections: sections, source: "user_edit")
    }
}

public enum ResearchWorkspaceError: Error, Equatable, LocalizedError {
    case versionConflict, invalidSections, wrongProject, invalidQuote
    public var errorDescription: String? { switch self {
    case .versionConflict: return "文稿已有更新。你的修改仍保留，请先比较并明确选择使用最新版本。"
    case .invalidSections: return "章节标识无效，未保存文稿。"
    case .wrongProject: return "这段对话不属于当前研究项目。"
    case .invalidQuote: return "请选择当前原文中存在的完整片段。"
    } }
}

public enum ResearchCanvasProjection {
    public static func apply(_ patches: [AgentResearchMapPatchResponse], to initial: AgentResearchMapResponse) -> AgentResearchMapResponse {
        var map = initial
        for patch in patches {
            for id in patch.removeNodeIds where map.nodes.first(where: { $0.id == id })?.userEdited != true { map.nodes.removeAll { $0.id == id } }
            map.relations.removeAll { patch.removeRelationIds.contains($0.id) }
            for node in patch.nodes where map.nodes.first(where: { $0.id == node.id })?.userEdited != true {
                if let index = map.nodes.firstIndex(where: { $0.id == node.id }) { map.nodes[index] = node } else { map.nodes.append(node) }
            }
            for edge in patch.relations { if let index = map.relations.firstIndex(where: { $0.id == edge.id }) { map.relations[index] = edge } else { map.relations.append(edge) } }
            let ids = Set(map.nodes.map(\.id)); map.relations.removeAll { !ids.contains($0.source) || !ids.contains($0.target) }
        }
        return map
    }
    public static func project(_ conversation: AgentConversationResponse?, livePatches: [AgentResearchMapPatchResponse] = [], failedOrInterrupted: Bool = false) -> AgentResearchMapResponse {
        let empty = AgentResearchMapResponse(nodes: [], relations: [], schemaVersion: 1)
        let persisted = conversation.map { $0.researchMap.schemaVersion == 1 ? $0.researchMap : apply($0.turns.flatMap { $0.canvasPatches ?? [] }, to: empty) } ?? empty
        return apply(failedOrInterrupted ? [] : livePatches, to: persisted)
    }
}

public enum ResearchQuoteSelection {
    /// API offsets count Unicode code points, not UTF-16 units or Swift grapheme clusters.
    public static func range(of quote: String, in source: String) throws -> Range<Int> {
        guard !quote.isEmpty, let range = source.range(of: quote), source.range(of: quote, range: range.upperBound..<source.endIndex) == nil, let start = range.lowerBound.samePosition(in: source.unicodeScalars), let end = range.upperBound.samePosition(in: source.unicodeScalars) else { throw ResearchWorkspaceError.invalidQuote }
        return source.unicodeScalars.distance(from: source.unicodeScalars.startIndex, to: start)..<source.unicodeScalars.distance(from: source.unicodeScalars.startIndex, to: end)
    }
}

/// User-editable theory state, separate from transport responses and their CAS baseline.
public struct ResearchTheoryDraft: Equatable, Sendable {
    public var version: Int
    public var decisions: [TheoryDecisionDraftInput]
    public var assignments: [TheoryUseAssignmentInput]
    public var relation: TheoryRelationInput
    public var partialReason: String
    public init(server: TheoryDecisionDraftResponse?, candidates: [TheoryCandidateResponse]) {
        version = server?.version ?? 0
        decisions = candidates.map { candidate in server?.decisions.first(where: { $0.candidateId == candidate.candidateId }) ?? TheoryDecisionDraftInput(candidateId: candidate.candidateId, candidateVersion: candidate.version) }
        assignments = candidates.map { candidate in server?.useAssignments.first(where: { $0.candidateId == candidate.candidateId }) ?? TheoryUseAssignmentInput(candidateId: candidate.candidateId, responsibility: "", roleCode: "secondary") }
        relation = server?.relations.first ?? TheoryRelationInput(candidateIds: [], distinguishingEvidence: [], excludingEvidence: [], explanation: "", premiseCompatibility: "", relationKind: "complementary", supportingEvidence: [])
        partialReason = server?.partialCompletionAcknowledgementReason ?? ""
    }
    public var adoptedIDs: [String] { decisions.filter { ["adopt", "combine"].contains($0.action ?? "") }.map(\.candidateId) }
    public var activeAssignments: [TheoryUseAssignmentInput] { assignments.filter { adoptedIDs.contains($0.candidateId) } }
    public var activeRelations: [TheoryRelationInput] { guard adoptedIDs.count > 1 else { return [] }; var value = relation; value.candidateIds = adoptedIDs; return [value] }
    public var normalizedDecisions: [TheoryDecisionDraftInput] { decisions.map { item in var copy = item; copy.relatedCandidateIds = item.action == "combine" ? adoptedIDs.filter { $0 != item.candidateId } : []; return copy } }
    public func isComplete(candidates: [TheoryCandidateResponse]) -> Bool {
        guard !candidates.isEmpty, decisions.count == candidates.count, Set(decisions.map(\.candidateId)) == Set(candidates.map(\.candidateId)), !adoptedIDs.isEmpty else { return false }
        guard decisions.allSatisfy({ item in
            guard let action = item.action, !(item.reason ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let candidate = candidates.first(where: { $0.candidateId == item.candidateId }), candidate.version == item.candidateVersion else { return false }
            if ["adopt", "combine"].contains(action), !candidate.formalAdoptionEligible { return false }
            return action != "revise_applicability" || !(item.revisedApplicability ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }), activeAssignments.count == adoptedIDs.count, activeAssignments.allSatisfy({ !$0.responsibility.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !$0.roleCode.isEmpty }) else { return false }
        return adoptedIDs.count < 2 || (![relation.explanation, relation.premiseCompatibility, relation.supportingEvidence.joined(), relation.excludingEvidence.joined(), relation.distinguishingEvidence.joined()].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    }
    public func saveRequest(run: MatchRunResponse) -> SaveTheoryDecisionDraftRequest {
        SaveTheoryDecisionDraftRequest(acknowledgedCandidateIds: run.completionBasis == "complete" ? [] : decisions.map(\.candidateId), completionBasis: run.completionBasis, decisions: normalizedDecisions, expectedDraftVersion: version, expectedMatchRunVersion: run.version, failedCandidateIds: run.failedCandidateIds, partialCompletionAcknowledgementReason: partialReason.isEmpty ? nil : partialReason, relations: activeRelations, useAssignments: activeAssignments)
    }
    public func decisionRequest(run: MatchRunResponse) -> CreateTheoryDecisionsRequest {
        CreateTheoryDecisionsRequest(completionBasis: run.completionBasis, decisions: normalizedDecisions.compactMap { item in guard let action = item.action else { return nil }; return TheoryDecisionInput(action: action, candidateId: item.candidateId, candidateVersion: item.candidateVersion, reason: item.reason ?? "", relatedCandidateIds: item.relatedCandidateIds ?? [], relatedSourceIds: item.relatedSourceIds, revisedApplicability: item.revisedApplicability) }, expectedDraftVersion: version, expectedMatchRunVersion: run.version, relations: activeRelations, useAssignments: activeAssignments)
    }
}
