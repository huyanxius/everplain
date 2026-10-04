import XCTest
@testable import EverplainCore

final class ResearchWorkspaceExportTests: XCTestCase {
    private func fixture(template: String = "chinese-social-science", css: String? = nil, citationVersion: String? = nil) -> ResearchDocumentExportResponse {
        let formatting = ResearchDocumentFormattingContract(cslStyleId: "china-national-standard-gb-t-7714-2015-author-date", customCss: css, locale: "zh-CN", templateId: template)
        let formal: [String: JSONValue] = ["title": .string("跨语言照护研究 / Care & Community"), "sections": .array([
            .object(["section_id": .string("stable-section-α"), "title": .string("Findings / 发现"), "content": .string("照护实践 combines **family duty** and *neighborhood support*.\n\n> 原文依据：migration & care\n\n1. First finding\n   - Nested finding\n\n| 案例 | 发现 |\n| :--- | ---: |\n| 家庭 A | care \\| support |\n\n```swift\nlet value = \"<script>literal</script>\"\n```\n\n[官方来源](https://example.org/paper?a=1&b=2)\n\n<script>raw text only</script>")])])]
        let audit = [ResearchDocumentCitationAuditContract(citationId: "citation-1", kind: "scholarly", sectionId: "stable-section-α", sourceId: "literature-1", sourceVersion: citationVersion, state: "verified"), ResearchDocumentCitationAuditContract(citationId: "missing", kind: "empirical", sectionId: "stable-section-α", sourceId: "removed-source", state: "tombstoned")]
        let manifest = ResearchDocumentExportManifest(citationAudit: audit, documentIdentity: ResearchDocumentVersionIdentityContract(documentId: "doc-1", revisionId: "revision-7", version: 7), documentVersions: [], formalDocument: formal, formatting: formatting, schemaVersion: "everplain-document-v1")
        return ResearchDocumentExportResponse(documentId: "doc-1", filename: "research.md", knowledgeReleaseId: "release-1", manifest: manifest, markdown: "server markdown", mediaType: "text/markdown", taskId: "task-1", version: 7)
    }
    private var literature: LiteratureEntryResponse {
        LiteratureEntryResponse(attachmentMaterialIds: [], collectionIds: [], createdAt: "2026-10-04T00:00:00Z", cslData: ["id": .string("literature-1"), "type": .string("article-journal"), "title": .string("Intergenerational Care across Migration"), "author": .array([.object(["family": .string("Zhou"), "given": .string("Min")])]), "issued": .object(["date-parts": .array([.array([.integer(2024)])])])], itemType: "article-journal", literatureId: "literature-1", title: "Intergenerational Care across Migration")
    }
    private var bibliography: ResearchExportBibliography { ResearchExportBibliography(htmlEntries: ["<div class=\"csl-entry\">Zhou, Min. 2024. <i>Intergenerational Care across Migration</i>.</div>"], textEntries: ["Zhou, Min. 2024. Intergenerational Care across Migration."], hangingIndent: true) }
    private func parts(_ bytes: Data) throws -> [String: Data] {
        // Independent read of stored ZIP entries, with Python/LibreOffice integration checking the complete package below.
        func u16(_ offset: Int) -> Int { Int(bytes[offset]) | Int(bytes[offset + 1]) << 8 }
        func u32(_ offset: Int) -> Int { u16(offset) | u16(offset + 2) << 16 }
        var cursor = 0, result: [String: Data] = [:]
        while cursor + 30 <= bytes.count && u32(cursor) == 0x04034b50 {
            XCTAssertEqual(u16(cursor + 8), 0)
            let size = u32(cursor + 18), count = u16(cursor + 26), extra = u16(cursor + 28), start = cursor + 30 + count + extra
            guard start + size <= bytes.count, let name = String(data: bytes[(cursor + 30)..<(cursor + 30 + count)], encoding: .utf8) else { throw ResearchExportFailure.invalidPackage }
            result[name] = bytes[start..<(start + size)]; cursor = start + size
        }
        XCTAssertEqual(u32(cursor), 0x02014b50); return result
    }
    func testDocxIsRealOOXMLWithUnicodeFormattingTablesLinksAndProvenance() throws {
        let document = ResearchExportDocument(exported: fixture(), literature: [literature]); let bytes = try ResearchExportDOCX.data(document: document, bibliography: bibliography, modifiedAt: Date(timeIntervalSince1970: 1_700_000_000)); let files = try parts(bytes)
        XCTAssertEqual(Array(bytes.prefix(2)), [0x50, 0x4b]); XCTAssertEqual(files.count, 8)
        let body = String(decoding: try XCTUnwrap(files["word/document.xml"]), as: UTF8.self)
        XCTAssertTrue(body.contains("跨语言照护研究")); XCTAssertTrue(body.contains("<w:b/>")); XCTAssertTrue(body.contains("<w:i/>")); XCTAssertTrue(body.contains("<w:tbl>")); XCTAssertTrue(body.contains("care | support")); XCTAssertTrue(body.contains("&lt;script&gt;literal&lt;/script&gt;")); XCTAssertTrue(body.contains("引用异常")); XCTAssertTrue(body.contains("removed-source · tombstoned")); XCTAssertFalse(body.contains("<script>")); XCTAssertTrue(body.contains("<w:hyperlink")); XCTAssertTrue(body.contains("w:w=\"11906\" w:h=\"16838\""))
        let manifest = String(decoding: try XCTUnwrap(files["customXml/item1.xml"]), as: UTF8.self)
        XCTAssertTrue(manifest.contains("stable-section-α")); XCTAssertTrue(manifest.contains("revision-7")); XCTAssertTrue(manifest.contains("citation_audit"))
        let rels = String(decoding: try XCTUnwrap(files["word/_rels/document.xml.rels"]), as: UTF8.self); XCTAssertTrue(rels.contains("https://example.org/paper?a=1&amp;b=2"))
        if let directory = ProcessInfo.processInfo.environment["EVERPLAIN_EXPORT_FIXTURE_DIR"] { let url = URL(fileURLWithPath: directory); try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true); try bytes.write(to: url.appendingPathComponent("research-chinese.docx")); try ResearchExportDOCX.data(document: ResearchExportDocument(exported: fixture(template: "asa"), literature: [literature]), bibliography: bibliography).write(to: url.appendingPathComponent("research-asa.docx")) }
    }
    func testSourceTemplatePageSizesFontsAndLineSpacing() throws {
        let asa = ResearchExportPageStyle(template: "asa"); XCTAssertEqual(asa.widthTwips, 12240); XCTAssertEqual(asa.heightTwips, 15840); XCTAssertEqual(asa.top, 72); XCTAssertEqual(asa.docxFont, "Times New Roman"); XCTAssertEqual(asa.lineHeight, 2)
        let chinese = ResearchExportPageStyle(template: "chinese-social-science"); XCTAssertEqual(chinese.widthTwips, 11906); XCTAssertEqual(chinese.heightTwips, 16838); XCTAssertEqual(Int((chinese.top * 20).rounded()), 1417); XCTAssertEqual(Int((chinese.left * 20).rounded()), 1361); XCTAssertEqual(chinese.docxFont, "宋体"); XCTAssertEqual(chinese.lineHeight, 1.8)
        let files = try parts(ResearchExportDOCX.data(document: ResearchExportDocument(exported: fixture(template: "asa")), bibliography: bibliography))
        let styles = String(decoding: try XCTUnwrap(files["word/styles.xml"]), as: UTF8.self); XCTAssertTrue(styles.contains("Times New Roman")); XCTAssertTrue(styles.contains("w:line=\"480\""))
    }
    func testCSLMetadataNeverInventedOrReplacedForHistoricalSources() {
        let missing = ResearchExportDocument(exported: fixture()); XCTAssertNil(missing.citations[0].csl); XCTAssertEqual(missing.citations[0].state, "needs_verification")
        let resolved = ResearchExportDocument(exported: fixture(), literature: [literature]); XCTAssertNotNil(resolved.citations[0].csl); XCTAssertEqual(resolved.citations[0].state, "verified"); XCTAssertEqual(resolved.warnings.count, 1)
        let historical = ResearchExportDocument(exported: fixture(citationVersion: "old-revision"), literature: [literature]); XCTAssertNil(historical.citations[0].csl); XCTAssertEqual(historical.citations[0].state, "needs_verification")
    }
    func testBibliographyXHTMLRetainsStylesAndNeverLoadsEntitiesOrScripts() throws {
        let runs = try XCTUnwrap(ResearchExportHTML.runs("<div>Zhou &amp; Li. <i>Care</i> <b>2024</b>.<script>alert(1)</script></div>"))
        XCTAssertEqual(runs.map(\.text).joined(), "Zhou & Li. Care 2024."); XCTAssertTrue(runs.contains { $0.text == "Care" && $0.italic }); XCTAssertTrue(runs.contains { $0.text == "2024" && $0.bold })
        XCTAssertNil(ResearchExportHTML.runs("<!DOCTYPE x [<!ENTITY local SYSTEM 'file:///etc/passwd'>]><div>&local;</div>"))
        XCTAssertFalse(ResearchExportMarkdown.safeLink("javascript:alert(1)")); XCTAssertFalse(ResearchExportMarkdown.safeLink("file:///etc/passwd"))
    }
    func testCustomPrintRulesAreAppliedAndUnsupportedRulesStayVisible() {
        let style = ResearchExportPageStyle(template: "custom", customCSS: "@page { size: letter landscape; margin: 1in; } body { font-size: 14pt; line-height: 1.5; color: #123; } h2 { font-size: 18pt; } .custom { transform: rotate(1deg); } </style><script>not executable</script>")
        XCTAssertEqual(style.width, 792); XCTAssertEqual(style.height, 612); XCTAssertEqual(style.top, 72); XCTAssertEqual(style.fontSize, 14); XCTAssertEqual(style.lineHeight, 1.5); XCTAssertEqual(style.color, "112233"); XCTAssertEqual(style.sectionSize, 18); XCTAssertTrue(style.warnings.joined().contains("transform")); XCTAssertTrue(style.warnings.joined().contains("HTML"))
    }
    func testZIPRejectsTraversalAndDuplicatePartNames() {
        XCTAssertThrowsError(try ResearchExportZIP.archive([("../outside", Data())])); XCTAssertThrowsError(try ResearchExportZIP.archive([("same", Data()), ("same", Data())]))
    }
    func testMarkdownPreservesNestedListsCodeAndStructuredTables() {
        let blocks = ResearchExportMarkdown.blocks("## Heading\n\n- **First**\n  - *Nested*\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```swift\nlet x = 1\n```\n")
        XCTAssertTrue(blocks.contains { $0.heading == 2 }); XCTAssertTrue(blocks.contains { $0.marker == "•" && $0.indent == 1 }); XCTAssertTrue(blocks.contains { $0.kind == "code" && $0.runs[0].code }); XCTAssertEqual(blocks.first { $0.kind == "table" }?.rows.count, 2)
    }
}

