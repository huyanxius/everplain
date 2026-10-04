import Foundation

/// Native presentation adapters. HTTP payloads always use the generated contracts.
public struct KnowledgeMaterial: Identifiable, Equatable, Sendable {
    public let library: SharedKnowledgeResponse
    public let document: SharedDocumentResponse
    public var id: String { library.id + ":" + document.id }
    public init(library: SharedKnowledgeResponse, document: SharedDocumentResponse) {
        self.library = library; self.document = document
    }
}

public struct KnowledgeEvidence: Identifiable, Equatable, Sendable {
    public let id: String
    public let libraryId: String
    public let documentId: String
    public let filename: String
    public let summary: String
    public let segmentIds: [String]
}
public struct KnowledgePoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let libraryId: String
    public let title: String
    public var evidence: [KnowledgeEvidence]
}
public struct NativeKnowledgeNode: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let kind: String
    public let level: Int
}
public struct NativeKnowledgeEdge: Identifiable, Equatable, Sendable {
    public let id: String
    public let source: String
    public let target: String
    public let label: String
    public let candidate: Bool
    public let evidence: KnowledgeEvidence?
}
public struct NativeKnowledgeGraph: Equatable, Sendable {
    public var nodes: [NativeKnowledgeNode]
    public var edges: [NativeKnowledgeEdge]
    public var points: [KnowledgePoint]
    public init(nodes: [NativeKnowledgeNode] = [], edges: [NativeKnowledgeEdge] = [], points: [KnowledgePoint] = []) {
        self.nodes = nodes; self.edges = edges; self.points = points
    }
}
public struct KnowledgePosition: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public enum KnowledgeLogic {
    public static func kind(_ document: SharedDocumentResponse) -> String {
        let suffix = (document.filename as NSString).pathExtension.lowercased()
        if suffix == "pdf" || document.mediaType == "application/pdf" { return "PDF" }
        if suffix == "docx" { return "Word" }
        if suffix == "pptx" { return "演示文稿" }
        if document.mediaType.hasPrefix("image/") { return "图片" }
        if ["html", "htm"].contains(suffix) { return "网页" }
        return "笔记"
    }
    public static func processing(_ document: SharedDocumentResponse) -> Bool {
        document.status == "processing" || (document.status == "ready" && [document.knowledgeStatus ?? "queued", document.indexStatus ?? "queued"].contains(where: { ["queued", "running"].contains($0) }))
    }
    public static func status(_ document: SharedDocumentResponse) -> String {
        if document.status == "processing" { return "正在解析，完成后即可阅读原文" }
        if document.status == "failed" { return "解析失败" }
        let knowledge = ["queued": "等待知识整理", "running": "知识整理中", "failed": "知识整理失败"]
        let index = ["queued": "等待语义索引", "running": "建立语义索引中", "failed": "语义索引失败"]
        return [knowledge[document.knowledgeStatus ?? "queued"], index[document.indexStatus ?? "queued"]].compactMap { $0 }.joined(separator: " · ")
    }
    public static func materials(_ libraries: [SharedKnowledgeResponse], selectedId: String?, query: String = "", kind: String = "") -> [KnowledgeMaterial] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return libraries.filter { selectedId == nil ? $0.viewerAccess == "owner" : $0.id == selectedId && ["owner", "reader"].contains($0.viewerAccess) }.flatMap { library in
            (library.documents ?? []).compactMap { document in
                if !kind.isEmpty && self.kind(document) != kind { return nil }
                let text = [document.filename, document.knowledge?.summary ?? "", document.knowledge?.topics.map { $0.title + " " + $0.summary }.joined(separator: " ") ?? "", library.name ?? ""].joined(separator: " ").lowercased()
                guard needle.isEmpty || text.contains(needle) else { return nil }
                return KnowledgeMaterial(library: library, document: document)
            }
        }
    }
    public static func points(_ library: SharedKnowledgeResponse, query: String = "") -> [KnowledgePoint] {
        var results: [KnowledgePoint] = []
        for document in library.documents ?? [] where document.status == "ready" && document.knowledgeStatus == "ready" {
            for (index, topic) in (document.knowledge?.topics ?? []).enumerated() {
                let key = topic.title.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
                let evidence = KnowledgeEvidence(id: document.id + ":" + String(index), libraryId: library.id, documentId: document.id, filename: document.filename, summary: topic.summary, segmentIds: topic.segmentIds)
                if let index = results.firstIndex(where: { $0.id == key }) { results[index].evidence.append(evidence) }
                else { results.append(KnowledgePoint(id: key, libraryId: library.id, title: topic.title, evidence: [evidence])) }
            }
        }
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return results.filter { search.isEmpty || ($0.title + " " + $0.evidence.map { $0.summary + " " + $0.filename }.joined(separator: " ")).lowercased().contains(search) }
    }
    public static func graph(_ response: PersonalGraphResponse) -> NativeKnowledgeGraph {
        let nodes = response.nodes.map { NativeKnowledgeNode(id: $0.id, label: $0.label, kind: $0.nodeType, level: $0.level) }
        let ids = Set(nodes.map(\.id))
        return NativeKnowledgeGraph(nodes: nodes, edges: response.edges.filter { ids.contains($0.source) && ids.contains($0.target) }.map { NativeKnowledgeEdge(id: $0.id, source: $0.source, target: $0.target, label: $0.relationType, candidate: false, evidence: nil) })
    }
    public static func graph(_ library: SharedKnowledgeResponse) -> NativeKnowledgeGraph {
        let root = "course:" + library.id
        var graph = NativeKnowledgeGraph(nodes: [NativeKnowledgeNode(id: root, label: library.name ?? "知识库", kind: "dimension", level: 0)], points: points(library))
        for document in library.documents ?? [] where document.knowledgeStatus == "ready" {
            guard let knowledge = document.knowledge else { continue }
            let node = "document:" + document.id
            graph.nodes.append(NativeKnowledgeNode(id: node, label: document.filename, kind: "category", level: 1))
            graph.edges.append(NativeKnowledgeEdge(id: "contains:" + document.id, source: root, target: node, label: "资料", candidate: false, evidence: nil))
            for (index, topic) in knowledge.topics.enumerated() {
                let key = "topic:" + topic.title.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
                graph.edges.append(NativeKnowledgeEdge(id: node + ":" + key + ":" + String(index), source: node, target: key, label: "涉及", candidate: false, evidence: nil))
            }
            for (index, relation) in (knowledge.relations ?? []).enumerated() {
                graph.edges.append(NativeKnowledgeEdge(id: "relation:" + document.id + ":" + String(index), source: "topic:" + relation.source.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines), target: "topic:" + relation.target.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines), label: relation.label, candidate: true, evidence: KnowledgeEvidence(id: document.id + ":r:" + String(index), libraryId: library.id, documentId: document.id, filename: document.filename, summary: relation.label, segmentIds: relation.segmentIds)))
            }
        }
        graph.nodes += graph.points.map { NativeKnowledgeNode(id: "topic:" + $0.id, label: $0.title, kind: "entry", level: 2) }
        let ids = Set(graph.nodes.map(\.id))
        graph.edges = graph.edges.filter { ids.contains($0.source) && ids.contains($0.target) }
        return graph
    }
    public static func neighbors(_ id: String, in graph: NativeKnowledgeGraph) -> Set<String> {
        Set(graph.edges.flatMap { $0.source == id ? [$0.target] : $0.target == id ? [$0.source] : [] })
    }
    public static func safeWebURL(_ raw: String?) -> URL? {
        guard let raw, !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let components = URLComponents(string: raw), ["https", "http"].contains(components.scheme?.lowercased() ?? ""),
              let host = components.host, !host.isEmpty, components.user == nil, components.password == nil else { return nil }
        return components.url
    }
    public static func locator(_ segment: SharedSourceSegmentResponse) -> String {
        let value = segment.locator
        var parts = value.sectionPath
        if let page = value.page { parts.append("第 \(page) 页") }
        if let paragraph = value.paragraph { parts.append("第 \(paragraph) 段") }
        if let line = value.lineStart { parts.append(value.lineEnd.map { "第 \(line)–\($0) 行" } ?? "第 \(line) 行") }
        return parts.isEmpty ? "第 \(segment.ordinal + 1) 段" : parts.joined(separator: " · ")
    }
    public static func validateKnowledge(_ input: UpdateDocumentKnowledgeRequest, segments: Set<String>) -> String? {
        if input.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || input.summary.count > 16000 { return "请填写资料摘要（最多 16000 字）。" }
        if input.topics.isEmpty { return "请至少保留一个知识点。" }
        for topic in input.topics {
            if topic.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || topic.title.count > 100 || topic.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || topic.summary.count > 4000 { return "请填写知识点名称（最多 100 字）与说明（最多 4000 字）。" }
            if topic.segmentIds.isEmpty || !Set(topic.segmentIds).isSubset(of: segments) { return "每个知识点都需要有效的原文依据。" }
        }
        let titles = Set(input.topics.map(\.title))
        for relation in input.relations ?? [] {
            if !titles.contains(relation.source) || !titles.contains(relation.target) || relation.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || relation.label.count > 100 { return "请为关系选择知识点并填写关系说明（最多 100 字）。" }
            if relation.segmentIds.isEmpty || !Set(relation.segmentIds).isSubset(of: segments) { return "每个关系都需要有效的原文依据。" }
        }
        return nil
    }
    /// Personal graphs use level-based concentric rings, as in the Web. Library graphs use a native force layout.
    public static func layout(_ graph: NativeKnowledgeGraph, seed: Int = 0) -> [String: KnowledgePosition] {
        let nodes = graph.nodes
        guard !nodes.isEmpty else { return [:] }
        if nodes.contains(where: { $0.kind == "self" }) {
            let groups = Dictionary(grouping: nodes.filter { $0.kind != "self" }, by: { max(1, $0.level) })
            let step = groups.map { level, group in max(120.0, Double(group.count) * 50 / (2 * .pi * Double(level))) }.max() ?? 120
            var result: [String: KnowledgePosition] = [:]
            for node in nodes where node.kind == "self" { result[node.id] = KnowledgePosition(x: 0, y: 0) }
            for (level, group) in groups {
                for (index, node) in group.enumerated() {
                    let angle = -Double.pi / 2 + Double(index) * 2 * .pi / Double(group.count) + Double(seed) * 0.13
                    result[node.id] = KnowledgePosition(x: cos(angle) * step * Double(level), y: sin(angle) * step * Double(level))
                }
            }
            return result
        }
        var positions: [KnowledgePosition] = nodes.enumerated().map { index, node in
            if node.id == "self" || node.kind == "dimension" { return KnowledgePosition(x: 0, y: 0) }
            let angle = Double(index) * 2.399963229728653 + Double(seed) * 0.63
            let radius = 100 + sqrt(Double(index + 1)) * 32 + Double(max(0, node.level)) * 24
            return KnowledgePosition(x: cos(angle) * radius, y: sin(angle) * radius)
        }
        let indices = Dictionary(nodes.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        let pairs = graph.edges.compactMap { edge -> (Int, Int)? in
            guard let a = indices[edge.source], let b = indices[edge.target], a != b else { return nil }; return (a, b)
        }
        // Bounded computation keeps large imported libraries responsive.
        for _ in 0..<(nodes.count > 600 ? 16 : 70) {
            var delta = Array(repeating: KnowledgePosition(x: 0, y: 0), count: nodes.count)
            let strideLength = max(1, nodes.count / 600)
            for i in positions.indices {
                for j in stride(from: i + 1, to: positions.count, by: strideLength) {
                    let dx = positions[i].x - positions[j].x, dy = positions[i].y - positions[j].y
                    let distance = max(30, hypot(dx, dy)), force = 1800 / (distance * distance)
                    delta[i].x += dx * force; delta[i].y += dy * force
                    delta[j].x -= dx * force; delta[j].y -= dy * force
                }
            }
            for (a, b) in pairs {
                let dx = positions[b].x - positions[a].x, dy = positions[b].y - positions[a].y
                let distance = max(1, hypot(dx, dy)), force = (distance - 110) * 0.012 / distance
                delta[a].x += dx * force; delta[a].y += dy * force
                delta[b].x -= dx * force; delta[b].y -= dy * force
            }
            for index in positions.indices {
                if nodes[index].id == "self" || nodes[index].kind == "dimension" { continue }
                positions[index].x += max(-12, min(12, delta[index].x)) - positions[index].x * 0.002
                positions[index].y += max(-12, min(12, delta[index].y)) - positions[index].y * 0.002
            }
        }
        return Dictionary(zip(nodes.map(\.id), positions), uniquingKeysWith: { first, _ in first })
    }
}

