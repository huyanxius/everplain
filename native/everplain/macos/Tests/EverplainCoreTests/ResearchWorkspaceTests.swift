import XCTest
@testable import EverplainCore

final class ResearchWorkspaceTests: XCTestCase {
    private func document(version: Int = 1, content: String = "原文") -> ResearchDocumentResponse {
        ResearchDocumentResponse(actor: "user", changeSummary: "编辑", createdAt: "2026-10-04T00:00:00Z", documentId: "doc", formatting: ResearchDocumentFormattingContract(cslStyleId: "apa", customCss: "p { color: black }", locale: "zh-CN", templateId: "research"), knowledgeReleaseId: "release", revisionId: "r\(version)", sections: [ResearchDocumentSectionContract(citationRefs: [ResearchDocumentCitationRefContract(citationId: "cite", kind: "empirical", locator: ["page": .integer(2)], sourceId: "source", sourceVersion: "2", state: "verified")], content: content, evidenceRefs: [ResearchDocumentEvidenceRefContract(annotationId: "annotation", evidenceRefId: "evidence", knowledgeReleaseId: "release", locator: ["page": .integer(2)], materialId: "material", parseId: "parse", segmentId: "segment", sourceId: "source", sourceKind: "material")], key: "research_question", sectionId: "stable-section", status: "draft", title: "研究问题")], status: "draft", taskId: "task", title: "文稿", version: version)
    }
    func testNetworkRetryRetainsExactKeyButChangesNeverReuseIt() throws {
        let body = ConfirmResearchStartRequest(expectedVersion: 3, phenomenon: "现象")
        let initial = try ResearchMutationAttempt(path: "/proposal/confirm", body: body)
        let retry = try ResearchMutationAttempt(path: "/proposal/confirm", body: body, previous: initial)
        XCTAssertEqual(initial, retry)
        let changed = try ResearchMutationAttempt(path: "/proposal/confirm", body: ConfirmResearchStartRequest(expectedVersion: 4, phenomenon: "现象"), previous: initial)
        XCTAssertNotEqual(changed.key, initial.key)
        XCTAssertNotEqual(try ResearchMutationAttempt(path: "/another/confirm", body: body, previous: initial).key, initial.key)
        XCTAssertNotEqual(try ResearchMutationAttempt(path: initial.path, method: "PATCH", body: body, previous: initial).key, initial.key)
    }
    func testDirtyDraftNeverSilentlyRebasesOverRemoteVersion() throws {
        var draft = ResearchDocumentDraft(document()); draft.sections[0].content = "本地未保存"
        draft.receive(document(version: 2, content: "其他设备修改"))
        XCTAssertEqual(draft.base.version, 1); XCTAssertEqual(draft.sections[0].content, "本地未保存"); XCTAssertEqual(draft.remote?.version, 2)
        XCTAssertThrowsError(try draft.saveRequest(changeSummary: "保存")) { XCTAssertEqual($0 as? ResearchWorkspaceError, .versionConflict) }
        draft.receive(document(version: 2, content: "其他设备修改")); XCTAssertTrue(draft.hasConflict)
        draft.discardLocalChanges(); XCTAssertEqual(draft.base.version, 2); XCTAssertEqual(draft.sections[0].content, "其他设备修改"); XCTAssertFalse(draft.isDirty)
    }
    func testSavePreservesStableSectionsAndEveryEvidenceLocator() throws {
        let original = document(); var draft = ResearchDocumentDraft(original); draft.sections[0].content = "修订后的内容"
        let request = try draft.saveRequest(changeSummary: "修改")
        XCTAssertEqual(request.expectedVersion, 1); XCTAssertEqual(request.sections[0].sectionId, "stable-section")
        XCTAssertEqual(request.sections[0].evidenceRefs, original.sections[0].evidenceRefs)
        XCTAssertEqual(request.sections[0].citationRefs, original.sections[0].citationRefs)
        XCTAssertEqual(request.formatting, original.formatting)
        let decoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        XCTAssertEqual(decoded["expected_version"] as? Int, 1)
        XCTAssertEqual(decoded["source"] as? String, "user_edit")
    }
    func testTypingDuringSaveRetainsNewerLocalTextAgainstAcknowledgedBase() throws {
        var live = ResearchDocumentDraft(document()); live.sections[0].content = "已提交内容"
        let submitted = live; live.sections[0].content = "保存期间继续输入"
        live.acknowledge(document(version: 2, content: "已提交内容"), submitted: submitted)
        XCTAssertEqual(live.base.version, 2); XCTAssertEqual(live.sections[0].content, "保存期间继续输入"); XCTAssertTrue(live.isDirty)
        XCTAssertEqual(try live.saveRequest(changeSummary: "下一版").expectedVersion, 2)
    }
    func testReadRefreshIgnoresWrongDocumentAndOlderRevision() {
        var draft = ResearchDocumentDraft(document(version: 3)); draft.receive(document(version: 2, content: "旧内容")); XCTAssertEqual(draft.base.version, 3)
        var wrong = document(version: 4); wrong.documentId = "another"; draft.receive(wrong); XCTAssertEqual(draft.base.documentId, "doc")
        draft.receive(document(version: 4, content: "新内容")); XCTAssertEqual(draft.sections[0].content, "新内容")
    }
    func testDuplicateSectionIDsCannotBeSaved() {
        var draft = ResearchDocumentDraft(document()); draft.sections.append(draft.sections[0]); XCTAssertThrowsError(try draft.saveRequest(changeSummary: "重复"))
    }
    func testAgentPatchesCannotReplaceOrRemoveUserEditedNodes() {
        let edited = AgentResearchMapNodeResponse(citationIds: ["citation"], id: "user-node", kind: "claim", status: "grounded", title: "人工修改", userEdited: true)
        let ordinary = AgentResearchMapNodeResponse(citationIds: [], id: "agent-node", kind: "concept", status: "developing", title: "Agent")
        let initial = AgentResearchMapResponse(nodes: [edited, ordinary], relations: [AgentResearchMapRelationResponse(id: "edge", relation: "supports", source: edited.id, target: ordinary.id)], schemaVersion: 1)
        let replacement = AgentResearchMapNodeResponse(citationIds: [], id: edited.id, kind: "claim", status: "developing", title: "覆盖")
        let patch = AgentResearchMapPatchResponse(nodes: [replacement], relations: [], removeNodeIds: [edited.id, ordinary.id], removeRelationIds: [], schemaVersion: 1)
        let result = ResearchCanvasProjection.apply([patch], to: initial)
        XCTAssertEqual(result.nodes, [edited]); XCTAssertTrue(result.relations.isEmpty)
    }
    func testFailedStreamDoesNotProjectUncommittedMapPatches() {
        let node = AgentResearchMapNodeResponse(citationIds: [], id: "pending", kind: "claim", status: "developing", title: "未完成")
        let patch = AgentResearchMapPatchResponse(nodes: [node], relations: [], removeNodeIds: [], removeRelationIds: [], schemaVersion: 1)
        XCTAssertTrue(ResearchCanvasProjection.project(nil, livePatches: [patch], failedOrInterrupted: true).nodes.isEmpty)
        XCTAssertEqual(ResearchCanvasProjection.project(nil, livePatches: [patch]).nodes, [node])
    }
    func testQuoteOffsetsUseUnicodeScalarsAndRejectMissingOrAmbiguousText() throws {
        XCTAssertEqual(try ResearchQuoteSelection.range(of: "研究", in: "🙂研究内容"), 1..<3)
        XCTAssertEqual(try ResearchQuoteSelection.range(of: "后", in: "e\u{301}后"), 2..<3)
        XCTAssertThrowsError(try ResearchQuoteSelection.range(of: "不存在", in: "原文"))
        XCTAssertThrowsError(try ResearchQuoteSelection.range(of: "相同", in: "相同内容和相同内容"))
    }
}

