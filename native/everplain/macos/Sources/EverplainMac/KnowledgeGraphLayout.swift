#if os(macOS)
import Foundation
import SwiftUI
import JavaScriptCore
import EverplainCore

/// Private, offline bridge data; not an HTTP or persisted account contract.
struct KnowledgeGraphRGBA: Decodable, Sendable {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double
    func color(dark: Bool) -> Color {
        if !dark { return Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
        // system-theme.css applies invert(.88) hue-rotate(180deg) saturate(.65)
        // to the light-token Cytoscape canvas, rather than resolving dark tokens twice.
        let r = 0.88 - 0.76 * red, g = 0.88 - 0.76 * green, b = 0.88 - 0.76 * blue
        func unit(_ value: Double) -> Double { min(1, max(0, value)) }
        let hR = unit(-0.574 * r + 1.430 * g + 0.144 * b)
        let hG = unit(0.426 * r + 0.430 * g + 0.144 * b)
        let hB = unit(0.426 * r + 1.430 * g - 0.856 * b)
        let grey = 0.213 * hR + 0.715 * hG + 0.072 * hB
        return Color(.sRGB, red: unit(grey * 0.35 + hR * 0.65), green: unit(grey * 0.35 + hG * 0.65), blue: unit(grey * 0.35 + hB * 0.65), opacity: alpha)
    }
}
struct KnowledgeGraphNodeAppearance: Decodable, Sendable {
    let id: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let borderWidth: Double
    let opacity: Double
    let backgroundOpacity: Double
    let textOpacity: Double
    let fontSize: Double
    let fontWeight: String
    let textMarginY: Double
    let minZoomedFontSize: Double
    let outlineWidth: Double
    let outlineOpacity: Double
    let underlayOpacity: Double
    let underlayPadding: Double
    let background: KnowledgeGraphRGBA
    let border: KnowledgeGraphRGBA
    let ink: KnowledgeGraphRGBA
    let outline: KnowledgeGraphRGBA
    let underlay: KnowledgeGraphRGBA
}
struct KnowledgeGraphEdgeAppearance: Decodable, Sendable {
    let id: String
    let label: String
    let width: Double
    let opacity: Double
    let dashed: Bool
    let color: KnowledgeGraphRGBA
    let sourceArrowColor: KnowledgeGraphRGBA
    let targetArrowColor: KnowledgeGraphRGBA
    let sourceArrow: Bool
    let targetArrow: Bool
    let arrowSize: Double
}
struct KnowledgeGraphLayoutResult: Decodable, Sendable {
    struct Pan: Decodable, Sendable { let x: Double; let y: Double }
    let algorithm: String
    let nodes: [KnowledgeGraphNodeAppearance]
    let edges: [KnowledgeGraphEdgeAppearance]
    let zoom: Double
    let pan: Pan
    var positions: [String: KnowledgePosition] { Dictionary(nodes.map { ($0.id, .init(x: $0.x, y: $0.y)) }, uniquingKeysWith: { first, _ in first }) }
}
struct KnowledgeGraphLayoutRequest: Sendable {
    let graph: NativeKnowledgeGraph
    let focusNodeId: String?
    let edgeDirections: [String: String]
    let width: Double
    let height: Double
    func encoded() throws -> String {
        let colors: [String: EverplainColor] = ["faint": T.colorFaint(dark: false), "surface": T.colorSurface(dark: false), "ink-soft": T.colorInkSoft(dark: false), "info": T.colorInfo(dark: false), "rule": T.colorRule(dark: false), "warning": T.colorWarning(dark: false), "rule-strong": T.colorRuleStrong(dark: false), "ink": T.colorInk(dark: false), "muted": T.colorMuted(dark: false), "accent-hover": T.colorAccentHover(dark: false)]
        var input: [String: Any] = ["width": max(1, width), "height": max(1, height), "personal": graph.nodes.contains { $0.kind == "self" },
            "nodes": graph.nodes.map { ["id": $0.id, "label": $0.label, "nodeType": $0.kind, "level": $0.level] as [String: Any] },
            "edges": graph.edges.map { ["id": $0.id, "source": $0.source, "target": $0.target, "relationType": $0.label, "direction": edgeDirections[$0.id] ?? "directed", "layer": $0.candidate ? "candidate" : "structure"] },
            "palette": colors.mapValues { [($0.red * 255).rounded(), ($0.green * 255).rounded(), ($0.blue * 255).rounded(), $0.alpha] }]
        if let focusNodeId { input["focusNodeId"] = focusNodeId }
        return String(decoding: try JSONSerialization.data(withJSONObject: input, options: [.sortedKeys]), as: UTF8.self)
    }
}
@MainActor final class KnowledgeGraphLayoutState: ObservableObject {
    @Published private(set) var result: KnowledgeGraphLayoutResult?
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    private var generation = UUID()
    func load(_ request: KnowledgeGraphLayoutRequest) async {
        let expected = UUID(); generation = expected; result = nil; error = nil; loading = true
        do {
            let value = try await KnowledgeGraphLayoutWorker.shared.layout(request)
            guard !Task.isCancelled, generation == expected else { return }
            result = value; loading = false
        } catch {
            guard !Task.isCancelled, generation == expected else { return }
            self.error = "原图布局暂未完成：\(error.localizedDescription)"; loading = false
        }
    }
    func clear() { generation = UUID(); result = nil; error = nil; loading = false }
}
private actor KnowledgeGraphLayoutWorker {
    static let shared = KnowledgeGraphLayoutWorker()
    // Serial actor prevents parallel CPU-heavy graph jobs; canceled queued jobs never start.
    func layout(_ request: KnowledgeGraphLayoutRequest) throws -> KnowledgeGraphLayoutResult {
        try Task.checkCancellation()
        guard let context = JSContext() else { throw LayoutFailure("无法创建本机布局环境。") }
        var exception = false
        context.exceptionHandler = { _, _ in exception = true }
        for filename in ["native-layout-bridge.js", "cytoscape-3.34.0.min.js", "web-graph-source.js"] {
            guard let url = Bundle.module.url(forResource: filename, withExtension: nil, subdirectory: "GraphLayout") else { throw LayoutFailure("缺少布局资源，请重新构建应用。") }
            let source = try String(contentsOf: url, encoding: .utf8)
            context.evaluateScript(source, withSourceURL: url)
            guard !exception else { throw LayoutFailure("布局资源无法读取。") }
        }
        try Task.checkCancellation()
        guard let function = context.objectForKeyedSubscript("__nativeGraphLayout"), !function.isUndefined,
              let encoded = function.call(withArguments: [try request.encoded()])?.toString(), !exception,
              let data = encoded.data(using: .utf8) else { throw LayoutFailure("原图算法返回异常；可以重试。") }
        let result = try JSONDecoder().decode(KnowledgeGraphLayoutResult.self, from: data)
        guard result.nodes.count == request.graph.nodes.count, result.nodes.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.width.isFinite && $0.height.isFinite }), result.zoom.isFinite, result.pan.x.isFinite, result.pan.y.isFinite else { throw LayoutFailure("布局结果不完整。") }
        try Task.checkCancellation()
        return result
    }
}
struct KnowledgeGraphAvatar: View {
    let id: String
    let color: String
    let dark: Bool
    private var avatar: some View { AgentAvatar(id: id, color: color, size: 70, playing: false) }
    var body: some View {
        Group {
            if dark {
                // Blend the original and fully inverted image additively to get invert(.88),
                // then apply the two remaining CSS filters in source order.
                ZStack { avatar.opacity(0.12).blendMode(.plusLighter); avatar.colorInvert().opacity(0.88).blendMode(.plusLighter) }
                    .compositingGroup().hueRotation(.degrees(180)).saturation(0.65)
            } else { avatar }
        }.frame(width: 70, height: 70)
    }
}
private struct LayoutFailure: LocalizedError { let reason: String; init(_ reason: String) { self.reason = reason }; var errorDescription: String? { reason } }
#endif
