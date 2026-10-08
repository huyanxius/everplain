#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

@MainActor final class ResearchWorkspaceStore: ObservableObject {
    @Published var tool: ResearchWorkspaceTool = .map
    @Published private(set) var taskId: String?
    @Published private(set) var navigation: ResearchTaskNavigationResponse?
    @Published private(set) var journey: AgentResearchJourneyResponse?
    @Published private(set) var materials: [ResearchMaterialResponse] = []
    @Published var material: ResearchMaterialResponse?
    @Published private(set) var analysis: ResearchAnalysisSnapshotResponse?
    @Published private(set) var cycle: ResearchCycleResponse?
    @Published private(set) var documents: [ResearchDocumentResponse] = []
    @Published private(set) var proposals: [ResearchDocumentProposalResponse] = []
    @Published var draft: ResearchDocumentDraft?
    @Published private(set) var versions: [ResearchDocumentResponse] = []
    @Published private(set) var completion: ResearchDocumentCompletionGateResponse?
    @Published private(set) var method: MethodPlanResponse?
    @Published var methodDraft: MethodPlanResponse?
    @Published private(set) var methodVersions: [MethodPlanResponse] = []
    @Published private(set) var methodConflict = false
    @Published private(set) var match: MatchRunResponse?
    @Published var theoryDraft: ResearchTheoryDraft?
    @Published private(set) var theoryCandidates: [TheoryCandidateResponse] = []
    @Published private(set) var theoryDraftConflict = false
    @Published private(set) var decisionSet: TheoryDecisionSetResponse?
    private var theoryBaseline: ResearchTheoryDraft?
    private var remoteTheoryDraft: ResearchTheoryDraft?
    @Published private(set) var theoryPlan: ConfirmedTheoryPlanResponse?
    @Published private(set) var audit: [ResearchAuditEventResponse] = []
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var notice: String?
    @Published var selectedNodeId: String?
    @Published var selectedSectionId: String?
    var onAuthenticationRequired: (() -> Void)?
    var onTaskEstablished: ((String, String) -> Void)?
    private var api: APIClient?
    private var ownerId: String?
    private var generation = UUID()
    private var projectGeneration = UUID()
    private var readGeneration = UUID()
    private var journeyGeneration = UUID()
    private var materialGeneration = UUID()
    private var conversationId: String?
    private var newDocumentSectionID = UUID().uuidString
    private var mutationJournal = ResearchMutationJournal()
    private var loadTask: Task<Void, Never>?
    private var journeyTask: Task<Void, Never>?
    private var matchPollTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    var hasUnsavedChanges: Bool { draft?.isDirty == true || methodDraft != method || theoryIsDirty }
    var theoryIsDirty: Bool { theoryDraft != theoryBaseline }
    var methodIsDirty: Bool { methodDraft != method }

