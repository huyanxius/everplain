#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceView: View {
    @EnvironmentObject private var app: AppStore
    var body: some View { ResearchWorkspaceContent(workspace: app.workspace).environmentObject(app) }
}
private struct ResearchWorkspaceContent: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @Environment(\.colorScheme) private var scheme
    @State private var pendingTool: ResearchWorkspaceTool?
    @State private var leave = false
    @State private var pendingMaterial: ResearchMaterialResponse?
    private var conversationKey: String { [app.workspaceTaskId ?? "new", app.conversation?.conversationId ?? "", app.conversation?.updatedAt ?? "", app.research.selectedMaterial?.materialId ?? "", app.research.selectedMaterial?.parseId ?? ""].joined(separator: ":") }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: T.space3) {
                Button { if workspace.hasUnsavedChanges { leave = true } else { app.route = .research } } label: { WebIcon(name: .arrowLeft) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel("返回研究")
                Text(workspace.navigation?.projectTitle ?? "新建研究").font(TypeStyle.ui(T.textHeading, weight: .semibold)).lineLimit(1)
                if let stage = workspace.navigation?.stageLabel { Text(stage).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                Spacer()
                Button { Task { await workspace.refresh(); if let id = app.conversation?.conversationId { await workspace.loadJourney(id) } } } label: { WebIcon(name: .arrowClockwise) }.buttonStyle(EPIconButtonStyle()).disabled(workspace.loading).accessibilityLabel("刷新研究")
            }.padding(T.space4).padding(.leading, app.splitSidebar ? 48 : 0)
            if workspace.taskId != nil {
                ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: T.space1) { ForEach(ResearchWorkspaceTool.allCases, id: \.self) { tool in
                    Button { if workspace.hasUnsavedChanges && tool != workspace.tool { pendingTool = tool } else { workspace.select(tool) } } label: { HStack(spacing: T.space2) { WebIcon(name: icon(tool)); EPText(tool.title) } }.buttonStyle(WebSegmentStyle(selected: workspace.tool == tool)).disabled(workspace.busy)
                } }.padding(.horizontal, T.space4).padding(.bottom, T.space3) }
            }
            Divider()
            HSplitView {
                VStack(spacing: 0) {
                    if let error = workspace.error { HStack { InlineMessage(text: error, isError: true); Spacer(); EPButton("重试读取") { Task { await workspace.refresh() } }.disabled(workspace.loading) }.padding(T.space3) }
                    if let notice = workspace.notice { InlineMessage(text: notice).padding(T.space3) }
                    if workspace.loading { ProgressView().controlSize(.small).padding(T.space2).accessibilityLabel("正在恢复研究") }
                    Group {
                        switch workspace.tool {
                        case .map: ResearchWorkspaceCanvas(workspace: workspace)
                        case .materials: ResearchWorkspaceMaterials(workspace: workspace)
                        case .analysis: ResearchWorkspaceAnalysis(workspace: workspace)
                        case .theory: ResearchWorkspaceTheory(workspace: workspace)
                        case .method: ResearchWorkspaceMethod(workspace: workspace)
                        case .writing: ResearchWorkspaceDocument(workspace: workspace)
                        case .archive: ResearchWorkspaceArchive(workspace: workspace)
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }.frame(minWidth: 360, idealWidth: 700, maxWidth: .infinity, maxHeight: .infinity)
                // Stable sibling: changing tools never destroys the conversation or its native composer.
                VStack(spacing: 0) {
                    HomeConversationSurface(isHome: false)
                    if let proposal = workspace.journey?.proposal, proposal.status == "pending_confirmation" {
                        VStack(alignment: .leading, spacing: T.space3) {
                            EPText("研究起点").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                            Text(proposal.phenomenon).font(TypeStyle.reading(T.textHeading))
                            Text("意图：\(proposal.researchIntent ?? "待补充")")
                            Text("情境：\(proposal.context ?? "待补充")").foregroundStyle(.secondary)
                            HStack { Button(workspace.busy ? "正在建立研究…" : "确认研究起点") { Task { await workspace.confirmStart() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy)
                                EPButton("继续修改") { app.composer = "我想继续修改研究起点："; app.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle()).disabled(workspace.busy) }
                        }.font(TypeStyle.ui(T.textControl)).padding(T.space4).background(Palette(dark: scheme == .dark).mutedSurface)
                    }
                }.frame(minWidth: 320, idealWidth: 430, maxWidth: 680, maxHeight: .infinity)
                    .overlay(alignment: .trailing) { if app.researchPanelOpen { ConversationSourcePanel().frame(maxWidth: .infinity).background(Palette(dark: scheme == .dark).surface) } }
            }
        }.font(TypeStyle.ui(T.textControl)).background(Palette(dark: scheme == .dark).surface)
            .task(id: conversationKey) { workspace.open(taskId: app.workspaceTaskId, conversation: app.conversation); consumeMaterialBridge() }
            .onChange(of: workspace.draft?.base.documentId) { _ in syncDocumentContext() }
            .onChange(of: workspace.draft?.base.version) { _ in syncDocumentContext() }
            .onChange(of: workspace.tool) { _ in syncDocumentContext() }
            .alert("保留当前修改？", isPresented: Binding(get: { pendingTool != nil || leave }, set: { if !$0 { pendingTool = nil; leave = false } })) {
                EPButton("继续编辑", role: .cancel) { pendingTool = nil; leave = false; pendingMaterial = nil; app.research.selectedMaterial = nil }
                EPButton("放弃修改并离开", role: .destructive) {
                    workspace.discardUnsavedChanges()
                    if let material = pendingMaterial { acceptMaterialBridge(material) } else if let next = pendingTool { workspace.select(next) }; pendingMaterial = nil; if leave { app.route = .research }; pendingTool = nil; leave = false
                }
            } message: { EPText("当前文稿、理论判断或方法计划尚未保存。放弃后将恢复服务器版本。") }
    }
    private func consumeMaterialBridge() {
        guard let item = app.research.selectedMaterial, let taskId = app.workspaceTaskId, workspace.taskId == taskId, item.taskId == taskId else { return }
        if workspace.hasUnsavedChanges { pendingMaterial = item; pendingTool = .materials; return }
        acceptMaterialBridge(item)
    }
    private func acceptMaterialBridge(_ item: ResearchMaterialResponse) {
        guard item.taskId == workspace.taskId, item.taskId == app.workspaceTaskId else { return }
        workspace.material = item; workspace.select(.materials); app.research.selectedMaterial = nil
    }
    private func syncDocumentContext() { app.workspaceDocumentId = workspace.tool == .writing || workspace.tool == .map ? workspace.draft?.base.documentId : nil; app.workspaceDocumentVersion = app.workspaceDocumentId == nil ? nil : workspace.draft?.base.version }
    private func icon(_ tool: ResearchWorkspaceTool) -> WebIconName { switch tool { case .map: return .mapTrifold; case .materials: return .folderOpen; case .analysis: return .chartBar; case .theory: return .scales; case .method: return .wrench; case .writing: return .fileText; case .archive: return .archiveBox } }
}

