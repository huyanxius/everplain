#if os(macOS)
import AppKit
import PDFKit
import XCTest
@testable import EverplainCore
@testable import EverplainMac

/// Offline integration tests of the production resource bundles and Apple runtimes.
/// These run with ordinary `swift test`; they need no window, account, or network.
final class NativeRuntimeTests: XCTestCase {
    @MainActor func testBundledGraphRuntimeHandlesEmptyAndDisconnectedGraphs() async throws {
        let empty = try await layout(NativeKnowledgeGraph(), width: 0, height: -20)
        XCTAssertEqual(empty.algorithm, "empty")
        XCTAssertTrue(empty.nodes.isEmpty)
        XCTAssertTrue(empty.edges.isEmpty)
        XCTAssertEqual(empty.pan.x, 0.5, accuracy: 0.0001)
        XCTAssertEqual(empty.pan.y, 0.5, accuracy: 0.0001)

        let graph = NativeKnowledgeGraph(nodes: [
            node("one", label: "引号 \" / \\ / </script> / 中文"),
            node("two"), node("three")
        ])
        let result = try await layout(graph)
        XCTAssertEqual(result.algorithm, "circle")
        XCTAssertEqual(Set(result.nodes.map(\.id)), Set(graph.nodes.map(\.id)))
        XCTAssertTrue(result.edges.isEmpty)
        XCTAssertGreaterThan(Set(result.nodes.map { "\($0.x),\($0.y)" }).count, 1)
    }

    @MainActor func testBundledGraphRuntimePreservesFocusCandidateAndArrowSemantics() async throws {
        let graph = NativeKnowledgeGraph(
            nodes: [node("focus"), node("neighbor"), node("candidate"), node("context")],
            edges: [
                edge("directed", from: "focus", to: "neighbor"),
                edge("both", from: "focus", to: "candidate", candidate: true),
                edge("undirected", from: "neighbor", to: "candidate")
            ]
        )
        let result = try await layout(graph, focus: "focus", directions: ["both": "bidirectional", "undirected": "undirected"])
        XCTAssertEqual(result.algorithm, "cose")
        XCTAssertEqual(Set(result.nodes.map(\.id)), Set(graph.nodes.map(\.id)))
        XCTAssertEqual(Set(result.edges.map(\.id)), Set(graph.edges.map(\.id)))
        let focus = try XCTUnwrap(result.nodes.first { $0.id == "focus" })
        let context = try XCTUnwrap(result.nodes.first { $0.id == "context" })
        // The selected node stays at the viewport center even with a disconnected node.
        XCTAssertEqual(focus.x * result.zoom + result.pan.x, 400, accuracy: 0.01)
        XCTAssertEqual(focus.y * result.zoom + result.pan.y, 300, accuracy: 0.01)
        XCTAssertLessThan(context.opacity, focus.opacity)
        XCTAssertEqual(context.textOpacity, 0)
        let directed = try XCTUnwrap(result.edges.first { $0.id == "directed" })
        XCTAssertTrue(directed.targetArrow)
        XCTAssertFalse(directed.sourceArrow)
        let candidate = try XCTUnwrap(result.edges.first { $0.id == "both" })
        XCTAssertTrue(candidate.sourceArrow && candidate.targetArrow)
        XCTAssertTrue(candidate.dashed)
        XCTAssertTrue(candidate.label.contains("候选"))
        let undirected = try XCTUnwrap(result.edges.first { $0.id == "undirected" })
        XCTAssertFalse(undirected.sourceArrow || undirected.targetArrow)
    }

    @MainActor func testBundledPersonalGraphUsesConcentricLayoutAndNativeAvatarSpace() async throws {
        let graph = NativeKnowledgeGraph(nodes: [
            node("self", kind: "self", level: 0),
            node("topic", kind: "topic", level: 1),
            node("knowledge", kind: "knowledge", level: 2)
        ], edges: [edge("topic-link", from: "self", to: "topic"), edge("knowledge-link", from: "topic", to: "knowledge")])
        let result = try await layout(graph)
        XCTAssertEqual(result.algorithm, "concentric")
        let avatar = try XCTUnwrap(result.nodes.first { $0.id == "self" })
        XCTAssertEqual(avatar.width, 70)
        XCTAssertEqual(avatar.height, 70)
        XCTAssertEqual(avatar.backgroundOpacity, 0)
        XCTAssertEqual(avatar.borderWidth, 0)
        XCTAssertEqual(try XCTUnwrap(result.nodes.first { $0.id == "topic" }).width, 18)
        XCTAssertEqual(try XCTUnwrap(result.nodes.first { $0.id == "knowledge" }).width, 6)
    }