extension ResearchWorkspaceTests {
    private func candidate(_ id: String, eligible: Bool = true, version: Int = 1) -> TheoryCandidateResponse {
        TheoryCandidateResponse(adoptionBlockers: eligible ? [] : ["依据不足"], allowedActions: ["create_decision"], analysisLevels: [], applicabilityJudgement: "conditional", applicabilityRationale: "研究语境相关", candidateId: id, competingTheories: [], complementaryTheories: [], conflictingEvidence: [], contentStatus: "ready", coreClaims: [], formalAdoptionEligible: eligible, judgementRunStatus: "succeeded", knowledgeReleaseId: "release", limitations: [], missingEvidence: [], misuseBoundaries: [], model: ModelMetadata(capability: "theory_match", degraded: false, modelVersion: "test", provider: "fixture", trace: TraceMetadata(contractVersion: "1", requestId: "request", traceId: "trace")), origin: "retrieval", prerequisites: [], problemFocus: "研究问题", requestedMaterial: [], sourceIds: ["source"], supportingEvidence: [], title: id, version: version)
    }
    private func run(_ candidates: [TheoryCandidateResponse]) -> MatchRunResponse {
        MatchRunResponse(allowedActions: ["create_decision"], candidatePage: MatchCandidatePageResponse(allowedActions: [], candidates: candidates, knowledgeReleaseId: "release", matchRunId: "run", stableOrder: candidates.map(\.candidateId), version: 6), completedCandidateCount: candidates.count, completionBasis: "complete", failedCandidateCount: 0, failedCandidateIds: [], failedCandidates: [], knowledgeReleaseId: "release", matchRunId: "run", partialCompletionAcknowledged: false, phenomenonQueryId: "phenomenon", phenomenonVersion: 2, retrieval: RetrievalProvenanceResponse(mode: "hybrid", retrievedChunkIds: []), status: "awaiting_decision", taskId: "task", totalCandidateCount: candidates.count, version: 6)
    }
    func testTheoryDecisionsRequireEligibleCurrentCandidateAndUserResponsibility() {
        let candidate = candidate("candidate"); var draft = ResearchTheoryDraft(server: nil, candidates: [candidate])
        XCTAssertFalse(draft.isComplete(candidates: [candidate]))
        draft.decisions[0].action = "adopt"; draft.decisions[0].reason = "解释证据"; draft.assignments[0].roleCode = "primary"
        XCTAssertFalse(draft.isComplete(candidates: [candidate]))
        draft.assignments[0].responsibility = "解释组织机制"
        XCTAssertTrue(draft.isComplete(candidates: [candidate]))
        var ineligible = candidate; ineligible.formalAdoptionEligible = false; XCTAssertFalse(draft.isComplete(candidates: [ineligible]))
        var changed = candidate; changed.version = 2; XCTAssertFalse(draft.isComplete(candidates: [changed]))
    }
    func testTheoryDraftAndFinalizationCarryBothCASVersions() throws {
        let candidate = candidate("candidate"); var draft = ResearchTheoryDraft(server: nil, candidates: [candidate]); draft.version = 4
        draft.decisions[0].action = "adopt"; draft.decisions[0].reason = "采用"; draft.assignments[0].responsibility = "组织机制"
        let save = draft.saveRequest(run: run([candidate])); let final = draft.decisionRequest(run: run([candidate]))
        XCTAssertEqual(save.expectedDraftVersion, 4); XCTAssertEqual(save.expectedMatchRunVersion, 6)
        XCTAssertEqual(final.expectedDraftVersion, 4); XCTAssertEqual(final.expectedMatchRunVersion, 6)
        XCTAssertEqual(final.decisions.first?.candidateVersion, 1)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(save)) as! [String: Any]
        XCTAssertEqual(json["expected_draft_version"] as? Int, 4); XCTAssertEqual(json["expected_match_run_version"] as? Int, 6)
    }
    func testCombinedTheoryMustExplainRelationsAndExcludeSelfFromRelatedIDs() {
        let candidates = [candidate("a"), candidate("b")]; var draft = ResearchTheoryDraft(server: nil, candidates: candidates)
        for index in 0..<2 { draft.decisions[index].action = "combine"; draft.decisions[index].reason = "互补"; draft.assignments[index].responsibility = "解释分工" }
        XCTAssertFalse(draft.isComplete(candidates: candidates))
        draft.relation.explanation = "互补机制"; draft.relation.premiseCompatibility = "相同情境"; draft.relation.supportingEvidence = ["观察支持"]; draft.relation.excludingEvidence = ["排除替代"]; draft.relation.distinguishingEvidence = ["区分机制"]
        XCTAssertTrue(draft.isComplete(candidates: candidates)); XCTAssertEqual(draft.activeRelations.first?.candidateIds, ["a", "b"])
        XCTAssertEqual(draft.normalizedDecisions[0].relatedCandidateIds, ["b"]); XCTAssertEqual(draft.normalizedDecisions[1].relatedCandidateIds, ["a"])
    }
}

extension ResearchWorkspaceTests {
    func testUnrelatedMutationCannotDestroyAnUncertainRetryIdentity() throws {
        var journal = ResearchMutationJournal()
        let first = try journal.prepare(path: "/doc/a", method: "PATCH", body: ["content": "draft"])
        let other = try journal.prepare(path: "/method/b", method: "PATCH", body: ["content": "method"])
        journal.complete(other)
        XCTAssertEqual(try journal.prepare(path: first.path, method: first.method, body: ["content": "draft"]).key, first.key)
        journal.complete(first)
        XCTAssertNotEqual(try journal.prepare(path: first.path, method: first.method, body: ["content": "draft"]).key, first.key)
        journal.reset()
        XCTAssertNotEqual(try journal.prepare(path: first.path, method: first.method, body: ["content": "draft"]).key, first.key)
    }
}
