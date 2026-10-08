#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceMethod: View {
    @ObservedObject var workspace: ResearchWorkspaceStore
    @State private var newKind = "undecided"
    @State private var note = ""
    @State private var blocking = false
    @State private var action = ""
    @State private var reason = ""
    @State private var version = 0
    @State private var review: MethodPlanReviewContract?
    private let kinds = [("undecided", "暂缓决定"), ("qualitative", "质性研究"), ("quantitative", "定量研究"), ("mixed", "混合研究")]
    private var locked: Bool { workspace.busy || ["confirmed", "stale"].contains(workspace.method?.status ?? "") }
    private var requiredSections: [String] {
        switch workspace.methodDraft?.methodKind { case "qualitative": return ["design", "research_object", "sampling", "material_acquisition", "analysis", "credibility", "reflexivity", "ethics"]; case "quantitative": return ["design", "operationalization", "variables_indicators", "hypotheses", "measurement", "sampling", "analysis_plan", "conditions", "limitations", "ethics"]; case "mixed": return ["design", "rationale", "sequence", "weight", "integration", "conflict_handling", "common_conclusions", "ethics"]; default: return ["decision"] }
    }
    private var canConfirm: Bool { guard let plan = workspace.method else { return false }; return !workspace.methodIsDirty && !locked && !plan.reviews.contains { $0.blocking && $0.resolvedAt == nil } && requiredSections.allSatisfy { key in plan.sections.contains { $0.key == key && $0.source == "user" } } }
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: T.space5) {
            HStack { EPText("方法计划").font(TypeStyle.reading(T.textSection)); Spacer(); if let plan = workspace.method { Text("v\(plan.version) · \(plan.status)").foregroundStyle(.secondary) } }
            if let draft = workspace.methodDraft {
                Text(draft.researchQuestion).font(TypeStyle.reading(T.textHeading)); Text(draft.theorySummary).foregroundStyle(.secondary)
                if let reason = draft.staleReason { InlineMessage(text: reason, isError: true) }
                if workspace.methodConflict { InlineMessage(text: "方法计划已有更新。你的修改仍保留，请比较服务器版本后继续。", isError: true); DisclosureGroup("查看服务器版本") { ForEach(workspace.method?.sections ?? [], id: \.key) { Text($0.title).bold(); Text($0.content).textSelection(.enabled) } }; EPButton("放弃修改并读取最新") { action = "discard" } }
                WebSelect(label: "方法取向", selection: Binding(get: { workspace.methodDraft?.methodKind ?? "undecided" }, set: { workspace.methodDraft?.methodKind = $0 }), options: kinds.map { ($0.0, epLocalized($0.1)) }).disabled(locked)
                EPText("选择理由").fontWeight(.medium)
                TextEditor(text: Binding(get: { workspace.methodDraft?.rationale ?? "" }, set: { workspace.methodDraft?.rationale = $0 })).frame(minHeight: 90).disabled(locked)
                DisclosureGroup("研究依据与约束") {
                    ForEach(draft.materialConstraints, id: \.self) { Text("材料：\($0)") }; ForEach(draft.ethicalConstraints, id: \.self) { Text("伦理：\($0)") }
                    ForEach(draft.sharedContext, id: \.key) { context in Text(context.title).bold(); Text(context.content).textSelection(.enabled); ForEach(context.evidenceRefs, id: \.evidenceRefId) { Text("\($0.evidenceRefId) · \($0.sourceId)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).textSelection(.enabled) } }
                }
                ForEach(Array(draft.sections.enumerated()), id: \.element.key) { index, section in
                    VStack(alignment: .leading, spacing: T.space3) { Text(section.title).font(TypeStyle.reading(T.textHeading)); TextEditor(text: Binding(get: { workspace.methodDraft?.sections.indices.contains(index) == true ? workspace.methodDraft!.sections[index].content : "" }, set: { if workspace.methodDraft?.sections.indices.contains(index) == true { workspace.methodDraft?.sections[index].content = $0; workspace.methodDraft?.sections[index].source = "user" } })).frame(minHeight: 110).disabled(locked) }
                }
                HStack { EPButton("保存新版本") { Task { await workspace.saveMethod() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(locked || !workspace.methodIsDirty || workspace.methodConflict); EPButton("确认计划") { action = "confirm"; reason = "用户确认方法计划" }.buttonStyle(EPButtonStyle()).disabled(!canConfirm) }
                Divider(); EPText("审校意见").font(TypeStyle.reading(T.textHeading)); TextField(epLocalized("说明需要改进的地方"), text: $note, axis: .vertical).disabled(locked); Toggle("阻断确认", isOn: $blocking).disabled(locked)
                EPButton("提交审校") { Task { await workspace.reviewMethod(note: note, blocking: blocking); if workspace.error == nil { note = ""; blocking = false } } }.buttonStyle(EPButtonStyle()).disabled(locked || workspace.methodIsDirty || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                ForEach(draft.reviews, id: \.reviewId) { item in VStack(alignment: .leading, spacing: T.space2) { Text(item.blocking ? "阻断审校" : "建议").fontWeight(.medium); Text(item.note); if item.resolvedAt != nil { EPText("已处理").foregroundStyle(.secondary) } else { EPButton("标记已处理") { review = item; action = "resolve"; reason = "已处理审校意见" }.disabled(workspace.busy || workspace.methodIsDirty || draft.status == "stale") }; Divider() } }
                DisclosureGroup("历史版本") { ForEach(workspace.methodVersions, id: \.revisionId) { historical in DisclosureGroup("v\(historical.version) · \(historical.changeSummary)") { ForEach(historical.sections, id: \.key) { Text($0.title).bold(); Text($0.content).textSelection(.enabled) }; EPButton("恢复此版本") { version = historical.version; action = "restore"; reason = "恢复版本 \(historical.version)" }.disabled(workspace.busy || workspace.methodIsDirty || historical.version == workspace.method?.version || draft.status == "stale") } } }
            } else if !workspace.loading {
                ResearchWorkspaceEmpty(title: "建立方法计划", detail: "以已确认的研究框架和理论方案为依据，选择研究路径并审阅各项设计。")
                WebSelect(label: "方法取向", selection: $newKind, options: kinds.map { ($0.0, epLocalized($0.1)) })
                if workspace.navigation?.currentFrameworkId == nil || workspace.navigation?.currentTheoryPlanId == nil { EPText("请先确认研究框架与理论方案。").foregroundStyle(.secondary) }
                EPButton("建立方法计划") { Task { await workspace.createMethod(kind: newKind) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy || workspace.navigation?.currentFrameworkId == nil || workspace.navigation?.currentTheoryPlanId == nil)
            }
        }.padding(T.space5) }
            .alert(action == "discard" ? "放弃本地修改？" : action == "restore" ? "恢复方法计划 v\(version)？" : action == "resolve" ? "确认已处理审校意见？" : "确认方法计划？", isPresented: Binding(get: { !action.isEmpty }, set: { if !$0 { action = "" } })) {
                if action != "discard" { TextField(epLocalized("原因"), text: $reason) }; EPButton("取消", role: .cancel) { action = "" }; EPButton("确认") { let selected = action; action = ""; Task { switch selected { case "discard": workspace.discardMethodChanges(); case "restore": await workspace.restoreMethod(version, reason: reason); case "resolve": if let review { await workspace.resolveReview(review, reason: reason) }; default: await workspace.confirmMethod(reason: reason) } } }.disabled(action != "discard" && reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: { Text(action == "discard" ? "未保存的修改将被服务器内容替换。" : "本次操作会记录当前版本和你的判断原因。") }
    }
}
#endif