    @MainActor func testGraphRuntimeFailureClearsPreviousOutputAndCanRecover() async throws {
        let state = KnowledgeGraphLayoutState()
        let valid = request(NativeKnowledgeGraph(nodes: [node("present")]))
        await state.load(valid)
        XCTAssertNotNil(state.result)
        await state.load(request(NativeKnowledgeGraph(nodes: [node("present")], edges: [edge("broken", from: "present", to: "missing")])))
        XCTAssertNil(state.result, "A failed graph retained the previous graph's positions")
        XCTAssertNotNil(state.error)
        XCTAssertFalse(state.loading)
        await state.load(valid)
        XCTAssertNil(state.error)
        XCTAssertEqual(state.result?.nodes.map(\.id), ["present"])
        XCTAssertFalse(state.loading)
        state.clear()
        XCTAssertNil(state.result)
        XCTAssertNil(state.error)
        XCTAssertFalse(state.loading)
    }

    @MainActor func testJavaScriptCoreLoadsAllBundledCSLStylesAndBothLocales() throws {
        var outputs: [String] = []
        for (style, locale) in [
            ("american-sociological-association", "en-US"),
            ("china-national-standard-gb-t-7714-2015-author-date", "zh-CN"),
            ("chicago-author-date", "en-US")
        ] {
            let bibliography = try ResearchWorkspaceExportCSL.bibliography(for: document(style: style, locale: locale))
            XCTAssertEqual(bibliography.textEntries.count, 2, style)
            XCTAssertEqual(bibliography.htmlEntries.count, 2, style)
            let text = bibliography.textEntries.joined(separator: "\n")
            XCTAssertTrue(text.contains("Intergenerational Care across Migration"), style)
            XCTAssertTrue(text.contains("流动家庭与代际照护"), style)
            XCTAssertTrue(text.contains("2024") && text.contains("2023"), style)
            XCTAssertGreaterThanOrEqual(bibliography.lineSpacing, 1)
            XCTAssertTrue(bibliography.richEntries.allSatisfy { !$0.isEmpty })
            if locale == "zh-CN" {
                XCTAssertTrue(text.contains("ZHOU M"))
                XCTAssertTrue(text.contains("李敏"))
            } else {
                XCTAssertTrue(text.contains("Zhou, Min"))
            }
            outputs.append(text)
        }
        XCTAssertEqual(Set(outputs).count, 3, "Distinct source CSL styles produced identical output")
    }

    @MainActor func testCustomCSLAndHostileLookingCitationStayDataInJavaScriptCore() throws {
        let title = "</script><script>throw 42</script>"
        let custom = """
        <?xml version="1.0" encoding="utf-8"?>
        <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
          <info><title>Offline fixture</title><id>https://example.invalid/fixture-style</id><updated>2026-01-01T00:00:00+00:00</updated></info>
          <citation><layout><text variable="title"/></layout></citation>
          <bibliography><layout><text variable="title" font-style="italic"/></layout></bibliography>
        </style>
        """
        let bibliography = try ResearchWorkspaceExportCSL.bibliography(for: document(customCSL: custom, articleTitle: title))
        let html = bibliography.htmlEntries.joined()
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertTrue(html.contains("&lt;script&gt;") || html.contains("&#60;script&#62;"))
        XCTAssertTrue(bibliography.textEntries.joined().contains(title))
        XCTAssertTrue(bibliography.richEntries.flatMap { $0 }.contains { $0.italic && $0.text.contains("throw 42") })
    }

    @MainActor func testCSLReportsMalformedAndUnknownStylesThenRecovers() throws {
        for invalid in [document(style: "unavailable-style"), document(customCSL: "invalid CSL")] {
            XCTAssertThrowsError(try ResearchWorkspaceExportCSL.bibliography(for: invalid)) { error in
                guard let failure = error as? ResearchExportFailure, case .bibliography = failure else {
                    return XCTFail("Expected a bibliography error, received \(error)")
                }
            }
        }
        XCTAssertEqual(try ResearchWorkspaceExportCSL.bibliography(for: document()).textEntries.count, 2)
        let missingMetadata = document(includeLiterature: false)
        XCTAssertFalse(missingMetadata.warnings.isEmpty)
        XCTAssertEqual(try ResearchWorkspaceExportCSL.bibliography(for: missingMetadata), ResearchExportBibliography())
    }