struct ResearchWorkspaceEmpty: View {
    let title: String
    let detail: String
    var body: some View { VStack(spacing: T.space3) { Text(title).font(TypeStyle.reading(T.textHeading)); Text(detail).foregroundStyle(.secondary).multilineTextAlignment(.center) }.frame(maxWidth: .infinity).padding(T.space8) }
}

struct ResearchWorkspaceArchive: View {
    @ObservedObject var workspace: ResearchWorkspaceStore
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: T.space5) {
            EPText("研究归档").font(TypeStyle.reading(T.textSection))
            EPText("导出研究项目、文稿版本、材料与可追溯的研究记录。").foregroundStyle(.secondary)
            Button(workspace.busy ? "正在准备归档…" : "导出研究归档 ZIP") { Task { await workspace.exportArchive() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy)
            Divider(); EPText("研究记录").font(TypeStyle.ui(T.textHeading))
            if workspace.audit.isEmpty && !workspace.loading { EPText("还没有研究记录。").foregroundStyle(.secondary) }
            ForEach(workspace.audit, id: \.eventId) { item in VStack(alignment: .leading, spacing: T.space2) {
                Text(item.eventType).fontWeight(.medium); Text("\(item.objectType) · \(item.objectId)\(item.objectVersion.map { " · v\($0)" } ?? "")").textSelection(.enabled)
                Text("\(item.actorType) · \(item.occurredAt)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            }; Divider() }
        }.padding(T.space6) }
    }
}
#endif
