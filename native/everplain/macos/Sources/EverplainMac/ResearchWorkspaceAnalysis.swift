#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceAnalysis: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @State private var section = "memos"
    @State private var editor = ""
    @State private var title = ""
    @State private var content = ""
    @State private var kind = "analytic"
    @State private var selectedAnnotations = Set<String>()
    @State private var cases = ""
    @State private var question = ""
    @State private var implication = ""
    @State private var findingKind = "support"
    @State private var reason = ""
    @State private var decision = "confirmed"
    @State private var decidingMemo: AnalysisMemoResponse?
    @State private var decidingComparison: CaseComparisonResponse?
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: T.space4) {
            HStack { EPText("研究分析").font(TypeStyle.reading(T.textSection)); Spacer(); EPButton("新建备忘") { resetEditor("memo") }.buttonStyle(EPButtonStyle()); EPButton("比较案例") { resetEditor("comparison") }.buttonStyle(EPButtonStyle()) }
            WebSegments(label: "分析视图", selection: $section, options: [("memos", "备忘"), ("annotations", "片段标记"), ("comparisons", "案例比较"), ("cycle", "研究循环")])
            if let analysis = workspace.analysis {
                if section == "annotations" { if analysis.annotations.isEmpty { empty("还没有片段标记", "打开材料并选择原文，记录观察或研究者反思。") }; ForEach(analysis.annotations, id: \.annotationId) { item in annotation(item) } }
                if section == "memos" { if analysis.memos.isEmpty { empty("还没有分析备忘", "关联材料片段，写下描述、反思、分析或方法判断。") }; ForEach(analysis.memos, id: \.memoId) { memo in
                    VStack(alignment: .leading, spacing: T.space3) { HStack { Text(memo.title).font(TypeStyle.reading(T.textHeading)); Spacer(); Text(recordStatus(memo.status)).foregroundStyle(.secondary) }; Text(memo.memoKind).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); NativeMarkdown(content: memo.content)
                        if !memo.annotationIds.isEmpty { DisclosureGroup("依据片段（\(memo.annotationIds.count)）") { ForEach(analysis.annotations.filter { memo.annotationIds.contains($0.annotationId) }, id: \.annotationId) { annotation($0) } } }
                        if memo.status == "candidate" { HStack { EPButton("确认备忘") { decidingMemo = memo; decision = "confirmed"; reason = "" }; EPButton("拒绝") { decidingMemo = memo; decision = "rejected"; reason = "" } }.buttonStyle(EPButtonStyle()).disabled(workspace.busy) }
                        if let reason = memo.decisionReason { Text("判断原因：\(reason)").foregroundStyle(.secondary) }; Divider()
                    }
                } }
                if section == "comparisons" { if analysis.comparisons.isEmpty { empty("还没有案例比较", "比较不同案例的支持、反例、竞争解释与依据缺口。") }; ForEach(analysis.comparisons, id: \.comparisonId) { comparison in
                    VStack(alignment: .leading, spacing: T.space3) { HStack { Text(comparison.title).font(TypeStyle.reading(T.textHeading)); Spacer(); Text(recordStatus(comparison.status)).foregroundStyle(.secondary) }; Text(comparison.question); Text(comparison.caseLabels.joined(separator: " · ")).foregroundStyle(.secondary)
                        ForEach(Array(comparison.findings.enumerated()), id: \.offset) { _, finding in Text("\(finding.kind)：\(finding.statement)").textSelection(.enabled) }
                        Text("理论含义：\(comparison.theoryImplication)"); ForEach(comparison.evidenceGaps, id: \.self) { Text("依据缺口：\($0)").foregroundStyle(.secondary) }
                        if comparison.status == "candidate" { HStack { EPButton("确认比较") { decidingComparison = comparison; decision = "confirmed"; reason = "" }; EPButton("拒绝") { decidingComparison = comparison; decision = "rejected"; reason = "" } }.buttonStyle(EPButtonStyle()).disabled(workspace.busy) }; Divider()
                    }
                } }
                if section == "cycle", let cycle = workspace.cycle { Text("研究循环 v\(cycle.version)").font(TypeStyle.ui(T.textHeading)); if cycle.gaps.isEmpty { EPText("当前没有待处理的依据缺口。").foregroundStyle(.secondary) }; ForEach(cycle.gaps, id: \.gapId) { gap in VStack(alignment: .leading, spacing: T.space3) { Text(gap.description).fontWeight(.medium); Text(gap.suggestedAction).foregroundStyle(.secondary); EPButton("讨论下一步") { app.composer = "请围绕这个研究缺口帮助我安排下一步：\n\(gap.description)\n\(gap.suggestedAction)"; app.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle()); Divider() } } }
            }
        }.padding(T.space5) }
            .sheet(isPresented: Binding(get: { !editor.isEmpty }, set: { if !$0 { editor = "" } })) { creationSheet }
            .alert(decision == "confirmed" ? "确认这项分析记录？" : "拒绝这项分析记录？", isPresented: Binding(get: { decidingMemo != nil || decidingComparison != nil }, set: { if !$0 { decidingMemo = nil; decidingComparison = nil } })) {
                TextField(epLocalized("判断原因"), text: $reason); EPButton("取消", role: .cancel) { decidingMemo = nil; decidingComparison = nil }; EPButton("保存判断") { let memo = decidingMemo, comparison = decidingComparison; decidingMemo = nil; decidingComparison = nil; Task { if let memo { await workspace.decideMemo(memo, decision: decision, reason: reason) }; if let comparison { await workspace.decideComparison(comparison, decision: decision, reason: reason) } } }.disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: { EPText("记录将附带你的判断原因和当前版本。") }
    }
    private func resetEditor(_ next: String) { editor = next; title = ""; content = ""; selectedAnnotations = []; cases = ""; question = ""; implication = "" }
    private var creationSheet: some View { ScrollView { VStack(alignment: .leading, spacing: T.space4) {
        Text(editor == "memo" ? "新建分析备忘" : "新建案例比较").font(TypeStyle.reading(T.textSection)); TextField(epLocalized("标题"), text: $title)
        if editor == "memo" { WebSelect(label: "备忘类型", selection: $kind, options: [("descriptive", epLocalized("描述")), ("reflexive", epLocalized("反思")), ("analytic", epLocalized("分析")), ("methodological", epLocalized("方法"))]) }
        else { TextField(epLocalized("案例标签，用换行分隔"), text: $cases, axis: .vertical); TextField(epLocalized("比较问题"), text: $question); WebSelect(label: "发现类型", selection: $findingKind, options: [("support", epLocalized("支持")), ("counterexample", epLocalized("反例")), ("contradict", epLocalized("矛盾")), ("competing_explanation", epLocalized("竞争解释")), ("evidence_gap", epLocalized("依据缺口"))]) }
        TextEditor(text: $content).frame(height: 180).accessibilityLabel(editor == "memo" ? "备忘内容" : "比较发现")
        if editor == "comparison" { TextField(epLocalized("理论含义"), text: $implication, axis: .vertical) }
        DisclosureGroup("关联原文标记") { ForEach(workspace.analysis?.annotations ?? [], id: \.annotationId) { item in Toggle(isOn: Binding(get: { selectedAnnotations.contains(item.annotationId) }, set: { if $0 { selectedAnnotations.insert(item.annotationId) } else { selectedAnnotations.remove(item.annotationId) } })) { Text(item.note).lineLimit(3) }.disabled(!item.sourceAvailable) } }
        if let error = workspace.error { InlineMessage(text: error, isError: true) }
        HStack { EPButton("取消") { editor = "" }; Spacer(); EPButton("保存") { Task { if editor == "memo" { await workspace.createMemo(title: title, content: content, kind: kind, annotationIds: selectedAnnotations.sorted()) } else { await workspace.createComparison(CreateCaseComparisonRequest(caseLabels: cases.split(separator: "\n").map(String.init), findings: [ComparisonFindingContract(annotationIds: selectedAnnotations.sorted(), kind: findingKind, statement: content)], question: question, theoryImplication: implication, title: title)) }; if workspace.error == nil { editor = "" } } }.disabled(workspace.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (editor == "comparison" && (question.isEmpty || cases.isEmpty || implication.isEmpty))) }
    }.padding(T.space6) }.frame(width: 560, height: 620) }
    private func annotation(_ item: AnalysisAnnotationResponse) -> some View { VStack(alignment: .leading, spacing: T.space2) { if let quote = item.quote { Text(quote).font(TypeStyle.reading(T.textBody)).textSelection(.enabled) }; Text(item.note); if let reflection = item.reflection { Text(reflection).foregroundStyle(.secondary) }; Text("\(item.caseLabel ?? "未标注案例") · \(item.annotationKind)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); if !item.sourceAvailable { InlineMessage(text: item.unavailableReason ?? "原文已不可用", isError: true) }; Divider() } }
    private func empty(_ title: String, _ detail: String) -> some View { ResearchWorkspaceEmpty(title: title, detail: detail) }
    private func recordStatus(_ value: String) -> String { ["candidate":"待判断", "confirmed":"已确认", "rejected":"已拒绝"][value] ?? value }
}
#endif
