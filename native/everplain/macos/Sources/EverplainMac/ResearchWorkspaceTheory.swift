#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceTheory: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @State private var action = ""
    private var canSubmit: Bool { guard let draft = workspace.theoryDraft, let run = workspace.match else { return false }; return !workspace.busy && !workspace.theoryIsDirty && !workspace.theoryDraftConflict && draft.isComplete(candidates: workspace.theoryCandidates) && (run.completionBasis == "complete" || run.partialCompletionAcknowledged) }
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: T.space5) {
            HStack { EPText("理论判断").font(TypeStyle.reading(T.textSection)); Spacer(); if let plan = workspace.theoryPlan { Text("已确认方案 v\(plan.version)").foregroundStyle(.secondary) } }
            if let run = workspace.match {
                Text("\(run.status) · \(run.completedCandidateCount)/\(run.totalCandidateCount) 个候选 · 知识版本 \(run.knowledgeReleaseId)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                if workspace.theoryDraftConflict { InlineMessage(text: "理论判断已有其他版本，当前修改已保留。请读取最新草稿后重新核对。", isError: true); EPButton("放弃本地修改，读取最新草稿") { action = "discard" }.buttonStyle(EPButtonStyle()) }
                if run.completionBasis != "complete" {
                    InlineMessage(text: run.partialCompletionAcknowledged ? "已确认在部分候选不可用的情况下继续。" : "部分候选未完成，继续判断前需要明确确认风险。", isError: !run.partialCompletionAcknowledged)
                    ForEach(run.failedCandidates, id: \.candidateId) { candidate in HStack { VStack(alignment: .leading) { Text(candidate.title); Text(candidate.failureCode).foregroundStyle(.secondary) }; Spacer(); if candidate.retryable { EPButton("重试候选") { Task { await workspace.retryTheoryCandidate(candidate) } }.disabled(workspace.busy || workspace.theoryIsDirty) } } }
                    if !run.partialCompletionAcknowledged {
                        TextField(epLocalized("确认部分完成的理由"), text: Binding(get: { workspace.theoryDraft?.partialReason ?? "" }, set: { workspace.theoryDraft?.partialReason = $0 }), axis: .vertical).disabled(workspace.busy)
                        EPButton("确认部分结果并继续") { action = "partial" }.buttonStyle(EPButtonStyle()).disabled(workspace.busy || (workspace.theoryDraft?.partialReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true))
                    }
                }
                if let draft = workspace.theoryDraft {
                    ForEach(workspace.theoryCandidates, id: \.candidateId) { candidate in candidateView(candidate) }
                    if draft.adoptedIDs.count > 1 { relationEditor }
                    HStack { Button(workspace.theoryIsDirty ? "保存判断草稿" : "草稿已保存") { Task { await workspace.saveTheoryDraft() } }.buttonStyle(EPButtonStyle()).disabled(!workspace.theoryIsDirty || workspace.busy || workspace.theoryDraftConflict)
                        EPButton("提交完整决定") { action = "submit" }.buttonStyle(EPButtonStyle(primary: true)).disabled(!canSubmit) }
                    if !draft.isComplete(candidates: workspace.theoryCandidates) { EPText("为每个候选选择判断并填写理由；采用的理论需要说明角色与作用，多个理论需要解释关系。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                }
                if let set = workspace.decisionSet {
                    DisclosureGroup("已保存的决定 v\(set.version)") { ForEach(set.decisions, id: \.decisionId) { item in Text("\(workspace.theoryCandidates.first(where: { $0.candidateId == item.candidateId })?.title ?? item.candidateId) · \(item.action)").bold(); Text(item.reason).textSelection(.enabled) } }
                    if set.allowedActions.contains("confirm_theory_plan"), workspace.theoryPlan?.decisionSetId != set.decisionSetId { EPButton("确认理论方案") { action = "confirm" }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy || workspace.theoryIsDirty) }
                }
            } else if !workspace.loading {
                ResearchWorkspaceEmpty(title: "让理论与研究问题对话", detail: "从已确认的研究现象出发，寻找理论候选、检查支持与冲突依据，再做出你的判断。")
                EPButton("开始理论匹配") { action = "start" }.buttonStyle(EPButtonStyle(primary: true)).disabled(workspace.busy || workspace.navigation?.phenomenonSummary == nil)
                EPButton("先与 Agent 讨论") { app.composer = "请根据当前研究现象与材料讨论可能的理论视角，说明各自依据和适用边界。"; app.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle())
            }
        }.padding(T.space5) }
            .alert(confirmTitle, isPresented: Binding(get: { !action.isEmpty }, set: { if !$0 { action = "" } })) {
                EPButton("取消", role: .cancel) { action = "" }; EPButton("确认") { let value = action; action = ""; Task { switch value { case "start": await workspace.startTheoryMatch(); case "partial": await workspace.acknowledgePartialTheory(); case "submit": await workspace.submitTheoryDecisions(); case "discard": workspace.discardTheoryChanges(); default: await workspace.confirmTheory() } } }
            } message: { Text(confirmDetail) }
    }
    private func candidateView(_ candidate: TheoryCandidateResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            Text(candidate.title).font(TypeStyle.reading(T.textHeading)); Text(candidate.problemFocus).foregroundStyle(.secondary)
            ForEach(candidate.coreClaims, id: \.self) { Text($0).textSelection(.enabled) }
            Text("适用性：\(candidate.applicabilityJudgement)").fontWeight(.medium); Text(candidate.applicabilityRationale).textSelection(.enabled)
            if !candidate.formalAdoptionEligible { ForEach(candidate.adoptionBlockers, id: \.self) { InlineMessage(text: $0, isError: true) } }
            DisclosureGroup("支持依据（\(candidate.supportingEvidence.count)）") { ForEach(candidate.supportingEvidence, id: \.evidenceRefId) { evidence($0) } }
            DisclosureGroup("冲突依据（\(candidate.conflictingEvidence.count)）") { ForEach(candidate.conflictingEvidence, id: \.evidenceRefId) { evidence($0) } }
            DisclosureGroup("缺失依据、限制与误用边界") { ForEach(candidate.missingEvidence + candidate.limitations + candidate.misuseBoundaries, id: \.self) { Text($0).textSelection(.enabled) } }
            if let index = workspace.theoryDraft?.decisions.firstIndex(where: { $0.candidateId == candidate.candidateId }) {
                WebSelect(label: "我的判断", selection: decisionBinding(index, \.action), options: [("", epLocalized("选择判断")), ("adopt", epLocalized("采用")), ("combine", epLocalized("组合使用")), ("exclude", epLocalized("排除")), ("retain", epLocalized("保留备选")), ("defer", epLocalized("暂缓判断")), ("request_more_evidence", epLocalized("补充依据")), ("revise_applicability", epLocalized("修正适用范围"))], disabledOptions: candidate.formalAdoptionEligible ? [] : ["adopt", "combine"])
                TextField(epLocalized("判断理由"), text: decisionBinding(index, \.reason), axis: .vertical)
                if workspace.theoryDraft?.decisions[index].action == "revise_applicability" { TextField(epLocalized("修正后的适用范围"), text: decisionBinding(index, \.revisedApplicability), axis: .vertical) }
                if ["adopt", "combine"].contains(workspace.theoryDraft?.decisions[index].action ?? ""), let assignment = workspace.theoryDraft?.assignments.firstIndex(where: { $0.candidateId == candidate.candidateId }) {
                    WebSelect(label: "在方案中的角色", selection: assignmentBinding(assignment, \.roleCode), options: [("primary", epLocalized("主要解释视角")), ("secondary", epLocalized("补充解释视角")), ("contrast", epLocalized("对照解释")), ("scope", epLocalized("限定适用范围"))])
                    TextField(epLocalized("它负责解释什么，不负责解释什么"), text: assignmentBinding(assignment, \.responsibility), axis: .vertical)
                }
                if !candidate.sourceIds.isEmpty { DisclosureGroup("本次判断使用的来源") { ForEach(candidate.sourceIds, id: \.self) { id in Toggle(id, isOn: Binding(get: { workspace.theoryDraft?.decisions[index].relatedSourceIds?.contains(id) == true }, set: { selected in var values = workspace.theoryDraft?.decisions[index].relatedSourceIds ?? []; if selected && !values.contains(id) { values.append(id) } else if !selected { values.removeAll { $0 == id } }; workspace.theoryDraft?.decisions[index].relatedSourceIds = values })) } } }
            }
            Divider()
        }.disabled(workspace.busy || workspace.theoryDraftConflict)
    }
    private var relationEditor: some View { VStack(alignment: .leading, spacing: T.space3) {
        EPText("多个理论如何共同解释").font(TypeStyle.reading(T.textHeading))
        TextField(epLocalized("关系解释"), text: relationText(\.explanation), axis: .vertical); TextField(epLocalized("前提相容性"), text: relationText(\.premiseCompatibility), axis: .vertical)
        TextField(epLocalized("支持依据（每行一项）"), text: relationLines(\.supportingEvidence), axis: .vertical); TextField(epLocalized("排除依据（每行一项）"), text: relationLines(\.excludingEvidence), axis: .vertical); TextField(epLocalized("区分依据（每行一项）"), text: relationLines(\.distinguishingEvidence), axis: .vertical)
    }.disabled(workspace.busy || workspace.theoryDraftConflict) }
    private func evidence(_ item: EvidenceReferenceResponse) -> some View { VStack(alignment: .leading, spacing: T.space2) { Text(item.claim).bold(); if let excerpt = item.excerpt { Text(excerpt).textSelection(.enabled) }; Text("\(item.verificationStatus) · \(item.useBoundary)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); if let source = item.source { Text(source.title).font(TypeStyle.ui(T.textMeta)); if let value = source.url, let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? "") { Link("查看来源", destination: url) } }; Divider() } }
    private func decisionBinding(_ index: Int, _ key: WritableKeyPath<TheoryDecisionDraftInput, String?>) -> Binding<String> { Binding(get: { workspace.theoryDraft?.decisions[index][keyPath: key] ?? "" }, set: { workspace.theoryDraft?.decisions[index][keyPath: key] = $0.isEmpty ? nil : $0 }) }
    private func assignmentBinding(_ index: Int, _ key: WritableKeyPath<TheoryUseAssignmentInput, String>) -> Binding<String> { Binding(get: { workspace.theoryDraft?.assignments[index][keyPath: key] ?? "" }, set: { workspace.theoryDraft?.assignments[index][keyPath: key] = $0 }) }
    private func relationText(_ key: WritableKeyPath<TheoryRelationInput, String>) -> Binding<String> { Binding(get: { workspace.theoryDraft?.relation[keyPath: key] ?? "" }, set: { workspace.theoryDraft?.relation[keyPath: key] = $0 }) }
    private func relationLines(_ key: WritableKeyPath<TheoryRelationInput, [String]>) -> Binding<String> { Binding(get: { workspace.theoryDraft?.relation[keyPath: key].joined(separator: "\n") ?? "" }, set: { workspace.theoryDraft?.relation[keyPath: key] = $0.split(separator: "\n").map(String.init) }) }
    private var confirmTitle: String { ["start":"开始理论匹配？", "partial":"在部分结果下继续？", "submit":"提交完整理论决定？", "confirm":"确认理论方案？", "discard":"放弃本地理论判断修改？"][action] ?? "确认" }
    private var confirmDetail: String { switch action { case "start": return "将基于已确认研究现象与知识版本生成理论候选。"; case "partial": return "未完成候选不会被当作已排除，风险和你的理由会保留。"; case "submit": return "保存当前所有候选的判断、角色分工与关系依据。"; case "discard": return "用服务器最新草稿替换当前未保存的修改。"; default: return "理论方案将成为后续研究框架与方法计划的依据。" } }
}
#endif
