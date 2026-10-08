import XCTest
@testable import EverplainCore

final class ConversationCitationTests: XCTestCase {
    private func citation(_ id: String, deleted: Bool = false, knowledge: String? = nil) -> AgentCitationResponse {
        AgentCitationResponse(citationId: id, deleted: deleted, kind: "knowledge", knowledgeId: knowledge, label: "Source")
    }
    func testOnlyReturnedUnambiguousSourcesBecomeNumberedChips() {
        let parsed = ConversationCitations.prepare("正文[citation_id:a]和【knowledge:k】[citation_id:unknown]", citations: [citation("a", knowledge: "k")])
        XCTAssertEqual(parsed.text, "正文\u{FFFC}和\u{FFFC}")
        XCTAssertEqual(parsed.citationAtOffset, [2: 0, 4: 0])
        XCTAssertEqual(parsed.sourceOffsets.count, parsed.text.utf16.count)
        XCTAssertEqual(parsed.sourceOffsets[2], 16)
    }
    func testDeletedAndAmbiguousAliasesAreRemovedAndPartialMarkersStayHidden() {
        let parsed = ConversationCitations.prepare("A[knowledge:k]B[citation_id:gone]C[citation_id:par", citations: [citation("a", knowledge: "k"), citation("b", knowledge: "k"), citation("gone", deleted: true)])
        XCTAssertEqual(parsed.text, "ABC")
        XCTAssertTrue(parsed.citationAtOffset.isEmpty)
    }
    func testCodeAndExplicitMarkdownLinksKeepTheirLiteralContents() {
        let input = "`[citation_id:a]` [citation_id:a](https://example.org) <span title='[citation_id:a]'> [citation_id:a]"
        let parsed = ConversationCitations.prepare(input, citations: [citation("a")])
        XCTAssertTrue(parsed.text.hasPrefix("`[citation_id:a]` [citation_id:a](https://example.org) <span title='[citation_id:a]'>"))
        XCTAssertEqual(parsed.citationAtOffset.count, 1)
    }
    func testCopyOmitsInternalSourceAnchors() {
        XCTAssertEqual(ConversationCitations.displayText("回答[citation_id:a]。未完【web:abc"), "回答。未完")
    }
}