extension ResearchWorkspaceExportTests {
    func testImageLayoutSeparatesSourceFromPrintedAltText() {
        let source = "data:image/png;base64,aGVsbG8="
        let blocks = ResearchExportMarkdown.blocks("![研究图](\(source))")
        XCTAssertEqual(blocks.first?.kind, "image"); XCTAssertEqual(blocks.first?.imageSource, source)
        XCTAssertEqual(blocks.first?.runs.map(\.text).joined(), "[图像：研究图]")
    }
    func testInvalidCustomDimensionsRetainOriginalTemplate() {
        let style = ResearchExportPageStyle(template: "asa", customCSS: "@page { margin: 100in; }")
        XCTAssertEqual(style.widthTwips, 12240); XCTAssertEqual(style.docxFont, "Times New Roman"); XCTAssertFalse(style.warnings.isEmpty)
    }
}

extension ResearchWorkspaceExportTests {
    func testAuthenticatedImagesAreLimitedToDocumentedSameOriginRoutes() throws {
        let origin = try XCTUnwrap(URL(string: "https://research.example"))
        XCTAssertEqual(ResearchExportImagePolicy.ownerPath(source: "/api/imports/assets/document_1", origin: origin), "/api/imports/assets/document_1")
        XCTAssertEqual(ResearchExportImagePolicy.ownerPath(source: "https://research.example:443/api/research-tasks/task-1/materials/material-1/content", origin: origin), "/api/research-tasks/task-1/materials/material-1/content")
        for value in ["https://other.example/api/imports/assets/document_1", "https://research.example:444/api/imports/assets/document_1", "http://research.example/api/imports/assets/document_1", "https://u:p@research.example/api/imports/assets/document_1", "/api/account/export", "/api/imports/assets/document_1?token=untrusted", "/api/imports/assets/..%2Faccount", "file:///api/imports/assets/document_1"] {
            XCTAssertNil(ResearchExportImagePolicy.ownerPath(source: value, origin: origin), value)
        }
        XCTAssertFalse(ResearchExportImagePolicy.sameOrigin(URL(string: "https://research.example:444/a")!, origin))
    }
}