    @MainActor func testNativePDFHasSelectablePaginatedBodyReferencesMetadataAndLinks() throws {
        _ = NSApplication.shared
        let markers = (0..<75).map { String(format: "PARAGRAPH_%03d", $0) }
        let paragraphs = markers.map { "\($0) Synthetic research evidence remains readable across the native page boundary." }.joined(separator: "\n\n")
        let markdown = """
        **Opening evidence** with *native emphasis* and 中文照护.

        [Reference link](https://example.invalid/paper?a=1&b=2)

        | Case | Finding |
        | --- | --- |
        | TABLE_CASE | TABLE_FINDING |

        \(paragraphs)

        FINAL_BODY_SENTINEL
        """
        let source = document(markdown: markdown, includeWarning: true)
        let bibliography = try ResearchWorkspaceExportCSL.bibliography(for: source)
        let bytes = try ResearchWorkspaceExportPDF.data(document: source, bibliography: bibliography)
        try saveCIArtifact(bytes,name:"native-letter-runtime.pdf")
        let pdf = try XCTUnwrap(PDFDocument(data: bytes))
        XCTAssertGreaterThan(pdf.pageCount, 3, "The long native body did not paginate")
        XCTAssertEqual(pdf.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String, source.title)
        let first = try XCTUnwrap(pdf.page(at: 0)?.string)
        XCTAssertTrue(first.contains("Native Runtime Export"))
        XCTAssertFalse(first.contains(markers[0]), "Body text leaked onto the title page")
        let last = try XCTUnwrap(pdf.page(at: pdf.pageCount - 1)?.string)
        XCTAssertTrue(last.contains("Intergenerational Care"), "The separate references page is missing")
        let text = compact(try XCTUnwrap(pdf.string))
        for marker in markers + ["TABLE_CASE", "TABLE_FINDING", "FINAL_BODY_SENTINEL", "removed-source"] {
            XCTAssertEqual(text.components(separatedBy: marker).count - 1, 1, "Lost or duplicated PDF text: \(marker)")
        }
        XCTAssertTrue(text.contains("中文照护"), "The native PDF lost selectable Chinese text")
        var linkCount = 0
        for index in 0..<pdf.pageCount {
            let page = try XCTUnwrap(pdf.page(at: index))
            let bounds = page.bounds(for: .mediaBox)
            XCTAssertEqual(bounds.width, 612, accuracy: 0.1)
            XCTAssertEqual(bounds.height, 792, accuracy: 0.1)
            for annotation in page.annotations {
                if let action = annotation.action as? PDFActionURL, action.url?.absoluteString == "https://example.invalid/paper?a=1&b=2" {
                    linkCount += 1
                    XCTAssertGreaterThan(annotation.bounds.width, 0)
                    XCTAssertGreaterThan(annotation.bounds.height, 0)
                    XCTAssertTrue(bounds.contains(annotation.bounds), "Link annotation falls outside its page")
                }
            }
        }
        XCTAssertGreaterThan(linkCount, 0, "The native export dropped the actual PDF link annotation")
    }

    @MainActor func testNativePDFA4TemplatePreservesExportWarnings() throws {
        _ = NSApplication.shared
        let source = document(style: "china-national-standard-gb-t-7714-2015-author-date", locale: "zh-CN", template: "chinese-social-science", markdown: "A4_BODY_SENTINEL\n\n![Unavailable diagram](https://example.invalid/missing.png)")
        let bibliography = try ResearchWorkspaceExportCSL.bibliography(for: source)
        // Rendering receives an explicit missing-image warning; it must not fetch the URL.
        let bytes = try ResearchWorkspaceExportPDF.data(document: source, bibliography: bibliography, imageWarnings: ["IMAGE_WARNING_SENTINEL"])
        try saveCIArtifact(bytes,name:"native-a4-runtime.pdf")
        let pdf = try XCTUnwrap(PDFDocument(data: bytes))
        XCTAssertEqual(pdf.pageCount, 3)
        let body = compact(try XCTUnwrap(pdf.page(at: 1)?.string))
        XCTAssertTrue(body.contains("A4_BODY_SENTINEL"))
        XCTAssertTrue(body.contains("Unavailablediagram"))
        XCTAssertTrue(body.contains("IMAGE_WARNING_SENTINEL"))
        for index in 0..<pdf.pageCount {
            let bounds = try XCTUnwrap(pdf.page(at: index)).bounds(for: .mediaBox)
            XCTAssertEqual(bounds.width, 595.2756, accuracy: 0.1)
            XCTAssertEqual(bounds.height, 841.8898, accuracy: 0.1)
        }
    }

