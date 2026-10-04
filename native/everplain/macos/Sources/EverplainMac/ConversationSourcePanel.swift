#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

struct ConversationSourcePanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        VStack(alignment: .leading, spacing: T.space4) {
            HStack {
                if store.selectedCitation != nil || store.selectedToolStep != nil {
                    Button { store.selectedCitation = nil; store.selectedToolStep = nil } label: { WebIcon(name: .arrowLeft) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel("返回研究面板")
                }
                Text(store.selectedCitation != nil ? "引用来源" : store.selectedToolStep != nil ? "工具活动" : "研究面板").font(TypeStyle.ui(T.textHeading, weight: .semibold))
                Spacer()
                Button { store.selectedCitation = nil; store.selectedToolStep = nil; store.researchPanelOpen = false } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel("关闭研究面板")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: T.space5) {
                    if let citation = store.selectedCitation { citationDetail(citation) }
                    else if let step = store.selectedToolStep { toolDetail(step) }
                    else {
                        ForEach([("knowledge", "知识库"), ("web", "网页"), ("material", "用户文件")], id: \.0) { group in
                            let citations = store.panelCitations.filter { Self.group($0) == group.0 }
                            VStack(alignment: .leading, spacing: T.space3) {
                                HStack { Text(group.1).fontWeight(.semibold); Text(String(citations.count)).foregroundStyle(p.muted) }
                                if citations.isEmpty { EPText("本轮暂无来源。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
                                ForEach(citations, id: \.citationId) { citation in
                                    Button { store.selectCitation(citation) } label: {
                                        HStack(alignment: .top, spacing: T.space2) {
                                            Text(String((store.panelCitations.firstIndex(where: { $0.citationId == citation.citationId }) ?? 0) + 1)).font(TypeStyle.ui(T.textMeta)).frame(width: 24, height: 24).background(p.mutedSurface, in: Circle())
                                            VStack(alignment: .leading, spacing: T.space1) { Text(citation.label); Text(group.0 == "web" ? "网页" : group.0 == "material" ? "研究材料" : "知识库资料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
                                            Spacer()
                                        }.padding(T.space2)
                                    }.buttonStyle(WebRowStyle())
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: T.space3) {
                            HStack { EPText("工作流程").fontWeight(.semibold); Text(String(store.panelToolSteps.count)).foregroundStyle(p.muted) }
                            if store.panelToolSteps.isEmpty { EPText("实际工具步骤会出现在这里。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
                            ForEach(store.panelToolSteps) { step in
                                Button { store.selectToolStep(step) } label: {
                                    HStack { VStack(alignment: .leading, spacing: T.space1) { Text(step.label); if let detail = step.detail, detail.count <= 160 { Text(detail).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) } }; Spacer(); Text(status(step.status)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }.padding(T.space2)
                                }.buttonStyle(WebRowStyle())
                            }
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.padding(T.space5).frame(width: 360).frame(maxHeight: .infinity).background(p.surface)
            .overlay(alignment: .leading) { Rectangle().fill(p.rule).frame(width: 1) }
            .font(TypeStyle.ui(T.textControl)).onExitCommand { store.researchPanelOpen = false; store.selectedCitation = nil; store.selectedToolStep = nil }
    }
    private func citationDetail(_ citation: AgentCitationResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space4) {
            Text(citation.label).font(TypeStyle.reading(T.textTitle))
            Text(citation.deleted == true ? "这份研究材料已删除，原文不再可访问。" : citation.excerpt ?? "本轮 Agent 没有返回可展开的证据摘录。")
                .font(TypeStyle.reading(T.textBody)).textSelection(.enabled).padding(T.space4).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette(dark: scheme == .dark).mutedSurface, in: RoundedRectangle(cornerRadius: T.radiusCard))
            if let locator = locator(citation), !locator.isEmpty { Text("引用位置：\(locator)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if citation.deleted != true {
                if citation.knowledgeBaseId != nil && citation.materialId != nil || Self.group(citation) == "material" {
                    EPButton("打开资料原文") { Task { await store.openCitationSource(citation) } }.buttonStyle(EPButtonStyle())
                }
                if citation.knowledgeId != nil { EPButton("在知识图谱中查看") { Task { await store.navigate(.graph); store.knowledge.graphQuery = citation.label; store.knowledge.selectedNodeId = citation.knowledgeId } }.buttonStyle(EPButtonStyle()) }
                if citation.sourceKind == "web", let raw = citation.sourceId, let url = KnowledgeLogic.safeWebURL(raw) { EPLink("打开网页 ↗", destination: url).buttonStyle(EPButtonStyle()) }
            }
        }
    }
    private func toolDetail(_ step: NativeToolStep) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            Text(step.label).font(TypeStyle.reading(T.textTitle)); Text(status(step.status)).foregroundStyle(.secondary)
            if let detail = step.detail { Text(detail).textSelection(.enabled) }
            if let input = step.input { EPText("输入").fontWeight(.medium); Text(json(input)).font(.system(size: T.textMeta, design: .monospaced)).textSelection(.enabled) }
            if let output = step.output { EPText("结果").fontWeight(.medium); Text(json(output)).font(.system(size: T.textMeta, design: .monospaced)).textSelection(.enabled) }
        }
    }
    private func json(_ value: JSONValue) -> String { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "" }
    private func locator(_ citation: AgentCitationResponse) -> String? {
        guard let locator = citation.locator else { return nil }
        var values: [String] = []
        for (key, label) in [("page", "页"), ("paragraph", "段"), ("line_start", "行")] { if case .integer(let value) = locator[key] { values.append("第 \(value) \(label)") } }
        if case .array(let path) = locator["section_path"] { values.append(path.compactMap { if case .string(let value) = $0 { return value }; return nil }.joined(separator: " / ")) }
        return values.joined(separator: " · ")
    }
    static func group(_ citation: AgentCitationResponse) -> String {
        if citation.knowledgeBaseId != nil || ["shared_material", "personal_knowledge"].contains(citation.sourceKind ?? "") { return "knowledge" }
        if citation.sourceKind == "web" { return "web" }
        return ["material", "research_material"].contains(citation.kind) ? "material" : "knowledge"
    }
    private func status(_ value: String) -> String { ["running":"进行中", "completed":"已完成", "failed":"未完成"][value] ?? value }
}
#endif
