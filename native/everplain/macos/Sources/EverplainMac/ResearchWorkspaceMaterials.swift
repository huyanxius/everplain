#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceMaterials: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @State private var search = ""
    @State private var annotateSegment: ResearchMaterialSegmentResponse?
    @State private var quote = ""
    @State private var note = ""
    @State private var caseLabel = ""
    @State private var kind = "descriptive"
    @State private var deleting: ResearchMaterialResponse?
    private var visible: [ResearchMaterialResponse] { workspace.materials.filter { search.isEmpty || $0.filename.localizedCaseInsensitiveContains(search) } }
    var body: some View {
        VStack(spacing: 0) {
            HStack { EPText("研究材料").font(TypeStyle.reading(T.textHeading)); Spacer(); EPButton("添加材料") { app.research.chooseFiles(taskId: workspace.taskId) }.buttonStyle(EPButtonStyle(primary: true)).disabled(app.research.uploading) }.padding(T.space4)
            if let error = app.research.materialError ?? app.research.error { InlineMessage(text: error, isError: true).padding(T.space3) }
            HSplitView {
                VStack(alignment: .leading, spacing: T.space3) {
                    TextField(epLocalized("搜索材料"), text: $search).textFieldStyle(.roundedBorder)
                    ScrollView { LazyVStack(alignment: .leading, spacing: T.space2) { ForEach(visible, id: \.materialId) { item in
                        Button { Task { await workspace.openMaterial(item) } } label: { HStack { WebIcon(name: ResearchMaterialPresentation.icon(item)); VStack(alignment: .leading) { Text(item.filename).lineLimit(2); Text(ResearchMaterialPresentation.status(item)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }; Spacer() }.padding(T.space3) }.buttonStyle(WebSegmentStyle(selected: workspace.material?.materialId == item.materialId))
                    } } }
                }.padding(T.space3).frame(minWidth: 150, idealWidth: 200, maxWidth: 260)
                if let item = workspace.material {
                    ScrollView { VStack(alignment: .leading, spacing: T.space4) {
                        HStack { Text(item.filename).font(TypeStyle.reading(T.textHeading)); Spacer(); Menu { EPButton("重新解析") { Task { await app.research.reparse(item); await workspace.refresh(); await workspace.openMaterial(item) } }; EPButton("下载原件") { Task { await workspace.downloadMaterial(item) } }; EPButton("删除文件", role: .destructive) { deleting = item } } label: { WebIcon(name: .dotsThree) } }
                        Text("\(ResearchMaterialPresentation.status(item)) · \(item.segmentCount) 个片段 · \(ByteCountFormatter.string(fromByteCount: Int64(item.sizeBytes), countStyle: .file))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        if !item.isCurrentParse { InlineMessage(text: "正在阅读引用时的历史解析版本。") }; if let issue = item.unavailableReason ?? item.errorCode { InlineMessage(text: issue, isError: true) }
                        if let segments = item.segments, !segments.isEmpty { ForEach(segments, id: \.segmentId) { segment in
                            VStack(alignment: .leading, spacing: T.space3) {
                                Text("片段 \(segment.ordinal + 1) · \(locator(segment.locator))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                Text(segment.text).font(TypeStyle.reading(T.textBody)).textSelection(.enabled)
                                HStack { EPButton("标记片段") { annotateSegment = segment; quote = segment.text; note = ""; caseLabel = ""; kind = "descriptive" }.buttonStyle(EPGhostButtonStyle()).disabled(!item.isCurrentParse || workspace.busy)
                                    EPButton("与 Agent 讨论") { app.composer = "请结合材料「\(item.filename)」的这个片段继续分析：\n\n\(segment.text)"; app.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle()) }
                                Divider()
                            }
                        } } else { Text(item.status == "failed" ? "解析失败。原件仍保留，可重试解析。" : "原文片段暂不可用，材料解析完成后可阅读与标记。").foregroundStyle(.secondary) }
                    }.padding(T.space5) }.frame(minWidth: 260, maxWidth: .infinity)
                } else { ResearchWorkspaceEmpty(title: workspace.materials.isEmpty ? "从材料开始研究" : "选择材料", detail: "导入文档、音频或视频，阅读原文并保存片段标记。").frame(minWidth: 260, maxWidth: .infinity, maxHeight: .infinity) }
            }
        }.onChange(of: app.research.uploading) { active in if !active { Task { await workspace.refresh() } } }
            .sheet(isPresented: Binding(get: { annotateSegment != nil }, set: { if !$0 { annotateSegment = nil } })) {
                VStack(alignment: .leading, spacing: T.space4) { EPText("标记原文片段").font(TypeStyle.reading(T.textSection)); EPText("保留需要标记的原文，文字必须与当前片段一致。").foregroundStyle(.secondary); TextEditor(text: $quote).frame(height: 150)
                    WebSelect(label: "类型", selection: $kind, options: [("descriptive", epLocalized("描述性标记")), ("researcher_reflection", epLocalized("研究者反思"))])
                    TextField(epLocalized("案例标签（可选）"), text: $caseLabel); TextField(epLocalized("标记说明"), text: $note)
                    if let error = workspace.error { InlineMessage(text: error, isError: true) }
                    HStack { EPButton("取消") { annotateSegment = nil }; Spacer(); EPButton("保存标记") { if let segment = annotateSegment { Task { await workspace.annotate(segment, quote: quote, note: note, kind: kind, caseLabel: caseLabel); if workspace.error == nil { annotateSegment = nil } } } }.disabled(workspace.busy || quote.isEmpty || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.padding(T.space6).frame(width: 560)
            }.alert("删除这个文件？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                EPButton("取消", role: .cancel) { deleting = nil }; EPButton("删除", role: .destructive) { if let item = deleting { Task { await app.research.removeMaterial(item); if app.research.materialError == nil { workspace.material = nil }; await workspace.refresh() } }; deleting = nil }
            } message: { Text("删除后 Agent 将不能再检索或引用「\(deleting?.filename ?? "")」。") }
    }
    private func locator(_ value: ResearchMaterialLocatorResponse) -> String { if let page = value.page { return "第 \(page) 页" }; return value.sectionPath.isEmpty ? "原文" : value.sectionPath.joined(separator: " / ") }
}
#endif