public enum KnowledgeImportSource: String, CaseIterable, Identifiable, Sendable {
    case extensionGuide = "extension", file, image, chrome, obsidian, appleNotes = "apple_notes", enex, notion, flomo, keep, bilibili, records
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .extensionGuide: return "浏览器扩展"
        case .file: return "文件"
        case .image: return "图片与截图"
        case .chrome: return "浏览器收藏"
        case .obsidian: return "Obsidian / Markdown"
        case .appleNotes: return "Apple 备忘录"
        case .enex: return "印象笔记"
        case .notion: return "Notion"
        case .flomo: return "flomo"
        case .keep: return "Google Keep"
        case .bilibili: return "B 站公开收藏"
        case .records: return "导入记录"
        }
    }
    public var extensions: [String] {
        switch self {
        case .file: return ["pdf", "docx", "pptx", "md", "markdown", "txt"]
        case .image: return ["png", "jpg", "jpeg", "webp", "gif"]
        case .chrome, .flomo: return ["html", "htm"]
        case .obsidian: return ["md", "markdown", "txt", "zip"]
        case .appleNotes: return ["md", "markdown", "txt", "zip"]
        case .enex: return ["enex"]
        case .notion: return ["zip", "html", "htm", "md"]
        case .keep: return ["zip", "json", "html"]
        default: return []
        }
    }
    public var formats: String {
        switch self {
        case .file: return "PDF、Word、PPT、Markdown、TXT"
        case .image: return "PNG、JPG、WebP、GIF"
        case .chrome: return "书签 HTML"
        case .obsidian: return "Markdown、TXT、文件夹或 ZIP"
        case .appleNotes: return "Markdown、TXT 或 ZIP"
        case .enex: return "ENEX"
        case .notion: return "HTML 或 Markdown 导出包"
        case .flomo: return "HTML"
        case .keep: return "Google Takeout ZIP、JSON 或 HTML"
        case .bilibili: return "公开账户 UID"
        default: return title
        }
    }
    public func accepts(filename: String) -> Bool { extensions.contains((filename as NSString).pathExtension.lowercased()) }
    public static func validPublicUID(_ value: String) -> Bool { !value.isEmpty && value.count <= 20 && value.utf8.allSatisfy { (48...57).contains($0) } }
}
