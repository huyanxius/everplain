import XCTest
@testable import EverplainCore

/// Synthetic fixtures only. No account data or production graph content.
final class KnowledgeLogicTests: XCTestCase {
    private func document(_ id: String, filename: String = "Synthetic note.md", status: String = "ready", knowledgeStatus: String = "ready", topics: [CourseTopicResponse] = [], relations: [CourseRelationResponse] = []) -> SharedDocumentResponse {
        SharedDocumentResponse(createdAt: "2026-01-01T00:00:00Z", filename: filename, id: id, indexStatus: "ready", knowledge: CourseKnowledgeResponse(relations: relations, summary: "Synthetic summary", topics: topics), knowledgeStatus: knowledgeStatus, mediaType: "text/markdown", parseId: "parse-" + id, sizeBytes: 10, status: status)
    }
    private func library(_ id: String, access: String = "owner", docs: [SharedDocumentResponse]) -> SharedKnowledgeResponse {
        SharedKnowledgeResponse(description: "Synthetic fixture", documents: docs, id: id, name: "Synthetic " + id, viewerAccess: access)
    }
    func testAllMaterialsExcludesReadersButExplicitSharedScopeIsReadable() {
        let own = library("own", docs: [document("a")]), shared = library("shared", access: "reader", docs: [document("b")]), denied = library("denied", access: "none", docs: [document("c")])
        XCTAssertEqual(KnowledgeLogic.materials([own, shared, denied], selectedId: nil).map(\.document.id), ["a"])
        XCTAssertEqual(KnowledgeLogic.materials([own, shared, denied], selectedId: "shared").map(\.document.id), ["b"])
        XCTAssertTrue(KnowledgeLogic.materials([own, shared, denied], selectedId: "denied").isEmpty)
    }
    func testSearchIncludesLibrarySummaryAndTopicEvidenceAndHonorsType() {
        let topic = CourseTopicResponse(segmentIds: ["s1"], summary: "原文中的合成线索", title: "合成概念")
        let own = library("fixture", docs: [document("a", filename: "Sample.PDF", topics: [topic]), document("b")])
        XCTAssertEqual(KnowledgeLogic.materials([own], selectedId: nil, query: "合成线索", kind: "PDF").map(\.document.id), ["a"])
        XCTAssertEqual(KnowledgeLogic.materials([own], selectedId: nil, query: "FIXTURE").count, 2)
        XCTAssertTrue(KnowledgeLogic.materials([own], selectedId: nil, query: "合成概念", kind: "Word").isEmpty)
        XCTAssertEqual(KnowledgeLogic.kind(document("a", filename: "slides.pptx")), "演示文稿")
        XCTAssertEqual(KnowledgeLogic.kind(document("a", filename: "page.htm")), "网页")
    }
    func testProcessingDoesNotConflateReadableDocumentsWithReadyKnowledge() {
        var value = document("a", knowledgeStatus: "queued")
        XCTAssertTrue(KnowledgeLogic.processing(value)); XCTAssertTrue(KnowledgeLogic.status(value).contains("等待知识整理"))
        value.knowledgeStatus = "ready"; value.indexStatus = "failed"
        XCTAssertFalse(KnowledgeLogic.processing(value)); XCTAssertEqual(KnowledgeLogic.status(value), "语义索引失败")
        value.status = "processing"; XCTAssertTrue(KnowledgeLogic.processing(value))
    }
    func testPointsNormalizeTitlesButPreserveSeparateOriginalEvidence() {
        let docs = [document("a", topics: [.init(segmentIds: ["sa"], summary: "first source", title: "ＡＩ")]), document("b", topics: [.init(segmentIds: ["sb"], summary: "second source", title: "AI ")]), document("pending", knowledgeStatus: "queued", topics: [.init(segmentIds: ["sc"], summary: "not ready", title: "AI")])]
        let points = KnowledgeLogic.points(library("one", docs: docs))
        XCTAssertEqual(points.count, 1); XCTAssertEqual(points[0].title, "ＡＩ")
        XCTAssertEqual(points[0].evidence.map(\.documentId), ["a", "b"])
        XCTAssertEqual(points[0].evidence.flatMap(\.segmentIds), ["sa", "sb"])
        XCTAssertEqual(KnowledgeLogic.points(library("one", docs: docs), query: "second source").count, 1)
        XCTAssertEqual(KnowledgeLogic.points(library("two", docs: docs))[0].libraryId, "two")
    }
    func testLibraryGraphPreservesCandidateRelationsAndDropsDanglingEdges() {
        let topics = [CourseTopicResponse(segmentIds: ["s1"], summary: "a", title: "A"), .init(segmentIds: ["s2"], summary: "b", title: "B")]
        let relations = [CourseRelationResponse(label: "合成关系", segmentIds: ["s1"], source: "A", target: "B"), .init(label: "bad endpoint", segmentIds: [], source: "A", target: "missing")]
        let graph = KnowledgeLogic.graph(library("one", docs: [document("d", topics: topics, relations: relations)]))
        XCTAssertEqual(graph.nodes.map(\.kind), ["dimension", "category", "entry", "entry"])
        XCTAssertEqual(graph.edges.count, 4)
        let relation = graph.edges.first(where: \.candidate)
        XCTAssertEqual(relation?.evidence?.documentId, "d"); XCTAssertEqual(relation?.evidence?.segmentIds, ["s1"])
        XCTAssertEqual(KnowledgeLogic.neighbors("topic:A", in: graph), ["document:d", "topic:B"])
    }
    func testPersonalGraphMaintainsExactNodeIdentityTypesAndConcentricLevels() {
        let response = PersonalGraphResponse(avatarId: "synthetic", color: "#123456", documentCount: 1, edges: [.init(direction: "directed", id: "e", layer: "structure", relationType: "contains", source: "self", target: "topic"), .init(direction: "directed", id: "bad", layer: "structure", relationType: "contains", source: "self", target: "missing")], mode: "mock", name: "Synthetic graph", nodes: [.init(id: "self", label: "Synthetic", level: 0, nodeType: "self"), .init(id: "topic", label: "Topic", level: 1, nodeType: "topic"), .init(id: "doc", label: "Document", level: 2, nodeType: "document"), .init(id: "point", label: "Point", level: 3, nodeType: "knowledge")], pendingCount: 0, releaseId: "fixture", sources: [:], topicCount: 1)
        let graph = KnowledgeLogic.graph(response), positions = KnowledgeLogic.layout(KnowledgeLogic.graph(response))
        XCTAssertEqual(graph.nodes.map(\.id), response.nodes.map(\.id)); XCTAssertEqual(graph.nodes.map(\.kind), response.nodes.map(\.nodeType)); XCTAssertEqual(graph.edges.count, 1)
        XCTAssertEqual(positions["self"], .init(x: 0, y: 0))
        let r1 = hypot(positions["topic"]!.x, positions["topic"]!.y), r2 = hypot(positions["doc"]!.x, positions["doc"]!.y)
        XCTAssertEqual(r2, r1 * 2, accuracy: 0.00001)
        XCTAssertEqual(KnowledgeLogic.layout(graph), positions)
        XCTAssertNotEqual(KnowledgeLogic.layout(graph, seed: 1)["doc"], positions["doc"])
    }
    func testExternalLinksRequireExplicitWebSchemeAndNoCredentials() {
        for value in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://user:secret@example.com", "https://example.com\n.evil.test", "//example.com", "https://"] { XCTAssertNil(KnowledgeLogic.safeWebURL(value), value) }
        XCTAssertEqual(KnowledgeLogic.safeWebURL("https://example.com/source?q=notes")?.host, "example.com")
        XCTAssertNotNil(KnowledgeLogic.safeWebURL("http://example.com/source"))
    }
    func testKnowledgeEditsCannotLoseOrForgeSourceProvenance() {
        var input = UpdateDocumentKnowledgeRequest(relations: [], summary: "Synthetic", topics: [.init(segmentIds: ["s1"], summary: "Source", title: "A")])
        XCTAssertNil(KnowledgeLogic.validateKnowledge(input, segments: ["s1"]))
        input.topics[0].segmentIds = []; XCTAssertNotNil(KnowledgeLogic.validateKnowledge(input, segments: ["s1"]))
        input.topics[0].segmentIds = ["another-owner-segment"]; XCTAssertNotNil(KnowledgeLogic.validateKnowledge(input, segments: ["s1"]))
        input.topics[0].segmentIds = ["s1"]; input.relations = [.init(label: "Relation", segmentIds: ["s1"], source: "A", target: "missing")]
        XCTAssertNotNil(KnowledgeLogic.validateKnowledge(input, segments: ["s1"]))
    }
    func testImportSourceAcceptsAndUIDMatchWebRules() {
        XCTAssertTrue(KnowledgeImportSource.file.accepts(filename: "TEST.PDF")); XCTAssertFalse(KnowledgeImportSource.file.accepts(filename: "app.command"))
        XCTAssertTrue(KnowledgeImportSource.image.accepts(filename: "screen.webp")); XCTAssertTrue(KnowledgeImportSource.obsidian.accepts(filename: "vault.zip"))
        XCTAssertTrue(KnowledgeImportSource.validPublicUID("123456")); XCTAssertFalse(KnowledgeImportSource.validPublicUID("１２３")); XCTAssertFalse(KnowledgeImportSource.validPublicUID("123x")); XCTAssertFalse(KnowledgeImportSource.validPublicUID(String(repeating: "1", count: 21)))
    }
    func testLocatorRetainsPageHeadingParagraphAndLine() {
        let segment = SharedSourceSegmentResponse(kind: "paragraph", locator: .init(lineEnd: 15, lineStart: 12, page: 2, paragraph: 3, sectionPath: ["Chapter"]), ordinal: 6, parseId: "parse", segmentId: "s", text: "Synthetic source")
        XCTAssertEqual(KnowledgeLogic.locator(segment), "Chapter · 第 2 页 · 第 3 段 · 第 12–15 行")
        var fallback = segment; fallback.locator = .init(sectionPath: []); XCTAssertEqual(KnowledgeLogic.locator(fallback), "第 7 段")
    }
}