    private func saveCIArtifact(_ data: Data, name: String) throws {
        guard ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true" else { return }
        let package = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let directory = package.appendingPathComponent("verification/ci-results/native-runtime",isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        try data.write(to:directory.appendingPathComponent(name))
    }

    private func node(_ id: String, label: String? = nil, kind: String = "entry", level: Int = 2) -> NativeKnowledgeNode {
        NativeKnowledgeNode(id: id, label: label ?? id, kind: kind, level: level)
    }

    private func edge(_ id: String, from: String, to: String, candidate: Bool = false) -> NativeKnowledgeEdge {
        NativeKnowledgeEdge(id: id, source: from, target: to, label: "supports", candidate: candidate, evidence: nil)
    }

    private func request(_ graph: NativeKnowledgeGraph, focus: String? = nil, directions: [String: String] = [:], width: Double = 800, height: Double = 600) -> KnowledgeGraphLayoutRequest {
        KnowledgeGraphLayoutRequest(graph: graph, focusNodeId: focus, edgeDirections: directions, width: width, height: height)
    }

    @MainActor private func layout(_ graph: NativeKnowledgeGraph, focus: String? = nil, directions: [String: String] = [:], width: Double = 800, height: Double = 600) async throws -> KnowledgeGraphLayoutResult {
        let state = KnowledgeGraphLayoutState()
        await state.load(request(graph, focus: focus, directions: directions, width: width, height: height))
        XCTAssertNil(state.error)
        XCTAssertFalse(state.loading)
        let result = try XCTUnwrap(state.result)
        XCTAssertTrue(result.zoom.isFinite && result.pan.x.isFinite && result.pan.y.isFinite)
        XCTAssertGreaterThan(result.zoom, 0)
        XCTAssertTrue(result.nodes.allSatisfy { $0.x.isFinite && $0.y.isFinite && $0.width > 0 && $0.height > 0 })
        return result
    }

    private func compact(_ value: String) -> String {
        value.filter { !$0.isWhitespace }
    }

    private func document(style: String = "american-sociological-association", locale: String = "en-US", template: String = "asa", customCSL: String? = nil, articleTitle: String = "Intergenerational Care across Migration", markdown: String = "Synthetic offline evidence.", includeLiterature: Bool = true, includeWarning: Bool = false) -> ResearchExportDocument {
        let formatting = ResearchDocumentFormattingContract(cslStyleId: style, customCsl: customCSL, locale: locale, templateId: template)
        let formal: [String: JSONValue] = [
            "title": .string("Native Runtime Export / 跨语言研究"),
            "sections": .array([.object(["section_id": .string("synthetic-section"), "title": .string("Findings / 发现"), "content": .string(markdown)])])
        ]
        var audit = ["article", "book"].map {
            ResearchDocumentCitationAuditContract(citationId: "citation-\($0)", kind: "scholarly", sectionId: "synthetic-section", sourceId: $0, state: "verified")
        }
        if includeWarning {
            audit.append(ResearchDocumentCitationAuditContract(citationId: "missing", kind: "empirical", sectionId: "synthetic-section", sourceId: "removed-source", state: "tombstoned"))
        }
        let manifest = ResearchDocumentExportManifest(citationAudit: audit, documentIdentity: ResearchDocumentVersionIdentityContract(documentId: "synthetic-document", revisionId: "synthetic-revision", version: 7), documentVersions: [], formalDocument: formal, formatting: formatting, schemaVersion: "everplain-document-v1")
        let exported = ResearchDocumentExportResponse(documentId: "synthetic-document", filename: "synthetic.md", knowledgeReleaseId: "synthetic-release", manifest: manifest, markdown: markdown, mediaType: "text/markdown", taskId: "synthetic-task", version: 7)
        let article: [String: JSONValue] = [
            "id": .string("article"), "type": .string("article-journal"), "title": .string(articleTitle),
            "author": .array([.object(["family": .string("Zhou"), "given": .string("Min")])]),
            "issued": .object(["date-parts": .array([.array([.integer(2024)])])]),
            "container-title": .string("Journal of Family Sociology"), "volume": .string("18"), "issue": .string("2"), "page": .string("101-122")
        ]
        let book: [String: JSONValue] = [
            "id": .string("book"), "type": .string("book"), "title": .string("流动家庭与代际照护"),
            "author": .array([.object(["family": .string("李"), "given": .string("敏")])]),
            "issued": .object(["date-parts": .array([.array([.integer(2023)])])]),
            "publisher": .string("社会科学文献出版社"), "publisher-place": .string("北京"), "language": .string("zh-CN")
        ]
        let literature = [
            LiteratureEntryResponse(attachmentMaterialIds: [], collectionIds: [], createdAt: "2026-01-01T00:00:00Z", cslData: article, itemType: "article-journal", literatureId: "article", title: articleTitle),
            LiteratureEntryResponse(attachmentMaterialIds: [], collectionIds: [], createdAt: "2026-01-01T00:00:00Z", cslData: book, itemType: "book", literatureId: "book", title: "流动家庭与代际照护")
        ]
        return ResearchExportDocument(exported: exported, literature: includeLiterature ? literature : [])
    }
}
#endif