    func configure(api: APIClient?, ownerId: String?) {
        guard self.ownerId != ownerId || self.api !== api else { return }
        generation = UUID(); projectGeneration = UUID(); readGeneration = UUID(); journeyGeneration = UUID(); materialGeneration = UUID()
        loadTask?.cancel(); journeyTask?.cancel(); pollTask?.cancel(); matchPollTask?.cancel(); matchPollTask = nil; loadTask = nil; journeyTask = nil; pollTask = nil
        self.api = api; self.ownerId = ownerId; conversationId = nil; taskId = nil; journey = nil; tool = .map
        clearProject(); loading = false; busy = false; error = nil; notice = nil; mutationJournal.reset()
    }
    private func clearProject() {
        navigation = nil; materials = []; material = nil; analysis = nil; cycle = nil; documents = []; proposals = []
        draft = nil; versions = []; completion = nil; method = nil; methodDraft = nil; methodVersions = []; methodConflict = false
        match = nil; theoryPlan = nil; theoryDraft = nil; theoryBaseline = nil; remoteTheoryDraft = nil; theoryCandidates = []; theoryDraftConflict = false; decisionSet = nil; audit = []; selectedNodeId = nil; selectedSectionId = nil
    }
    func open(taskId: String?, conversation: AgentConversationResponse?) {
        if self.taskId != taskId {
            projectGeneration = UUID(); readGeneration = UUID(); materialGeneration = UUID(); loadTask?.cancel(); pollTask?.cancel(); pollTask = nil; matchPollTask?.cancel(); matchPollTask = nil; loading = false
            self.taskId = taskId; clearProject(); tool = .map; error = nil; notice = nil; busy = false; mutationJournal.reset()
        }
        if let conversation, let taskId, conversation.taskId != taskId { error = ResearchWorkspaceError.wrongProject.localizedDescription; return }
        if conversationId != conversation?.conversationId { journeyGeneration = UUID(); journeyTask?.cancel(); journey = nil; conversationId = conversation?.conversationId }
        if let id = conversation?.conversationId { journeyTask?.cancel(); journeyTask = Task { await loadJourney(id) } }
        loadTask?.cancel(); loadTask = Task { await refresh() }
    }
    func select(_ next: ResearchWorkspaceTool) {
        tool = next; readGeneration = UUID(); loadTask?.cancel(); error = nil; notice = nil
        loadTask = Task { await refresh() }
    }
    func refresh() async {
        guard let api, let id = taskId, ownerId != nil else { return }
        let epoch = generation, project = projectGeneration, read = UUID(); readGeneration = read; let requestedTool = tool
        loading = true; error = nil
        defer { if epoch == generation, project == projectGeneration, read == readGeneration { loading = false } }
        do {
            let nav: ResearchTaskNavigationResponse = try await api.get("/api/research-tasks/\(id)/navigation")
            try valid(epoch, project, read); navigation = nav
            switch requestedTool {
            case .map, .writing:
                async let docs: ResearchDocumentListResponse = api.get("/api/research-tasks/\(id)/research-documents")
                async let suggestions: ResearchTaskDocumentProposalListResponse = api.get("/api/research-tasks/\(id)/research-document-proposals")
                let (d, p) = try await (docs, suggestions); try valid(epoch, project, read)
                documents = d.items; proposals = p.items
                if let old = draft, let updated = d.items.first(where: { $0.documentId == old.base.documentId }) { draft?.receive(updated) }
                else if draft == nil, let only = d.items.count == 1 ? d.items.first : nil { draft = ResearchDocumentDraft(only) }
                if let doc = draft?.base { await loadDocumentDetails(doc, epoch: epoch, project: project, read: read) }
            case .materials:
                let response: ResearchMaterialListResponse = try await api.get("/api/research-tasks/\(id)/materials"); try valid(epoch, project, read); materials = response.items
                startMaterialPolling()
            case .analysis:
                async let snapshot: ResearchAnalysisSnapshotResponse = api.get("/api/research-tasks/\(id)/analysis")
                async let nextCycle: ResearchCycleResponse = api.get("/api/research-tasks/\(id)/research-cycle")
                let (a, c) = try await (snapshot, nextCycle); try valid(epoch, project, read)
                guard c.schemaVersion == "research-cycle-v1" else { throw ClientError.invalidResponse }; analysis = a; cycle = c
            case .method:
                let value: MethodPlanResponse? = try await api.get("/api/research-tasks/\(id)/method-plans/current"); try valid(epoch, project, read)
                if methodIsDirty { methodConflict = value?.version != methodDraft?.version }
                else { methodDraft = value; methodConflict = false }
                method = value
                if let value { let history: MethodPlanVersionListResponse = try await api.get("/api/method-plans/\(value.planId)/versions"); try valid(epoch, project, read); methodVersions = history.items }
            case .theory:
                if let runId = nav.currentMatchRunId {
                    let value: MatchRunResponse = try await api.get("/api/match-runs/\(runId)"); try valid(epoch, project, read); match = value
                    var candidates = value.candidatePage.candidates; var cursor = value.candidatePage.nextCursor; var seen = Set<String>()
                    while let next = cursor { guard seen.insert(next).inserted else { throw ClientError.invalidResponse }; let page: MatchCandidatePageResponse = try await api.get("/api/match-runs/\(runId)/candidates", query: ["cursor": next, "limit": "100"]); try valid(epoch, project, read); candidates.append(contentsOf: page.candidates); cursor = page.nextCursor }
                    theoryCandidates = candidates
                    var server: TheoryDecisionDraftResponse?
                    do { server = try await api.get("/api/match-runs/\(runId)/decision-draft") } catch ClientError.server(let status, _, _) where status == 404 { server = nil }
                    try valid(epoch, project, read); let incoming = ResearchTheoryDraft(server: server, candidates: candidates)
                    if theoryIsDirty { if incoming.version != theoryBaseline?.version || candidates.contains(where: { candidate in theoryDraft?.decisions.first(where: { $0.candidateId == candidate.candidateId })?.candidateVersion != candidate.version }) { theoryDraftConflict = true; remoteTheoryDraft = incoming } }
                    else { theoryDraft = incoming; theoryBaseline = incoming; theoryDraftConflict = false; remoteTheoryDraft = nil }
                    let decisions: TheoryDecisionPageResponse = try await api.get("/api/match-runs/\(runId)/decisions", query: ["limit": "20"]); try valid(epoch, project, read); decisionSet = decisions.decisionSets.first; startMatchPolling()
                }
                if let planId = nav.currentTheoryPlanId { let value: ConfirmedTheoryPlanResponse = try await api.get("/api/theory-plans/\(planId)"); try valid(epoch, project, read); theoryPlan = value }
            case .archive:
                let value: ResearchAuditEventListResponse = try await api.get("/api/research-tasks/\(id)/exchange/audit"); try valid(epoch, project, read); audit = value.items
            }
        } catch is CancellationError {} catch { if epoch == generation, project == projectGeneration, read == readGeneration { fail(error) } }
    }
    private func valid(_ epoch: UUID, _ project: UUID, _ read: UUID? = nil) throws {
        guard epoch == generation, project == projectGeneration, read.map({ $0 == readGeneration }) ?? true, !Task.isCancelled else { throw CancellationError() }
    }
    func loadJourney(_ id: String) async {
        guard let api, ownerId != nil else { return }; let epoch = generation, read = UUID(); journeyGeneration = read
        do { let value: AgentResearchJourneyResponse = try await api.get("/api/agent/conversations/\(id)/journey")
            guard epoch == generation, read == journeyGeneration, id == conversationId, !Task.isCancelled else { return }; journey = value
        } catch is CancellationError {} catch { if epoch == generation, read == journeyGeneration { fail(error) } }
    }
    func createExistingProject(title: String, stage: String, orientation: String) async -> String? {
        let request = CreateResearchTaskRequest(entryMode: "existing_research", entryType: "material_input", methodOrientation: orientation.isEmpty ? nil : orientation, projectStage: stage, projectTitle: title)
        let value: ResearchTaskResponse? = await mutate("/api/research-tasks", body: request)
        return value?.taskId
    }
    func confirmStart() async {
        guard let proposal = journey?.proposal, proposal.status == "pending_confirmation" else { return }
        let request = ConfirmResearchStartRequest(context: proposal.context, expectedVersion: proposal.version, phenomenon: proposal.phenomenon, researchIntent: proposal.researchIntent)
        if let value: ConfirmResearchStartResponse = await mutate("/api/agent/research-start-proposals/\(proposal.proposalId)/confirm", body: request) {
            journey = AgentResearchJourneyResponse(conversationId: value.conversationId, navigation: value.navigation, proposal: value.proposal, status: value.status, taskId: value.taskId)
            onTaskEstablished?(value.taskId, value.conversationId)
        }
    }
    func editNode(_ node: AgentResearchMapNodeResponse, conversation: AgentConversationResponse, title: String, summary: String) async -> AgentConversationResponse? {
        guard let nodeId = node.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) else { return nil }
        let body = AgentCanvasNodeEditRequest(expectedSummary: node.summary, expectedTitle: node.title, expectedVersion: conversation.canvasEditVersion ?? 0, summary: summary, title: title)
        return await mutate("/api/agent/conversations/\(conversation.conversationId)/research-map/nodes/\(nodeId)", method: "PATCH", body: body)
    }
    func selectDocument(_ document: ResearchDocumentResponse) async {
        guard !hasUnsavedChanges, !busy, document.taskId == taskId else { return }
        draft = ResearchDocumentDraft(document); completion = nil; versions = []
        await loadDocumentDetails(document, epoch: generation, project: projectGeneration, read: readGeneration)
    }
    private func loadDocumentDetails(_ doc: ResearchDocumentResponse, epoch: UUID, project: UUID, read: UUID) async {
        guard let api else { return }
        do {
            async let history: ResearchDocumentVersionListResponse = api.get("/api/research-documents/\(doc.documentId)/versions")
            async let gate: ResearchDocumentCompletionGateResponse = api.get("/api/research-documents/\(doc.documentId)/completion-gate")
            let (h, g) = try await (history, gate); try valid(epoch, project, read); guard draft?.base.documentId == doc.documentId else { return }; versions = h.items; completion = g
        } catch is CancellationError {} catch { if epoch == generation, project == projectGeneration, read == readGeneration { fail(error) } }
    }
    func discardUnsavedChanges() { discardDocumentChanges(); discardMethodChanges(); discardTheoryChanges() }
    func discardDocumentChanges() { draft?.discardLocalChanges(); error = nil }
    func saveDocument() async {
        guard let current = draft, current.isDirty else { return }
        do {
            let body = try current.saveRequest(changeSummary: "用户直接编辑正文")
            if let value: ResearchDocumentResponse = await mutate("/api/research-documents/\(current.base.documentId)", method: "PATCH", body: body) { draft?.acknowledge(value, submitted: current); notice = "文稿已保存"; await refresh() }
            else if let api {
                let epoch = generation, project = projectGeneration
                if let latest: ResearchDocumentResponse = try? await api.get("/api/research-documents/\(current.base.documentId)"), epoch == generation, project == projectGeneration { draft?.receive(latest) }
            }
        } catch { fail(error) }
    }
    func createDocument(title: String, content: String) async {
        guard let id = taskId, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let body = CreateResearchDocumentRequest(sections: [ResearchDocumentSectionContract(content: content, key: "research_notes", sectionId: newDocumentSectionID, status: "draft", title: title)], theoryPlanId: navigation?.currentTheoryPlanId, title: title)
        if let value: ResearchDocumentResponse = await mutate("/api/research-tasks/\(id)/research-documents", body: body) { draft = ResearchDocumentDraft(value); newDocumentSectionID = UUID().uuidString; await refresh() }
    }
    func accept(_ proposal: ResearchDocumentProposalResponse) async {
        guard draft?.isDirty != true, proposal.status == "pending", proposal.kind == "create" || proposal.baseDocumentVersion == draft?.base.version else { error = "先保存文稿，并核对建议对应的文稿版本。"; return }
        if let value: ResearchDocumentProposalAcceptanceResponse = await mutate("/api/research-document-proposals/\(proposal.proposalId)/accept", body: AcceptResearchDocumentProposalRequest(expectedDocumentVersion: draft?.base.version)) { draft = ResearchDocumentDraft(value.document); await refresh() }
    }
    func reject(_ proposal: ResearchDocumentProposalResponse, reason: String) async {
        if let _: ResearchDocumentProposalResponse = await mutate("/api/research-document-proposals/\(proposal.proposalId)/reject", body: RejectResearchDocumentProposalRequest(reason: reason)) { await refresh() }
    }
    func restoreDocument(version: Int, reason: String) async {
        guard let current = draft, !current.isDirty else { return }
        if let value: ResearchDocumentResponse = await mutate("/api/research-documents/\(current.base.documentId)/restore", body: RestoreResearchDocumentRequest(expectedVersion: current.base.version, reason: reason, sourceVersion: version)) { draft = ResearchDocumentDraft(value); await refresh() }
    }
    func confirmDocument() async {
        guard let current = draft, !current.isDirty, completion?.ready == true, completion?.version == current.base.version else { return }
        if let value: ResearchDocumentResponse = await mutate("/api/research-documents/\(current.base.documentId)/confirm", body: ConfirmResearchDocumentRequest(expectedVersion: current.base.version)) { draft = ResearchDocumentDraft(value); await refresh() }
    }
    func chooseFormattingFile(css: Bool) {
        guard draft != nil, !busy else { return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
        panel.allowedContentTypes = [UTType(filenameExtension: css ? "css" : "csl") ?? .text]
        let epoch = generation, project = projectGeneration, documentId = draft?.base.documentId
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                guard let self, epoch == self.generation, project == self.projectGeneration, documentId == self.draft?.base.documentId else { return }
                let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                do { let content = try String(contentsOf: url, encoding: .utf8)
                    if css { self.draft?.formatting.customCss = content; self.draft?.formatting.templateId = "custom" }
                    else { self.draft?.formatting.customCsl = content; self.draft?.formatting.cslStyleId = "custom-" + url.deletingPathExtension().lastPathComponent }
                } catch { self.fail(error) }
            }
        }
    }
    func exportDocument(json: Bool) async {
        guard let api, let current = draft else { return }; let epoch = generation, project = projectGeneration
        do {
            let value: ResearchDocumentExportResponse = try await api.get("/api/research-documents/\(current.base.documentId)/export", query: ["version": String(current.base.version)])
            try valid(epoch, project)
            let data: Data
            if json { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; data = try encoder.encode(value.manifest) } else { data = Data(value.markdown.utf8) }
            save(data, filename: json ? (value.filename as NSString).deletingPathExtension + ".json" : value.filename)
        } catch is CancellationError {} catch { if epoch == generation { fail(error) } }
    }
    func openMaterial(_ item: ResearchMaterialResponse) async {
        guard let api, item.taskId == taskId else { return }; let epoch = generation, project = projectGeneration, read = UUID(); materialGeneration = read; material = item
        do { let value: ResearchMaterialResponse = try await api.get("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)"); try valid(epoch, project); if read == materialGeneration { material = value } }
        catch is CancellationError {} catch { if epoch == generation, read == materialGeneration { fail(error) } }
    }
    func exportFormalDocument(_ format: ResearchWorkspaceExportFormat) async {
        guard let api, let current = draft, !current.isDirty, !busy else { return }; let epoch = generation, project = projectGeneration
        busy = true; error = nil; notice = nil
        defer { if epoch == generation, project == projectGeneration { busy = false } }
        do {
            let exported: ResearchDocumentExportResponse = try await api.get("/api/research-documents/\(current.base.documentId)/export", query: ["version": String(current.base.version)])
            try valid(epoch, project)
            guard exported.documentId == current.base.documentId, exported.version == current.base.version, exported.taskId == current.base.taskId else { throw ClientError.invalidResponse }
            var literature: [LiteratureEntryResponse] = []
            if !exported.manifest.citationAudit.isEmpty {
                do { let archive: ProfessionalMaterialArchiveResponse = try await api.get("/api/research-tasks/\(exported.taskId)/material-archive"); try valid(epoch, project); literature = archive.literature }
                catch ClientError.authenticationRequired { throw ClientError.authenticationRequired }
                catch is CancellationError { throw CancellationError() }
                catch { /* Missing CSL stays explicit in the exported citation-warning appendix. */ }
            }
            try valid(epoch, project)
            let document = ResearchExportDocument(exported: exported, literature: literature)
            let bibliography = try ResearchWorkspaceExportCSL.bibliography(for: document)
            let bytes: Data
            var imageWarnings: [String] = []
            if format == .docx { bytes = try ResearchExportDOCX.data(document: document, bibliography: bibliography) }
            else { let (images, warnings) = try await ResearchWorkspaceExportPDF.loadImages(document: document, api: api); imageWarnings = warnings; try valid(epoch, project); bytes = try ResearchWorkspaceExportPDF.data(document: document, bibliography: bibliography, images: images, imageWarnings: warnings) }
            try valid(epoch, project)
            let style = ResearchExportPageStyle(template: document.formatting.templateId, customCSS: document.formatting.customCss)
            let details = (document.warnings.isEmpty ? [] : ["\(document.warnings.count) 条引用需核对，已在文稿中列明。"]) + style.warnings + imageWarnings
            save(bytes, filename: (exported.filename as NSString).deletingPathExtension + "." + format.rawValue, detail: details.isEmpty ? nil : details.joined(separator: " "))
        } catch is CancellationError {} catch { if epoch == generation, project == projectGeneration { fail(error) } }
    }
    func readEvidenceMaterial(_ reference: ResearchDocumentEvidenceRefContract) async -> ResearchMaterialResponse? {
        guard let api, let id = taskId, let materialId = reference.materialId else { return nil }; let epoch = generation, project = projectGeneration
        do { let value: ResearchMaterialResponse = try await api.get("/api/research-tasks/\(id)/materials/\(materialId)", query: reference.parseId.map { ["parse_id": $0] } ?? [:]); try valid(epoch, project); return value }
        catch is CancellationError {} catch { if epoch == generation, project == projectGeneration { fail(error) } }; return nil
    }
    func downloadMaterial(_ item: ResearchMaterialResponse) async {
        guard let api, item.taskId == taskId else { return }; let epoch = generation, project = projectGeneration
        do { let value = try await api.download("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)/content"); try valid(epoch, project); save(value.data, filename: value.suggestedFilename ?? item.filename) }
        catch is CancellationError {} catch { if epoch == generation, project == projectGeneration { fail(error) } }
    }
    func annotate(_ segment: ResearchMaterialSegmentResponse, quote: String, note: String, kind: String, caseLabel: String) async {
        guard let id = taskId else { return }
        do {
            let range = try ResearchQuoteSelection.range(of: quote, in: segment.text)
            let body = CreateAnalysisAnnotationRequest(annotationKind: kind, caseLabel: caseLabel.isEmpty ? nil : caseLabel, materialId: segment.materialId, note: note, parseId: segment.parseId, quoteEnd: range.upperBound, quoteStart: range.lowerBound, segmentId: segment.segmentId)
            if let _: AnalysisAnnotationResponse = await mutate("/api/research-tasks/\(id)/analysis/annotations", body: body) { notice = "片段标记已保存" }
        } catch { fail(error) }
    }
    func createMemo(title: String, content: String, kind: String, annotationIds: [String]) async {
        guard let id = taskId else { return }
        if let _: AnalysisMemoResponse = await mutate("/api/research-tasks/\(id)/analysis/memos", body: CreateAnalysisMemoRequest(annotationIds: annotationIds, content: content, memoKind: kind, title: title)) { await refresh() }
    }
    func createComparison(_ request: CreateCaseComparisonRequest) async {
        guard let id = taskId else { return }; if let _: CaseComparisonResponse = await mutate("/api/research-tasks/\(id)/analysis/comparisons", body: request) { await refresh() }
    }
    func decideMemo(_ memo: AnalysisMemoResponse, decision: String, reason: String) async {
        guard let id = taskId else { return }; if let _: AnalysisMemoResponse = await mutate("/api/research-tasks/\(id)/analysis/memos/\(memo.memoId)/decision", body: DecideAnalysisRecordRequest(decision: decision, expectedVersion: memo.version, reason: reason)) { await refresh() }
    }
    func decideComparison(_ comparison: CaseComparisonResponse, decision: String, reason: String) async {
        guard let id = taskId else { return }; if let _: CaseComparisonResponse = await mutate("/api/research-tasks/\(id)/analysis/comparisons/\(comparison.comparisonId)/decision", body: DecideAnalysisRecordRequest(decision: decision, expectedVersion: comparison.version, reason: reason)) { await refresh() }
    }
    func createMethod(kind: String) async {
        guard let id = taskId, let framework = navigation?.currentFrameworkId, let theory = navigation?.currentTheoryPlanId else { error = "请先确认研究框架与理论方案。"; return }
        if let value: MethodPlanResponse = await mutate("/api/research-tasks/\(id)/method-plans", body: CreateMethodPlanRequest(frameworkId: framework, methodKind: kind, theoryPlanId: theory)) { method = value; methodDraft = value; await refresh() }
    }
    func saveMethod() async {
        guard let value = methodDraft, let current = method, !methodConflict, value.version == current.version else { return }
        let request = UpdateMethodPlanRequest(changeSummary: "用户编辑方法计划", expectedVersion: current.version, methodKind: value.methodKind, rationale: value.rationale, sections: value.sections)
        if let updated: MethodPlanResponse = await mutate("/api/method-plans/\(current.planId)", method: "PATCH", body: request) { method = updated; methodDraft = updated; await refresh() }
        else { await refreshMethodAfterFailure() }
    }
    private func refreshMethodAfterFailure() async {
        guard let api, let id = taskId else { return }; let epoch = generation, project = projectGeneration
        if let latest: MethodPlanResponse = try? await api.get("/api/research-tasks/\(id)/method-plans/current"), epoch == generation, project == projectGeneration { methodConflict = latest.version != methodDraft?.version; method = latest }
    }
    func discardMethodChanges() { methodDraft = method; methodConflict = false }
    func reviewMethod(note: String, blocking: Bool) async {
        guard let current = method, !methodIsDirty else { return }
        if let updated: MethodPlanResponse = await mutate("/api/method-plans/\(current.planId)/reviews", body: ReviewMethodPlanRequest(blocking: blocking, expectedVersion: current.version, note: note)) { method = updated; methodDraft = updated; await refresh() }
    }
    func resolveReview(_ review: MethodPlanReviewContract, reason: String) async {
        guard let current = method, !methodIsDirty else { return }
        if let updated: MethodPlanResponse = await mutate("/api/method-plans/\(current.planId)/reviews/\(review.reviewId)/resolve", body: ResolveMethodPlanReviewRequest(expectedVersion: current.version, reason: reason)) { method = updated; methodDraft = updated; await refresh() }
    }
    func confirmMethod(reason: String) async {
        guard let current = method, !methodIsDirty else { return }
        if let updated: MethodPlanResponse = await mutate("/api/method-plans/\(current.planId)/confirm", body: ConfirmMethodPlanRequest(expectedVersion: current.version, reason: reason)) { method = updated; methodDraft = updated; await refresh() }
    }
    func restoreMethod(_ version: Int, reason: String) async {
        guard let current = method, !methodIsDirty else { return }
        if let updated: MethodPlanResponse = await mutate("/api/method-plans/\(current.planId)/restore", body: RestoreMethodPlanRequest(expectedVersion: current.version, reason: reason, sourceVersion: version)) { method = updated; methodDraft = updated; await refresh() }
    }
    func discardTheoryChanges() { theoryDraft = remoteTheoryDraft ?? theoryBaseline; theoryBaseline = theoryDraft; theoryDraftConflict = false; remoteTheoryDraft = nil }
    func startTheoryMatch() async {
        guard let id = taskId, let nav = navigation, let phenomenon = nav.phenomenonSummary else { return }
        if let value: MatchRunResponse = await mutate("/api/research-tasks/\(id)/match-runs", body: CreateMatchRunRequest(expectedTaskVersion: nav.version, knowledgeReleaseId: nav.knowledgeReleaseId, phenomenonQueryId: phenomenon.phenomenonQueryId, phenomenonVersion: phenomenon.version)) { match = value; await refresh() }
    }
    func retryTheoryCandidate(_ candidate: FailedTheoryCandidateResponse) async {
        guard let run = match else { return }
        if let value: MatchRunResponse = await mutate("/api/match-runs/\(run.matchRunId)/candidates/\(candidate.candidateId)/retry", body: RetryMatchCandidateRequest(expectedCandidateVersion: candidate.version, expectedMatchRunVersion: run.version)) { match = value; await refresh() }
    }
    func acknowledgePartialTheory() async {
        guard let run = match, let draft = theoryDraft, !draft.partialReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let value: MatchRunResponse = await mutate("/api/match-runs/\(run.matchRunId)/partial-completion-acknowledgements", body: AcknowledgePartialMatchRequest(acknowledgedCandidateIds: theoryCandidates.map(\.candidateId), expectedVersion: run.version, failedCandidateIds: run.failedCandidateIds, reason: draft.partialReason)) { match = value; await refresh() }
    }
    func saveTheoryDraft() async {
        guard let run = match, let draft = theoryDraft, !theoryDraftConflict else { return }
        if let value: TheoryDecisionDraftResponse = await mutate("/api/match-runs/\(run.matchRunId)/decision-draft", method: "PUT", body: draft.saveRequest(run: run)) { let saved = ResearchTheoryDraft(server: value, candidates: theoryCandidates); theoryDraft = saved; theoryBaseline = saved; notice = "理论判断草稿已保存" }
        else { await refresh() }
    }
    func submitTheoryDecisions() async {
        guard let run = match, let draft = theoryDraft, !theoryIsDirty, !theoryDraftConflict, draft.isComplete(candidates: theoryCandidates), run.completionBasis == "complete" || run.partialCompletionAcknowledged else { return }
        if let value: TheoryDecisionSetResponse = await mutate("/api/match-runs/\(run.matchRunId)/decisions", body: draft.decisionRequest(run: run)) { decisionSet = value; notice = "理论决定已保存，请确认理论方案" }
    }
    func confirmTheory() async {
        guard let set = decisionSet, !theoryIsDirty else { return }
        if let value: ConfirmedTheoryPlanResponse = await mutate("/api/decision-sets/\(set.decisionSetId)/confirm", body: ConfirmTheoryPlanRequest(expectedDecisionSetVersion: set.version)) { theoryPlan = value; await refresh() }
    }
    func exportArchive() async {
        guard let api, let id = taskId, !busy else { return }; let epoch = generation, project = projectGeneration; busy = true; error = nil
        defer { if epoch == generation, project == projectGeneration { busy = false } }
        do {
            let attempt = try mutationJournal.prepare(path: "/api/research-tasks/\(id)/exchange/archive", body: [String: String]())
            let value = try await api.download(attempt.path, method: "POST", key: attempt.key); try valid(epoch, project); mutationJournal.complete(attempt)
            save(value.data, filename: value.suggestedFilename ?? "research-project.zip")
        } catch is CancellationError {} catch { if epoch == generation, project == projectGeneration { fail(error) } }
    }
    private func startMatchPolling() {
        guard matchPollTask == nil, match?.status == "generating" else { return }; let epoch = generation, project = projectGeneration
        matchPollTask = Task {
            defer { if epoch == generation, project == projectGeneration { matchPollTask = nil } }
            while !Task.isCancelled, tool == .theory, match?.status == "generating" {
                do { try await Task.sleep(nanoseconds: 1_500_000_000); try valid(epoch, project) } catch { return }
                if !busy { await refresh(); if error != nil { return } }
            }
        }
    }
    private func startMaterialPolling() {
        guard pollTask == nil, materials.contains(where: { ["queued", "processing"].contains($0.ingestionStatus ?? "") }) else { return }
        let epoch = generation, project = projectGeneration
        pollTask = Task {
            defer { if epoch == generation, project == projectGeneration { pollTask = nil } }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_000_000_000); try valid(epoch, project) } catch { return }
                guard let api, let id = taskId else { return }
                do { let value: ResearchMaterialListResponse = try await api.get("/api/research-tasks/\(id)/materials"); try valid(epoch, project); materials = value.items
                    if !materials.contains(where: { ["queued", "processing"].contains($0.ingestionStatus ?? "") }) { return }
                } catch is CancellationError { return } catch { if epoch == generation, project == projectGeneration { fail(error) }; return }
            }
        }
    }
    private func mutate<B: Encodable & Sendable, R: Decodable & Sendable>(_ path: String, method: String = "POST", body: B) async -> R? {
        guard !busy, let api, ownerId != nil else { return nil }; let epoch = generation, project = projectGeneration
        busy = true; error = nil; notice = nil
        defer { if epoch == generation, project == projectGeneration { busy = false } }
        do {
            let attempt = try mutationJournal.prepare(path: path, method: method, body: body)
            let value: R = try await api.mutate(path, method: method, body: body, key: attempt.key); try valid(epoch, project)
            mutationJournal.complete(attempt); return value
        } catch is CancellationError {} catch { if epoch == generation, project == projectGeneration { fail(error) } }
        return nil
    }
    private func save(_ data: Data, filename: String, detail: String? = nil) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = (filename as NSString).lastPathComponent
        let epoch = generation, project = projectGeneration
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                guard let self, epoch == self.generation, project == self.projectGeneration else { return }
                do { try data.write(to: url, options: .atomic); self.notice = "已导出 \(url.lastPathComponent)" + (detail.map { " · " + $0 } ?? "") } catch { self.fail(error) }
            }
        }
    }
    private func fail(_ failure: Error) { error = failure.localizedDescription; if failure as? ClientError == .authenticationRequired { onAuthenticationRequired?() } }
}
#endif
