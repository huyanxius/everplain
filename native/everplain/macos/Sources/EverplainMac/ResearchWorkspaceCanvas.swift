#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceCanvas: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @Environment(\.colorScheme) private var scheme
    @State private var zoom = 1.0
    @State private var editing = false
    @State private var existingOpen = false
    @State private var nodeTitle = ""
    @State private var nodeSummary = ""
    private var map: AgentResearchMapResponse {
        var value = ResearchCanvasProjection.project(app.conversation, livePatches: app.pending?.canvasPatches ?? [], failedOrInterrupted: ["failed", "interrupted", "stopping", "stopped"].contains(app.pending?.status ?? ""))
        if let proposal = workspace.journey?.proposal, !value.nodes.contains(where: { $0.kind == "phenomenon" }) {
            value.nodes.append(AgentResearchMapNodeResponse(citationIds: [], id: "phenomenon:\(proposal.proposalId)", kind: "phenomenon", status: workspace.journey?.taskId == nil ? "developing" : "grounded", summary: proposal.researchIntent, title: proposal.phenomenon))
        }
        for document in workspace.documents {
            let documentNodeID = "document:\(document.documentId)"
            value.nodes.append(AgentResearchMapNodeResponse(citationIds: [], id: documentNodeID, kind: "document", status: document.status, summary: "\(document.sections.count) 个章节 · v\(document.version)", title: document.title))
            for section in document.sections {
                let sectionNodeID = "section:\(document.documentId):\(section.sectionId)"
                value.nodes.append(AgentResearchMapNodeResponse(citationIds: (section.citationRefs ?? []).map(\.citationId), id: sectionNodeID, kind: "section", status: section.status, summary: section.content, title: section.title))
                value.relations.append(AgentResearchMapRelationResponse(id: "contains:\(sectionNodeID)", label: "章节", relation: "contains", source: documentNodeID, target: sectionNodeID))
            }
        }
        return value
    }
    private var selected: AgentResearchMapNodeResponse? { map.nodes.first { $0.id == workspace.selectedNodeId } }
    var body: some View {
        VStack(spacing: 0) {
            HStack { EPText("研究地图").font(TypeStyle.ui(T.textHeading)); Spacer(); EPButton("−") { zoom = max(0.6, zoom - 0.1) }; Text("\(Int(zoom * 100))%").monospacedDigit(); EPButton("+") { zoom = min(1.6, zoom + 0.1) }; EPButton("复位") { zoom = 1; workspace.selectedNodeId = nil } }.buttonStyle(EPGhostButtonStyle()).padding(T.space4)
            if map.nodes.isEmpty {
                VStack(spacing: T.space5) {
                    Spacer(); AgentAvatar(id: app.profile?.avatarId ?? "shi", color: app.profile?.color ?? "#e55f6f", size: 96, state: .greet)
                    EPText("从一个问题开始，展开你的研究地图").font(TypeStyle.reading(T.textHeading)).multilineTextAlignment(.center)
                    EPText("直接提问，或先放入一批材料").foregroundStyle(.secondary)
                    HStack { EPButton("从材料开始研究") { app.chooseResearchStartFiles() }.buttonStyle(EPButtonStyle()); EPButton("接入已有研究") { existingOpen = true }.buttonStyle(EPGhostButtonStyle()) }
                    Spacer()
                }.padding(T.space6).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView([.horizontal, .vertical]) {
                    ZStack(alignment: .topLeading) {
                        Canvas { context, _ in
                            for edge in map.relations {
                                guard let start = map.nodes.firstIndex(where: { $0.id == edge.source }), let end = map.nodes.firstIndex(where: { $0.id == edge.target }) else { continue }
                                let a = point(start), b = point(end); var path = Path(); path.move(to: a); path.addCurve(to: b, control1: CGPoint(x: (a.x + b.x) / 2, y: a.y), control2: CGPoint(x: (a.x + b.x) / 2, y: b.y))
                                context.stroke(path, with: .color(Color.secondary.opacity(0.3)), lineWidth: 1.5)
                                if let label = edge.label { context.draw(Text(label).font(.system(size: 10)).foregroundColor(.secondary), at: CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10)) }
                            }
                        }
                        ForEach(Array(map.nodes.enumerated()), id: \.element.id) { index, node in
                            Button { workspace.selectedNodeId = node.id; nodeTitle = node.title; nodeSummary = node.summary ?? ""; editing = false } label: {
                                VStack(alignment: .leading, spacing: T.space2) {
                                    HStack { Text(kind(node.kind)).font(TypeStyle.ui(T.textMeta)); Spacer(); if node.userEdited == true { WebIcon(name: .notePencil, size: 12) } }.foregroundStyle(.secondary)
                                    Text(node.title).font(TypeStyle.ui(T.textControl, weight: .medium)).lineLimit(3).multilineTextAlignment(.leading)
                                    if let summary = node.summary, !summary.isEmpty { Text(summary).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).lineLimit(2) }
                                    Text(status(node.status)).font(TypeStyle.ui(10)).foregroundStyle(.secondary)
                                }.padding(T.space4).frame(width: 220, height: 150, alignment: .topLeading).background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(workspace.selectedNodeId == node.id ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: workspace.selectedNodeId == node.id ? 2 : 1))
                            }.buttonStyle(.plain).position(point(index))
                        }
                    }.frame(width: 840, height: CGFloat(max(1, (map.nodes.count + 2) / 3)) * 230 + 50).scaleEffect(zoom, anchor: .topLeading).frame(width: 840 * zoom, height: (CGFloat(max(1, (map.nodes.count + 2) / 3)) * 230 + 50) * zoom, alignment: .topLeading)
                }.background(Palette(dark: scheme == .dark).mutedSurface.opacity(0.55))
            }
            if let node = selected { selectedDetail(node) }
        }.sheet(isPresented: $existingOpen) { ResearchWorkspaceExistingEntry(workspace: workspace, isPresented: $existingOpen).environmentObject(app) }
    }
    private func point(_ index: Int) -> CGPoint { CGPoint(x: 140 + CGFloat(index % 3) * 280, y: 110 + CGFloat(index / 3) * 230) }
    @ViewBuilder private func selectedDetail(_ node: AgentResearchMapNodeResponse) -> some View {
        Divider()
        VStack(alignment: .leading, spacing: T.space3) {
            HStack { Text(kind(node.kind)).foregroundStyle(.secondary); Spacer(); Button { workspace.selectedNodeId = nil } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()) }
            if editing {
                TextField(epLocalized("节点标题"), text: $nodeTitle).textFieldStyle(.roundedBorder)
                TextEditor(text: $nodeSummary).frame(height: 90).disabled(workspace.busy)
                HStack { EPButton("保存节点") { guard let conversation = app.conversation else { return }; Task { if let updated = await workspace.editNode(node, conversation: conversation, title: nodeTitle, summary: nodeSummary) { app.conversation = updated; editing = false } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy || nodeTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty); EPButton("取消") { editing = false }.buttonStyle(EPGhostButtonStyle()) }
            } else {
                Text(node.title).font(TypeStyle.reading(T.textHeading)).textSelection(.enabled)
                if let summary = node.summary { Text(summary).textSelection(.enabled).lineLimit(6) }
                HStack {
                    if node.kind == "document", let document = workspace.documents.first(where: { "document:\($0.documentId)" == node.id }) { EPButton("打开文稿") { Task { await workspace.selectDocument(document); workspace.select(.writing) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.hasUnsavedChanges) }
                    if node.kind == "section", let document = workspace.documents.first(where: { document in document.sections.contains { "section:\(document.documentId):\($0.sectionId)" == node.id } }), let section = document.sections.first(where: { "section:\(document.documentId):\($0.sectionId)" == node.id }) {
                        EPButton("编辑本节") { Task { await workspace.selectDocument(document); workspace.selectedSectionId = section.sectionId; workspace.select(.writing) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.hasUnsavedChanges)
                    }
                    EPButton("继续讨论") { Task {
                        if node.kind == "section", let document = workspace.documents.first(where: { doc in doc.sections.contains { "section:\(doc.documentId):\($0.sectionId)" == node.id } }), let section = document.sections.first(where: { "section:\(document.documentId):\($0.sectionId)" == node.id }) {
                            await workspace.selectDocument(document); guard workspace.draft?.base.documentId == document.documentId else { return }; workspace.selectedSectionId = section.sectionId; app.workspaceDocumentId = document.documentId; app.workspaceDocumentVersion = document.version
                        }
                        app.composer = "围绕「\(node.title)」继续研究。\n\(node.summary ?? "")"; app.focusComposer = UUID()
                    } }.buttonStyle(EPButtonStyle())
                    if app.conversation?.researchMap.nodes.contains(where: { $0.id == node.id }) == true { EPButton("编辑节点") { editing = true }.buttonStyle(EPGhostButtonStyle()) }
                    ForEach(node.citationIds, id: \.self) { id in if let citation = app.conversation?.turns.flatMap({ $0.assistant.citations ?? [] }).first(where: { $0.citationId == id }) { Button("引用 \(id)") { app.selectCitation(citation) }.buttonStyle(EPGhostButtonStyle()) } }
                }
            }
        }.padding(T.space4)
    }
    private func kind(_ value: String) -> String { ["question":"问题", "phenomenon":"研究现象", "concept":"概念", "theory":"理论", "claim":"论点", "evidence":"依据", "gap":"缺口", "document":"文稿", "section":"章节", "next_step":"下一步"][value] ?? value }
    private func status(_ value: String) -> String { ["grounded":"已有依据", "developing":"展开中", "needs_evidence":"待补充依据", "confirmed":"已确认", "draft":"草稿"][value] ?? value }
}
#endif
