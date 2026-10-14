#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceDocument: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @State private var sectionId: String?
    @State private var preview = false
    @State private var history = false
    @State private var createOpen = false
    @State private var newTitle = ""
    @State private var newContent = ""
    @State private var confirmAction = ""
    @State private var confirmVersion = 0
    @State private var confirmProposal: ResearchDocumentProposalResponse?
    @State private var reason = ""
    @State private var evidence: ResearchDocumentEvidenceRefContract?
    private var sectionIndex: Int? { workspace.draft?.sections.firstIndex { $0.sectionId == sectionId } }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                EPText("研究文稿").font(TypeStyle.reading(T.textHeading)); Spacer()
                if let draft = workspace.draft { Text("v\(draft.base.version) · \(draft.isDirty ? "未保存" : draft.base.status == "confirmed" ? "已确认" : "已保存")").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                EPButton("新建文稿") { createOpen = true }.buttonStyle(EPGhostButtonStyle()).disabled(workspace.hasUnsavedChanges || workspace.busy)
            }.padding(T.space4)
            if workspace.documents.count > 1 {
                WebSelect(label: "文稿", selection: Binding(get: { workspace.draft?.base.documentId ?? "" }, set: { id in if let doc = workspace.documents.first(where: { $0.documentId == id }) { Task { await workspace.selectDocument(doc) } } }), options: [("", epLocalized("选择文稿"))] + workspace.documents.map { ($0.documentId, $0.title) }).padding(.horizontal, T.space4).disabled(workspace.hasUnsavedChanges || workspace.busy)
            }
            if let draft = workspace.draft {
                HStack {
                    EPButton("保存") { Task { await workspace.saveDocument() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(!draft.isDirty || draft.hasConflict || workspace.busy)
                    Button(preview ? "编辑" : "预览") { preview.toggle() }.buttonStyle(EPGhostButtonStyle())
                    Button(history ? "关闭版本" : "版本历史") { history.toggle() }.buttonStyle(EPGhostButtonStyle())
                    WebActionMenu { EPButton("PDF 论文") { Task { await workspace.exportFormalDocument(.pdf) } }; EPButton("Word 文稿（DOCX）") { Task { await workspace.exportFormalDocument(.docx) } }; Divider(); EPButton("Markdown 文稿") { Task { await workspace.exportDocument(json: false) } }; EPButton("完整 JSON 成果包") { Task { await workspace.exportDocument(json: true) } } } label: { HStack { EPText("导出"); WebIcon(name: .caretDown, size: 14) }.padding(.horizontal, T.space4).frame(minHeight: T.controlHeight) }.disabled(workspace.busy || draft.isDirty)
                    EPButton("完成研究") { confirmAction = "confirm" }.buttonStyle(EPButtonStyle()).disabled(workspace.busy || draft.isDirty || workspace.completion?.ready != true || draft.base.status == "confirmed")
                }.padding(.horizontal, T.space4).padding(.bottom, T.space3)
                CitationProcessorAttribution().frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, T.space4).padding(.bottom, T.space2)
                if draft.hasConflict {
                    VStack(alignment: .leading, spacing: T.space2) { InlineMessage(text: "服务器已有 v\(draft.remote?.version ?? 0)，本地修改保留在编辑器中。保存已暂停。", isError: true)
                        DisclosureGroup("查看服务器版本") { ForEach(draft.remote?.sections ?? [], id: \.sectionId) { Text($0.title).bold(); Text($0.content).textSelection(.enabled) } }
                        EPButton("放弃本地修改，使用最新版本") { confirmAction = "discard" }.buttonStyle(EPGhostButtonStyle())
                    }.padding(T.space4)
                }
                DisclosureGroup("论文模板与引用格式") {
                    WebSelect(label: "论文模板", selection: formatBinding(\.templateId), options: [("chinese-social-science", epLocalized("中文社会科学")), ("asa", "ASA"), ("custom", epLocalized("自定义 CSS"))])
                    WebSelect(label: "引用样式", selection: formatBinding(\.cslStyleId), options: [("china-national-standard-gb-t-7714-2015-author-date", "GB/T 7714"), ("american-sociological-association", "ASA"), ("chicago-author-date", "Chicago")] + (draft.formatting.cslStyleId.hasPrefix("custom-") ? [(draft.formatting.cslStyleId, epLocalized("自定义 CSL"))] : []))
                    WebSelect(label: "引用语言", selection: formatBinding(\.locale), options: [("zh-CN", epLocalized("简体中文")), ("en-US", "English (US)")])
                    HStack { EPButton("导入 CSL") { workspace.chooseFormattingFile(css: false) }; EPButton("导入模板 CSS") { workspace.chooseFormattingFile(css: true) } }; Link("参考文献排版：citeproc-js · Frank Bennett", destination: URL(string: "https://github.com/Juris-M/citeproc-js")!).font(TypeStyle.ui(T.textMeta))
                }.padding(.horizontal, T.space4).padding(.bottom, T.space3).disabled(workspace.busy)
                if history { revisionList }
                HSplitView {
                    ScrollView { VStack(alignment: .leading, spacing: T.space2) {
                        Text(draft.base.title).font(TypeStyle.ui(T.textHeading)).padding(.bottom, T.space3)
                        ForEach(draft.sections, id: \.sectionId) { section in Button { sectionId = section.sectionId; workspace.selectedSectionId = section.sectionId } label: {
                            VStack(alignment: .leading, spacing: T.space1) { Text(section.title).lineLimit(2); Text(section.status).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(T.space3)
                        }.buttonStyle(WebSegmentStyle(selected: sectionId == section.sectionId)) }
                    }.padding(T.space3) }.frame(minWidth: 130, idealWidth: 165, maxWidth: 220)
                    VStack(alignment: .leading, spacing: T.space3) {
                        if let index = sectionIndex, index < draft.sections.count {
                            let section = draft.sections[index]
                            HStack { Text(section.title).font(TypeStyle.reading(T.textHeading)); Spacer(); EPButton("讨论本节") { workspace.selectedSectionId = section.sectionId; app.workspaceDocumentId = draft.base.documentId; app.workspaceDocumentVersion = draft.base.version; app.composer = "请围绕「\(section.title)」检查论证与依据，提出可确认的局部修订建议。\n\n\(section.content)"; app.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle()) }
                            if preview { ScrollView { NativeMarkdown(content: section.content).frame(maxWidth: .infinity, alignment: .leading) } }
                            else { TextEditor(text: sectionContent(index)).font(TypeStyle.reading(T.textBody)).disabled(workspace.busy).accessibilityLabel("编辑章节 \(section.title)") }
                            WebSelect(label: "章节状态", selection: sectionStatus(index), options: [("draft", "草稿"), ("reviewed", "已审阅"), ("evidence_gap", "依据缺口"), ("needs_user_decision", "待我决定"), ("confirmed", "已确认")]).disabled(workspace.busy)
                            if !(section.evidenceRefs ?? []).isEmpty || !(section.citationRefs ?? []).isEmpty {
                                DisclosureGroup("本节依据与引用") {
                                    ForEach(section.evidenceRefs ?? [], id: \.evidenceRefId) { ref in HStack { Text("\(ref.evidenceRefId) · \(ref.sourceId)").font(TypeStyle.ui(T.textMeta)).textSelection(.enabled); if ref.materialId != nil { EPButton("阅读依据") { evidence = ref }.buttonStyle(EPGhostButtonStyle()) } } }
                                    ForEach(section.citationRefs ?? [], id: \.citationId) { ref in Text("\(ref.citationId) · \(ref.sourceId) · \(ref.state)").font(TypeStyle.ui(T.textMeta)).textSelection(.enabled) }
                                }
                            }
                        } else { ResearchWorkspaceEmpty(title: "选择章节", detail: "选择左侧章节开始编辑，原有依据与引用会随版本保留。") }
                    }.padding(T.space4).frame(minWidth: 240, maxWidth: .infinity, maxHeight: .infinity)
                }
                if let gate = workspace.completion, !gate.ready { DisclosureGroup("完成前待处理（\(gate.blockers.count)）") { ForEach(gate.checks, id: \.code) { check in HStack { WebIcon(name: check.passed ? .checkCircle : .x); Text(check.label); Text(check.detail).foregroundStyle(.secondary) } }; ForEach(gate.blockers, id: \.self) { Text($0) } }.padding(T.space4) }
            } else if !workspace.loading {
                ResearchWorkspaceEmpty(title: "从研究问题形成文稿", detail: "与右侧 Agent 讨论研究框架，生成的建议会先等待你审阅。也可以创建文稿直接写作。")
            }
            if !workspace.proposals.filter({ $0.status == "pending" }).isEmpty { proposalList }
        }.onChange(of: workspace.draft?.base.documentId) { _ in sectionId = workspace.draft?.sections.first(where: { $0.sectionId == workspace.selectedSectionId })?.sectionId ?? workspace.draft?.sections.first?.sectionId }
            .onAppear { if sectionId == nil { sectionId = workspace.draft?.sections.first(where: { $0.sectionId == workspace.selectedSectionId })?.sectionId ?? workspace.draft?.sections.first?.sectionId } }
            .sheet(isPresented: Binding(get: { evidence != nil }, set: { if !$0 { evidence = nil } })) { if let evidence { ResearchWorkspaceEvidenceSheet(workspace: workspace, reference: evidence) } }
            .sheet(isPresented: $createOpen) {
                VStack(alignment: .leading, spacing: T.space4) { EPText("新建研究文稿").font(TypeStyle.reading(T.textSection)); TextField(epLocalized("标题"), text: $newTitle); TextEditor(text: $newContent).frame(minHeight: 180); HStack { EPButton("取消") { createOpen = false }; Spacer(); EPButton("创建文稿") { Task { await workspace.createDocument(title: newTitle, content: newContent); if workspace.error == nil { createOpen = false; newTitle = ""; newContent = "" } } }.disabled(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || workspace.busy) } }.padding(T.space6).frame(width: 520)
            }
            .alert(confirmTitle, isPresented: Binding(get: { !confirmAction.isEmpty }, set: { if !$0 { confirmAction = "" } })) {
                if ["restore", "reject"].contains(confirmAction) { TextField(epLocalized("原因"), text: $reason) }
                EPButton("取消", role: .cancel) { confirmAction = "" }
                EPButton("确认") { let action = confirmAction; confirmAction = ""; Task {
                    switch action { case "discard": workspace.discardDocumentChanges(); case "confirm": await workspace.confirmDocument(); case "restore": await workspace.restoreDocument(version: confirmVersion, reason: reason); case "accept": if let proposal = confirmProposal { await workspace.accept(proposal) }; case "reject": if let proposal = confirmProposal { await workspace.reject(proposal, reason: reason) }; default: break }
                } }.disabled(["restore", "reject"].contains(confirmAction) && reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: { Text(confirmMessage) }
    }
    private var revisionList: some View { ScrollView { VStack(alignment: .leading, spacing: T.space3) { ForEach(workspace.versions, id: \.revisionId) { version in
        DisclosureGroup("v\(version.version) · \(version.changeSummary) · \(version.createdAt.prefix(16))") { ForEach(version.sections, id: \.sectionId) { Text($0.title).bold(); Text($0.content).textSelection(.enabled) }; EPButton("恢复此版本") { confirmVersion = version.version; reason = ""; confirmAction = "restore" }.disabled(workspace.busy || workspace.draft?.isDirty == true || version.version == workspace.draft?.base.version) }
    } }.padding(T.space4) }.frame(maxHeight: 240) }
    private var proposalList: some View { ScrollView { VStack(alignment: .leading, spacing: T.space4) { EPText("待审阅的 Agent 建议").font(TypeStyle.ui(T.textHeading)); ForEach(workspace.proposals.filter { $0.status == "pending" }, id: \.proposalId) { proposal in
        DisclosureGroup(proposal.title) { Text(proposal.rationale).foregroundStyle(.secondary); ForEach(proposal.proposedSections, id: \.sectionId) { section in Text(section.title).bold(); if let previous = workspace.draft?.base.sections.first(where: { $0.sectionId == section.sectionId }) { DisclosureGroup("当前内容") { Text(previous.content).textSelection(.enabled) } }; NativeMarkdown(content: section.content) }
            HStack { EPButton("接受建议") { confirmProposal = proposal; confirmAction = "accept" }.disabled(workspace.busy || workspace.draft?.isDirty == true || (proposal.kind != "create" && proposal.baseDocumentVersion != workspace.draft?.base.version)); EPButton("拒绝建议") { confirmProposal = proposal; reason = ""; confirmAction = "reject" }.disabled(workspace.busy) }
        }
    } }.padding(T.space4) }.frame(maxHeight: 280) }
    private func formatBinding(_ key: WritableKeyPath<ResearchDocumentFormattingContract, String>) -> Binding<String> { Binding(get: { workspace.draft?.formatting[keyPath: key] ?? "" }, set: { workspace.draft?.formatting[keyPath: key] = $0 }) }
    private func sectionContent(_ index: Int) -> Binding<String> { Binding(get: { workspace.draft?.sections[safeResearch: index]?.content ?? "" }, set: { if workspace.draft?.sections.indices.contains(index) == true { workspace.draft?.sections[index].content = $0 } }) }
    private func sectionStatus(_ index: Int) -> Binding<String> { Binding(get: { workspace.draft?.sections[safeResearch: index]?.status ?? "draft" }, set: { if workspace.draft?.sections.indices.contains(index) == true { workspace.draft?.sections[index].status = $0 } }) }
    private var confirmTitle: String { ["confirm":"确认完成研究？", "restore":"恢复 v\(confirmVersion)？", "discard":"放弃本地修改？", "accept":"接受这项文稿建议？", "reject":"拒绝这项文稿建议？"][confirmAction] ?? "确认" }
    private var confirmMessage: String { switch confirmAction { case "restore": return "恢复会创建新版本，现有历史仍保留。"; case "discard": return "未保存的本地修改将被服务器最新内容替换。"; case "accept": return "建议中的内容将写入文稿并创建新版本。"; case "confirm": return "系统将再次检查完成条件，并确认当前文稿版本。"; default: return "请留下判断原因，记录会保存在研究历史中。" } }
}
private extension Array { subscript(safeResearch index: Int) -> Element? { indices.contains(index) ? self[index] : nil } }
#endif
