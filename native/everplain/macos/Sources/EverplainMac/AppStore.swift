#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

@MainActor
final class AppStore: ObservableObject {
    enum Route: String, CaseIterable { case home, chat, account, agent, library, graph, research, workspace }
    let knowledge = KnowledgeStore()
    let research = ResearchStore()
    let workspace = ResearchWorkspaceStore()
    let memory = MemoryStore()
    let accountManagement = AccountManagementStore()
    let welcome = WelcomeSetupStore()
    @Published var welcomePresented = false
    @Published var interfaceLocale = UserDefaults.standard.string(forKey: "qunxue.interface-locale") ?? "zh-CN"
    @Published var splitSidebar = UserDefaults.standard.string(forKey: "everplain.sidebar-layout") == "split"
    @Published var sidebarRecordsOpen = UserDefaults.standard.string(forKey: "everplain.sidebar-records") != "closed"
    @Published var agentDraftPreview: AgentProfileResponse?
    @Published var selectedCitation: AgentCitationResponse?
    @Published var selectedToolStep: NativeToolStep?
    @Published var libraryChatActive = false
    @Published var selectedReferenceKnowledgeBaseId: String?
    @Published var settingsSection: SettingsSection = .profile
    @Published var companionTab: String?
    @Published var subscription: SubscriptionOverviewResponse?
    @Published var subscriptionSummary = "正在读取套餐…"
    @Published var route: Route = .home
    @Published private(set) var settingsBackground: Route = .home
    @Published var appearance = UserDefaults.standard.string(forKey: "EVERPLAIN_APPEARANCE") ?? "system"
    @Published var session: SessionResponse?
    @Published var booting = true
    @Published var authenticating = false
    @Published var account: AccountResponse?
    @Published var credits: CreditSummaryResponse?
    @Published var sessions: [AccountSessionResponse] = []
    @Published var profile: AgentProfileResponse?
    @Published var catalog: AgentModelCatalogResponse?
    @Published var modelCatalogStatus = "loading"
    @Published var modelId = ""
    @Published var effort = "" { didSet { saveModelPreference() } }
    @Published var conversations: [AgentConversationSummaryResponse] = []
    @Published var conversation: AgentConversationResponse?
    @Published var pending: PendingTurn?
    /// Unfinished requests belong only to the displayed owner/conversation. The
    /// original body and idempotency key stay paired even when another turn starts.
    @Published private(set) var retainedUnfinishedTurns: [PendingTurn] = []
    private var completedRequestKeys: Set<String> = []
    private var completedRunIds: Set<String> = []
    private var completedRunTurnIds: [String: String] = [:]
    @Published private(set) var completedPendingTurn: PendingTurn?
    @Published private(set) var completedTurnId: String?
    @Published var attachedMaterials: [ResearchMaterialResponse] = []
    @Published var availableMaterials: [ResearchMaterialResponse] = []
    @Published var materialPickerOpen = false
    @Published var materialPickerLoading = false
    @Published var materialUploading = false
    @Published var workspaceTaskId: String?
    @Published var workspaceChangeNeedsConfirmation = false
    private var pendingWorkspaceSwitch: (String?, String?)?
    @Published var workspaceDocumentId: String?
    @Published var workspaceDocumentVersion: Int?
    private var uploadTaskId: String?
    private var materialContextKey = UUID().uuidString
    private var attachmentPollTask: Task<Void, Never>?
    @Published var composerMode = "standard"
    @Published var webSearchEnabled = true
    @Published var researchPanelOpen = false
    @Published var composer = ""
    @Published var running = false
    @Published var stopping = false
    @Published private(set) var stopConfirmation: StopConfirmation?
    @Published private(set) var stopRecords: [StopRecoveryRecord] = []
    private var stopRecoveryTurn: PendingTurn?
    @Published var loadingConversation = false
    @Published var refreshing = false
    @Published var saving = false
    @Published var error: String?
    @Published var historyError: String?
    @Published var accountError: String?
    @Published var profileError: String?
    @Published var notice: String?
    @Published var focusComposer = UUID()
    @Published var endpointText: String
    private(set) var client: APIClient?
    private var ownerEpoch = UUID()
    private var navigationEpoch = UUID()
    private var streamTask: Task<Void, Never>?
    private var stopTask: Task<Void, Never>?
    private var stopGeneration = UUID()
    private var conversationTask: Task<Void, Never>?
    private var runGeneration = UUID()
    private var streamDispatched = false
    private var pendingConversationId: String?
    private var revalidating = false
    private var authenticationRequest = UUID()
    private var workspaceNavigationIntent = UUID()
    private var accountMutationLedger = AccountMutationLedger()

    init() {
        endpointText = ProcessInfo.processInfo.environment["EVERPLAIN_API_URL"] ?? UserDefaults.standard.string(forKey: "EVERPLAIN_API_URL") ?? "https://e.qunxue.xyz"
        if let endpoint = try? Endpoint(endpointText) { client = APIClient(endpoint: endpoint) }
    }
    var displayPendingStatusText: String { pending?.statusText ?? "正在思考" }
    var selectedModel: AgentModelChoiceResponse? { catalog?.items.first { $0.modelId == modelId } }
    var canSend: Bool {
        session != nil && companionTab == nil && (route == .home || route == .chat || route == .workspace || (route == .library && libraryChatActive)) && !running && !isCurrentStopPending && (route == .home || !unfinishedTurns.contains(where: { $0.status == "running" })) && !loadingConversation && !materialUploading && attachedMaterials.allSatisfy({ $0.status == "ready" }) &&
        (route != .workspace || workspace.taskId == workspaceTaskId) &&
        (route != .home || (selectedModel != nil && selectedModel?.reasoningEfforts.contains(effort) == true)) && catalog?.runtimeMode != "mock" &&
        !composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && composer.utf16.count <= 12_000
    }
    var unresolvedStopCount: Int { stopRecords.filter { $0.confirmation.isPending }.count }
    var isCurrentStopPending: Bool {
        guard route != .home else { return false }
        return stopRecords.contains { record in
            record.confirmation.isPending && (record.turn.key == pending?.key ||
                (record.confirmation.conversationId != nil && record.confirmation.conversationId == (conversation?.conversationId ?? pendingConversationId)))
        }
    }
    func setInterfaceLocale(_ value: String) { interfaceLocale = value == "en-US" ? "en-US" : "zh-CN"; UserDefaults.standard.set(interfaceLocale, forKey: "qunxue.interface-locale") }
    func setSplitSidebar(_ value: Bool) { splitSidebar = value; UserDefaults.standard.set(value ? "split" : "classic", forKey: "everplain.sidebar-layout") }
    func setSidebarRecordsOpen(_ value: Bool) { sidebarRecordsOpen = value; UserDefaults.standard.set(value ? "open" : "closed", forKey: "everplain.sidebar-records") }
    func setAppearance(_ value: String) {
        guard ["system", "light", "dark"].contains(value) else { return }
        appearance = value; UserDefaults.standard.set(value, forKey: "EVERPLAIN_APPEARANCE")
    }
    func dismissSettings() { guard !saving else { return }; route = settingsBackground; focusComposer = UUID() }
    var agentName: String { profile?.name ?? "Agent" }
    var displayName: String { account?.displayName ?? session?.user.displayName ?? "" }

    func configureAndRestore() async {
        guard !authenticating else { return }
        booting = true
        do {
            let endpoint = try Endpoint(endpointText)
            if client?.endpoint != endpoint {
                resetOwner()
                client?.close()
                client = APIClient(endpoint: endpoint)
            }
            UserDefaults.standard.set(endpoint.origin.absoluteString, forKey: "EVERPLAIN_API_URL")
            endpointText = endpoint.origin.absoluteString
            try await restoreSession()
        } catch { handle(error) }
        booting = false
    }
    func restore() async {
        guard client != nil else { booting = false; return }
        do { try await restoreSession() }
        catch { if error as? ClientError != .authenticationRequired { handle(error) } }
        booting = false
    }
    private func restoreSession() async throws {
        guard let api = client else { return }
        let epoch = ownerEpoch
        let value: SessionResponse = try await api.get("/api/session")
        guard epoch == ownerEpoch else { return }
        guard value.status == "active" else { throw ClientError.authenticationRequired }
        activate(value)
        await refreshProfile()
        if session != nil { Task { await refreshAll(includeProfile: false) } }
    }
    func login(email: String, password: String) async {
        guard !authenticating else { return }
        let requestID = UUID(); authenticationRequest = requestID; authenticating = true; error = nil
        defer { if authenticationRequest == requestID { authenticating = false } }
        do {
            let endpoint = try Endpoint(endpointText)
            if client?.endpoint != endpoint { client?.close(); resetOwner(); client = APIClient(endpoint: endpoint); authenticationRequest = requestID; authenticating = true }
            guard let api = client else { return }
            let epoch = ownerEpoch
            let value: SessionResponse = try await api.mutate("/api/session/login", body: LoginSessionRequest(email: email, password: password))
            guard epoch == ownerEpoch else { return }
            guard value.status == "active" else { throw ClientError.authenticationRequired }
            UserDefaults.standard.set(endpoint.origin.absoluteString, forKey: "EVERPLAIN_API_URL")
            activate(value)
            do { try api.saveSession() } catch { notice = error.localizedDescription }
            await refreshProfile()
            if session != nil { Task { await refreshAll(includeProfile: false) } }
        } catch { if authenticationRequest == requestID { handle(error) } }
    }
    func requestRegistrationCode(email: String) async throws -> RegistrationCodeResponse {
        guard !authenticating, session == nil else { throw ClientError.invalidResponse }
        let requestID = UUID(); authenticationRequest = requestID; authenticating = true; error = nil
        defer { if authenticationRequest == requestID { authenticating = false } }
        let endpoint = try Endpoint(endpointText)
        if client?.endpoint != endpoint { client?.close(); resetOwner(); client = APIClient(endpoint: endpoint); authenticationRequest = requestID; authenticating = true }
        guard let api = client else { throw ClientError.invalidEndpoint }
        let epoch = ownerEpoch
        let result: RegistrationCodeResponse = try await api.mutate("/api/session/registration-code", body: RegistrationCodeRequest(email: email))
        guard epoch == ownerEpoch, authenticationRequest == requestID else { throw CancellationError() }
        return result
    }
    func register(email: String, password: String, code: String) async {
        guard !authenticating, session == nil, let api = client else { return }
        let requestID = UUID(); authenticationRequest = requestID; authenticating = true; error = nil; let epoch = ownerEpoch
        defer { if authenticationRequest == requestID { authenticating = false } }
        do {
            let value: SessionResponse = try await api.mutate("/api/session/register", body: RegisterSessionRequest(email: email, password: password, verificationCode: code))
            guard epoch == ownerEpoch else { return }
            guard value.status == "active" else { throw ClientError.authenticationRequired }
            activate(value)
            do { try api.saveSession() } catch { notice = error.localizedDescription }
            await refreshProfile()
            if session != nil { Task { await refreshAll(includeProfile: false) } }
        } catch { if epoch == ownerEpoch { handle(error) } }
    }
    private func activate(_ value: SessionResponse) {
        if session?.user.userId != value.user.userId { resetOwner() }
        session = value
        knowledge.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        research.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        knowledge.configure(api: client, ownerId: value.user.userId)
        research.configure(api: client, ownerId: value.user.userId)
        workspace.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        workspace.onTaskEstablished = { [weak self] taskId, conversationId in self?.openResearchWorkspace(taskId: taskId, conversationId: conversationId) }
        workspace.configure(api: client, ownerId: value.user.userId)
        memory.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        memory.configure(api: client, ownerId: value.user.userId)
        accountManagement.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        accountManagement.onAccountClosed = { [weak self] in self?.invalidateOwnerSession() }
        accountManagement.onPreferencesChanged = { [weak self] preferences in self?.account?.preferences = preferences }
        accountManagement.onCreditsChanged = { [weak self] credits in self?.credits = credits }
        accountManagement.configure(api: client, ownerId: value.user.userId)
        welcome.onAuthenticationRequired = { [weak self] in self?.handleAuth(ClientError.authenticationRequired) }
        welcome.onProfileChanged = { [weak self] profile in self?.profile = profile }
        welcome.configure(api: client, ownerId: value.user.userId)
        research.onOpenWorkspace = { [weak self] taskId, conversationId in self?.openResearchWorkspace(taskId: taskId, conversationId: conversationId) }
        do { stopRecords = try client?.loadStopRecovery(ownerId: value.user.userId) ?? [] }
        catch { self.error = "待核对记录暂时无法读取：\(error.localizedDescription)" }
        if unresolvedStopCount > 0 { notice = "还有 \(unresolvedStopCount) 次停止结果待核对，可从提示栏重新检查。" }
    }
    func logout() async {
        guard let api = client, !saving else { return }
        saving = true
        let epoch = ownerEpoch
        await stop()
        guard epoch == ownerEpoch, session != nil else { if epoch == ownerEpoch { saving = false }; return }
        endStopWaiting()
        do {
            let _: LogoutSessionResponse = try await api.post("/api/session/logout")
            guard epoch == ownerEpoch else { return }
            invalidateOwnerSession()
        } catch { if epoch == ownerEpoch { handle(error) } }
        if epoch == ownerEpoch { saving = false }
    }
    private func resetOwner() {
        SettingsDraftMemory.reset()
        authenticationRequest = UUID(); workspaceNavigationIntent = UUID(); authenticating = false; saving = false; refreshing = false; revalidating = false
        knowledge.configure(api: nil, ownerId: nil); research.configure(api: nil, ownerId: nil); memory.configure(api: nil, ownerId: nil); workspace.configure(api: nil, ownerId: nil); accountManagement.configure(api: nil, ownerId: nil); welcome.configure(api: nil, ownerId: nil)
        welcomePresented = false
        accountMutationLedger.reset()
        workspaceChangeNeedsConfirmation = false; pendingWorkspaceSwitch = nil
        agentDraftPreview = nil; selectedCitation = nil; selectedToolStep = nil; libraryChatActive = false; selectedReferenceKnowledgeBaseId = nil
        clearAttachments(); workspaceTaskId = nil; workspaceDocumentId = nil; workspaceDocumentVersion = nil
        companionTab = nil; subscription = nil; subscriptionSummary = "正在读取套餐…"
        ownerEpoch = UUID(); navigationEpoch = UUID(); runGeneration = UUID()
        streamTask?.cancel(); conversationTask?.cancel(); stopTask?.cancel(); stopTask = nil; stopConfirmation = nil; stopGeneration = UUID()
        stopRecords = []; stopRecoveryTurn = nil
        session = nil; account = nil; credits = nil; sessions = []; profile = nil; catalog = nil; modelCatalogStatus = "loading"
        conversations = []; conversation = nil; pending = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; composerMode = "standard"; webSearchEnabled = true; researchPanelOpen = false; pendingConversationId = nil; composer = ""; modelId = ""; effort = ""
        running = false; stopping = false; loadingConversation = false; route = .home
        historyError = nil; accountError = nil; profileError = nil; error = nil; notice = nil
    }
    func revalidateSession() async {
        guard !booting, session != nil, !revalidating, let api = client else { return }
        let epoch = ownerEpoch; revalidating = true; defer { if epoch == ownerEpoch { revalidating = false } }
        do {
            let value: SessionResponse = try await api.get("/api/session")
            guard epoch == ownerEpoch else { return }
            guard value.status == "active", value.user.userId == session?.user.userId else { throw ClientError.authenticationRequired }
            session = value
        } catch { if epoch == ownerEpoch { handle(error) } }
    }
    func refreshAll(includeProfile: Bool = true) async {
        guard session != nil else { return }; let epoch = ownerEpoch
        refreshing = true; defer { if epoch == ownerEpoch { refreshing = false } }
        async let models: Void = refreshModels()
        async let history: Void = refreshHistory()
        async let account: Void = refreshAccount()
        async let graph: Void = knowledge.loadGraph()
        async let projects: Void = research.load()
        if includeProfile { await refreshProfile() }
        _ = await (models, history, account, graph, projects)
    }
    func refreshModels() async {
        guard let api = client, session != nil else { return }
        let epoch = ownerEpoch; modelCatalogStatus = "loading"
        do {
            let value: AgentModelCatalogResponse = try await api.get("/api/agent/models")
            guard epoch == ownerEpoch else { return }
            guard ["mock", "base", "sft"].contains(value.runtimeMode), Set(value.items.map(\.modelId)).count == value.items.count,
                  value.items.allSatisfy({ item in !item.modelId.isEmpty && !item.label.isEmpty && !item.reasoningEfforts.isEmpty && Set(item.reasoningEfforts).count == item.reasoningEfforts.count && item.reasoningEfforts.allSatisfy { ["none", "low", "medium", "high", "xhigh", "max"].contains($0) } && item.reasoningEfforts.contains(item.defaultReasoningEffort) }) else { throw ClientError.invalidResponse }
            catalog = value; modelCatalogStatus = value.items.isEmpty ? "unavailable" : "ready"
            if let key = modelPreferenceKey, let saved = UserDefaults.standard.dictionary(forKey: key), let id = saved["modelId"] as? String, let reason = saved["effort"] as? String, let choice = value.items.first(where: { $0.modelId == id }), choice.reasoningEfforts.contains(reason) { modelId = id; effort = reason }
            else if !value.items.contains(where: { $0.modelId == modelId }) { modelId = value.items.first?.modelId ?? "" }
            modelChanged()
        } catch { guard epoch == ownerEpoch else { return }; catalog = nil; modelCatalogStatus = "error"; handleAuth(error) }
    }
    func modelChanged() {
        guard let model = selectedModel else { effort = ""; return }
        if !model.reasoningEfforts.contains(effort) { effort = model.defaultReasoningEffort }
        saveModelPreference()
    }
    private var modelPreferenceKey: String? {
        guard let owner = session?.user.userId, let origin = client?.endpoint.origin.absoluteString else { return nil }
        return "EVERPLAIN_MODEL.\(origin).\(owner)"
    }
    private func saveModelPreference() {
        guard modelCatalogStatus == "ready", let model = selectedModel, model.reasoningEfforts.contains(effort), let key = modelPreferenceKey else { return }
        UserDefaults.standard.set(["modelId": model.modelId, "effort": effort], forKey: key)
    }
    func refreshHistory() async {
        guard let api = client, session != nil else { return }
        let epoch = ownerEpoch
        do {
            let value: AgentConversationListResponse = try await api.get("/api/agent/conversations")
            guard epoch == ownerEpoch else { return }
            conversations = value.items; historyError = nil
        } catch { guard epoch == ownerEpoch else { return }; historyError = error.localizedDescription; handleAuth(error) }
    }
    func prepareLibraryDiscussion(_ libraryId: String?) {
        guard let libraryId else {
            libraryChatActive = false
            let key = pending?.key
            if running { Task { guard route == .library, pending?.key == key else { return }; await stop() } }
            return
        }
        guard !libraryChatActive || selectedReferenceKnowledgeBaseId != libraryId else { return }
        let epoch = ownerEpoch, navigation = UUID(); navigationEpoch = navigation; loadingConversation = true
        clearRetainedTurns()
        Task {
            guard epoch == ownerEpoch, navigation == navigationEpoch else { return }
            if running { await stop() }
            guard epoch == ownerEpoch, navigation == navigationEpoch, route == .library else { return }
            endStopWaiting(); conversationTask?.cancel(); loadingConversation = false
            conversation = nil; pending = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; pendingConversationId = nil
            composer = ""; clearAttachments(); selectedReferenceKnowledgeBaseId = libraryId; libraryChatActive = true; focusComposer = UUID()
        }
    }
    func openLibraryChat(_ libraryId: String?) {
        let epoch = ownerEpoch
        Task { await navigate(.chat, newChat: true); guard epoch == ownerEpoch, route == .chat else { return }; selectedReferenceKnowledgeBaseId = libraryId }
    }
    func openLibraryImport() {
        Task { await navigate(.library); knowledge.showAdd(source: .extensionGuide) }
    }
    func openResearchWorkspace(taskId: String?, conversationId: String?) {
        if workspace.hasUnsavedChanges && workspace.taskId != taskId {
            pendingWorkspaceSwitch = (taskId, conversationId); workspaceChangeNeedsConfirmation = true; return
        }
        guard session != nil else { return }
        let intent = UUID(); workspaceNavigationIntent = intent; loadingConversation = true
        clearRetainedTurns()
        workspaceTaskId = taskId; workspaceDocumentId = nil; workspaceDocumentVersion = nil
        if let conversationId { openConversation(conversationId, destination: .workspace) }
        else {
            let epoch = ownerEpoch
            Task {
                guard epoch == ownerEpoch, intent == workspaceNavigationIntent else { return }
                await navigate(.workspace, newChat: true)
                guard epoch == ownerEpoch, intent == workspaceNavigationIntent, route == .workspace else { return }
                workspaceTaskId = taskId; loadingConversation = false
            }
        }
    }
    func confirmWorkspaceChange() {
        guard let target = pendingWorkspaceSwitch else { workspaceChangeNeedsConfirmation = false; return }
        pendingWorkspaceSwitch = nil; workspaceChangeNeedsConfirmation = false; workspace.discardUnsavedChanges()
        openResearchWorkspace(taskId: target.0, conversationId: target.1)
    }
    func cancelWorkspaceChange() { pendingWorkspaceSwitch = nil; workspaceChangeNeedsConfirmation = false }
    func chooseResearchStartFiles() {
        guard !materialUploading else { return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = ResearchStore.supportedExtensions.compactMap { UTType(filenameExtension: $0) }
        let epoch = ownerEpoch; let navigation = navigationEpoch
        panel.begin { [weak self] result in
            guard result == .OK else { return }
            Task { @MainActor in
                guard let self, epoch == self.ownerEpoch, navigation == self.navigationEpoch, self.route == .workspace else { return }
                self.materialUploading = true
                let target = await self.research.uploadFiles(panel.urls, taskId: self.workspaceTaskId)
                guard epoch == self.ownerEpoch, navigation == self.navigationEpoch else { return }
                self.materialUploading = false
                if let target { self.workspaceTaskId = target }
                if let message = self.research.materialError { self.error = message }
            }
        }
    }
    func openMaterialPicker() {
        guard !running, !materialUploading, let api = client else { return }
        let epoch = ownerEpoch; let navigation = navigationEpoch
        materialPickerOpen = true; materialPickerLoading = true
        Task {
            defer { if epoch == ownerEpoch, navigation == navigationEpoch { materialPickerLoading = false } }
            do {
                let value: AgentMaterialListResponse = try await api.get("/api/agent/materials", query: ["limit": "100", "offset": "0"])
                guard epoch == ownerEpoch, navigation == navigationEpoch else { return }; availableMaterials = value.items
            } catch { if epoch == ownerEpoch, navigation == navigationEpoch { materialPickerOpen = false; handle(error) } }
        }
    }
    func toggleComposerMaterial(_ material: ResearchMaterialResponse) {
        guard !running, !materialUploading, material.status == "ready" else { return }
        if attachedMaterials.contains(where: { $0.materialId == material.materialId }) { removeComposerAttachment(id: material.materialId) }
        else if attachedMaterials.count < 20 { attachedMaterials.append(material) }
        else { error = "每轮最多附加 20 份研究材料。" }
    }
    func removeComposerAttachment(id: String) { guard !running, !materialUploading else { return }; attachedMaterials.removeAll { $0.materialId == id } }
    func chooseComposerFiles() {
        guard !running, !materialUploading else { return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = ResearchStore.supportedExtensions.compactMap { UTType(filenameExtension: $0) }
        let epoch = ownerEpoch; let navigation = navigationEpoch
        panel.begin { [weak self] result in
            guard result == .OK else { return }
            Task { @MainActor in guard let self, epoch == self.ownerEpoch, navigation == self.navigationEpoch else { return }; await self.uploadComposerFiles(panel.urls) }
        }
    }
    private func uploadComposerFiles(_ urls: [URL]) async {
        guard !running, !materialUploading, !urls.isEmpty, let api = client else { return }
        guard attachedMaterials.count + urls.count <= 20 else { error = "每轮最多附加 20 份研究材料。"; return }
        let epoch = ownerEpoch; let navigation = navigationEpoch; materialUploading = true; error = nil
        defer { if epoch == ownerEpoch, navigation == navigationEpoch { materialUploading = false } }
        do {
            var destination = route == .home ? uploadTaskId : (route == .workspace ? workspaceTaskId : conversation?.taskId) ?? uploadTaskId
            if destination == nil {
                let context: AgentMaterialContextResponse = try await api.mutate("/api/agent/material-context", body: AgentMaterialContextRequest(conversationId: route == .home ? nil : conversation?.conversationId ?? pendingConversationId), key: materialContextKey)
                guard epoch == ownerEpoch, navigation == navigationEpoch else { return }
                pendingConversationId = context.conversationId; uploadTaskId = context.taskId; destination = context.taskId
            }
            guard let destination else { return }
            let values = try await research.uploadAttachmentBatch(urls: urls, taskId: destination, scope: materialContextKey)
            guard epoch == ownerEpoch, navigation == navigationEpoch else { return }
            for value in values {
                attachedMaterials.removeAll { $0.materialId == value.materialId }; attachedMaterials.append(value)
            }
            pollAttachments()
        } catch { if epoch == ownerEpoch, navigation == navigationEpoch { handle(error) } }
    }
    private func pollAttachments() {
        attachmentPollTask?.cancel()
        let epoch = ownerEpoch; let navigation = navigationEpoch
        attachmentPollTask = Task {
            while epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled {
                let waiting = attachedMaterials.filter { ["queued", "processing"].contains($0.ingestionStatus ?? "") }
                if waiting.isEmpty { return }
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                for item in waiting {
                    do {
                        let value = try await research.readMaterial(taskId: item.taskId, materialId: item.materialId)
                        guard epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled else { return }
                        if let index = attachedMaterials.firstIndex(where: { $0.materialId == value.materialId }) { attachedMaterials[index] = value }
                    } catch { if epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled { handle(error) }; return }
                }
            }
        }
    }
    private func clearAttachments() {
        attachmentPollTask?.cancel(); attachmentPollTask = nil; attachedMaterials = []; availableMaterials = []
        materialUploading = false; materialPickerOpen = false; materialPickerLoading = false; uploadTaskId = nil; materialContextKey = UUID().uuidString
    }
    var panelCitations: [AgentCitationResponse] {
        if let citation = selectedCitation {
            if let turn = unfinishedTurns.last(where: { $0.citations?.contains(where: { $0.citationId == citation.citationId }) == true }) { return turn.citations ?? [] }
            if let turn = conversation?.turns.last(where: { $0.assistant.citations?.contains(where: { $0.citationId == citation.citationId }) == true }) { return turn.assistant.citations ?? [] }
        }
        return pending?.citations ?? conversation?.turns.last?.assistant.citations ?? []
    }
    var panelToolSteps: [NativeToolStep] { pending?.toolSteps ?? NativeToolStep.fromTraces(conversation?.turns.last?.toolTraces ?? []) }
    func selectCitation(_ citation: AgentCitationResponse) { selectedCitation = citation; selectedToolStep = nil; researchPanelOpen = true }
    func selectToolStep(_ step: NativeToolStep) { selectedToolStep = step; selectedCitation = nil; researchPanelOpen = true }
    func openCitationSource(_ citation: AgentCitationResponse) async {
        guard citation.deleted != true else { return }; let epoch = ownerEpoch
        if let libraryId = citation.knowledgeBaseId, let documentId = citation.materialId {
            await navigate(.library)
            guard epoch == ownerEpoch, route == .library else { return }
            selectedCitation = nil; researchPanelOpen = false
            await knowledge.openDocument(libraryId: libraryId, documentId: documentId, segmentId: citation.segmentId)
        } else if let materialId = citation.materialId {
            let sourceTaskId: String?
            if case .string(let id) = citation.locator?["task_id"] { sourceTaskId = id } else { sourceTaskId = workspaceTaskId ?? conversation?.taskId ?? uploadTaskId }
            guard let sourceTaskId else { notice = "这条来源未返回可打开的原文位置。"; return }
            do {
                let material = try await research.readMaterial(taskId: sourceTaskId, materialId: materialId, parseId: citation.parseId)
                guard epoch == ownerEpoch else { return }
                research.selectedMaterial = material; selectedCitation = nil; researchPanelOpen = false
                openResearchWorkspace(taskId: sourceTaskId, conversationId: conversation?.taskId == sourceTaskId ? conversation?.conversationId : nil)
            } catch { if epoch == ownerEpoch { handle(error) } }
        }
    }
    func openCompanion(_ tab: String) { guard session != nil else { return }; companionTab = tab }
    func resetCompanion() {
        guard !saving else { return }
        welcome.restart(with: profile); welcomePresented = true; route = .home; companionTab = nil
    }
    func finishWelcomeSetup() {
        welcomePresented = false; route = .graph
        Task { await knowledge.loadGraph() }
    }

    func openUsage() async { await navigate(.account); settingsSection = .usage }
    func refreshAccountMenu() async {
        await refreshAccount()
        guard let api = client, session != nil else { return }
        let epoch = ownerEpoch
        do {
            let value: SubscriptionOverviewResponse = try await api.get("/api/subscription")
            guard epoch == ownerEpoch else { return }; subscription = value
            if let current = value.subscription {
                let title = value.plans.first(where: { $0.id == current.planId })?.name ?? "套餐信息待确认"
                let state = ["trialing":"试用中", "past_due":"付款逾期", "canceled":"已取消", "unpaid":"未付款", "incomplete":"待完成付款", "incomplete_expired":"已过期", "paused":"已暂停"][current.status]
                subscriptionSummary = title + (current.status == "active" ? "" : " · " + (state ?? "状态待确认"))
            } else { subscriptionSummary = "未订阅" }
        } catch { guard epoch == ownerEpoch else { return }; subscriptionSummary = "套餐信息暂不可用"; handleAuth(error) }
    }
    func refreshProfile() async {
        guard let api = client, session != nil else { return }
        let epoch = ownerEpoch
        do {
            let value: AgentProfileResponse = try await api.get("/api/agent-profile")
            guard epoch == ownerEpoch else { return }; profile = value; profileError = nil
            if value.setupCompleted != true { welcomePresented = true }
        } catch { guard epoch == ownerEpoch else { return }; profileError = error.localizedDescription; handleAuth(error) }
    }
    func refreshAccount() async {
        guard let api = client, let userId = session?.user.userId else { return }
        let epoch = ownerEpoch
        do {
            let value: AccountResponse = try await api.get("/api/account")
            guard epoch == ownerEpoch else { return }
            guard value.userId == userId else { invalidateOwnerSession(); throw ClientError.authenticationRequired }
            account = value; setInterfaceLocale(value.preferences.locale); accountError = nil
            let quota: CreditSummaryResponse = try await api.get("/api/account/credits")
            guard epoch == ownerEpoch else { return }; credits = quota
            let devices: AccountSessionPageResponse = try await api.get("/api/account/sessions")
            guard epoch == ownerEpoch else { return }; sessions = devices.items
        } catch { guard epoch == ownerEpoch else { return }; accountError = error.localizedDescription; handleAuth(error) }
    }
    func navigate(_ next: Route, newChat: Bool = false) async {
        guard session != nil else { return }
        guard !saving || (route != .account && route != .agent) else { return }
        if next == .account || next == .agent {
            if route != .account && route != .agent { settingsBackground = route }
            settingsSection = next == .agent ? .agent : .profile
            route = next; companionTab = nil
            return
        }
        let epoch = ownerEpoch
        let navigation = UUID(); navigationEpoch = navigation; conversationTask?.cancel()
        if running { await stop() }
        guard epoch == ownerEpoch, navigation == navigationEpoch else { return }
        loadingConversation = false
        route = next; error = nil; companionTab = nil
        guard epoch == ownerEpoch, navigation == navigationEpoch else { return }
        if newChat || next == .home { endStopWaiting(); clearAttachments(); selectedReferenceKnowledgeBaseId = nil; conversation = nil; pending = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; pendingConversationId = nil; composer = ""; composerMode = "standard" }
        if newChat && next == .workspace { workspaceTaskId = nil; workspaceDocumentId = nil; workspaceDocumentVersion = nil }
        if next == .home || next == .chat || next == .workspace { focusComposer = UUID() }
    }
    func openConversation(_ id: String, destination: Route = .chat) {
        guard session != nil else { return }
        conversationTask?.cancel()
        let navigation = UUID(); navigationEpoch = navigation; loadingConversation = true
        clearRetainedTurns()
        conversationTask = Task {
            if running { await stop() }
            guard let api = client, session != nil, navigation == navigationEpoch else { return }
            let epoch = ownerEpoch
            loadingConversation = true; error = nil; route = destination; clearAttachments()
            // Clear previous content immediately; don't show another conversation during load.
            conversation = nil; pending = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; pendingConversationId = nil; composer = ""
            defer { if navigation == navigationEpoch { loadingConversation = false } }
            do {
                let value: AgentConversationResponse = try await api.get("/api/agent/conversations/\(id)")
                guard epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled else { return }
                mergeCanonicalConversation(value, selectRecovery: true)
                if destination == .workspace { workspaceTaskId = value.taskId ?? workspaceTaskId }
                if let pending {
                    composerMode = pending.request.mode ?? "standard"
                    notice = pending.status == "running" ? "上次的回答仍在生成。可停止，或重新连接读取结果。" : "上次的回答尚未完成，可以重试。"
                    if isCurrentStopPending { notice = "本轮已请求停止，结果仍待核对。可使用提示栏重新检查。" }
                }
                focusComposer = UUID()
            } catch { if epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled { handle(error) } }
        }
    }
    func send() {
        guard canSend else { return }
        let message = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = AgentTurnRequest(conversationId: route == .home ? (uploadTaskId == nil ? nil : pendingConversationId) : (conversation?.conversationId ?? pendingConversationId),
                                       documentId: route == .workspace ? workspaceDocumentId : nil, documentVersion: route == .workspace ? workspaceDocumentVersion : nil,
                                       materialIds: attachedMaterials.map(\.materialId), message: message, mode: composerMode, modelId: selectedModel?.modelId,
                                       reasoningEffort: selectedModel?.reasoningEfforts.contains(effort) == true ? effort : nil, referenceKnowledgeBaseId: route == .home ? nil : conversation?.referenceKnowledgeBaseId ?? selectedReferenceKnowledgeBaseId,
                                       sectionId: route == .workspace && workspaceDocumentId != nil ? workspace.selectedSectionId : nil, taskId: route == .workspace ? workspaceTaskId : nil, theoryPlanId: route == .workspace ? workspace.theoryPlan?.theoryPlanId : nil, webSearch: webSearchEnabled, workspace: route == .workspace && workspaceTaskId != nil ? "research" : "agent")
        if route == .home { conversation = nil; pending = nil; clearRetainedTurns(); pendingConversationId = request.conversationId }
        retainUnfinishedTurn(pending)
        endStopWaiting()
        route = route == .workspace ? .workspace : route == .library && libraryChatActive ? .library : .chat; composer = ""; completedPendingTurn = nil; completedTurnId = nil; pending = PendingTurn(request: request)
        beginStream()
    }
    func setComposerMode(_ mode: String) {
        guard !running, !isCurrentStopPending, ["standard", "deep_research"].contains(mode) else { return }
        composerMode = mode
    }
    func continueDeepResearch(_ action: String, selection: String? = nil) {
        guard !running, !loadingConversation, !isCurrentStopPending, session != nil, let previous = pending,
              !unfinishedTurns.contains(where: { $0.status == "running" }), previous.runId != nil, ["awaiting_clarification", "awaiting_plan_confirmation"].contains(previous.status),
              ["clarify", "confirm", "skip"].contains(action) else { return }
        if action == "clarify", selection?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false { return }
        do {
            pending = try previous.researchContinuation(action: action, selection: selection, conversationId: pendingConversationId)
        } catch { handle(error); return }
        composerMode = "deep_research"
        beginStream()
    }
    private func restoredTurn(_ recovery: AgentRunRecoveryResponse) -> PendingTurn {
        var turn = PendingTurn(request: recovery.request, key: recovery.idempotencyKey, runId: recovery.runId)
        turn.answer = recovery.partialAnswer; turn.status = recovery.status
        for item in recovery.toolSummary ?? [] {
            if item["kind"] == .string("deep_research_pending"),
               let bytes = try? JSONEncoder().encode(item),
               let event = try? JSONDecoder().decode(ResearchStreamEvent.self, from: bytes) {
                var waiting = event; waiting.state = recovery.status; waiting.event = "research_waiting"
                var progress = NativeResearchProgress(); progress.apply(waiting); turn.research = progress
            }
            if let bytes = try? JSONEncoder().encode(item),
               var event = try? JSONDecoder().decode(ToolStreamEvent.self, from: bytes) {
                event.phase = event.phase.map { $0.hasPrefix("tool_") ? $0 : "tool_" + $0 }
                turn.toolSteps = NativeToolStep.applying(event, to: turn.toolSteps ?? [])
            }
        }
        return turn
    }
    private func sameUnfinishedTurn(_ lhs: PendingTurn, _ rhs: PendingTurn) -> Bool {
        lhs.key == rhs.key || (lhs.runId != nil && lhs.runId == rhs.runId)
    }
    private func isCompleted(_ turn: PendingTurn) -> Bool {
        completedRequestKeys.contains(turn.key) || turn.runId.map { completedRunIds.contains($0) } == true
    }
    var unfinishedTurns: [PendingTurn] {
        var result: [PendingTurn] = []
        for turn in retainedUnfinishedTurns + (pending.map { [$0] } ?? []) where !isCompleted(turn) {
            if let index = result.firstIndex(where: { sameUnfinishedTurn($0, turn) }) { result[index] = turn }
            else { result.append(turn) }
        }
        return result
    }
    private func clearRetainedTurns() {
        retainedUnfinishedTurns = []; completedRequestKeys = []; completedRunIds = []; completedRunTurnIds = [:]
        selectedCitation = nil; selectedToolStep = nil
    }
    private func retainUnfinishedTurn(_ turn: PendingTurn?) {
        guard let turn, !isCompleted(turn) else { return }
        if let index = retainedUnfinishedTurns.firstIndex(where: { sameUnfinishedTurn($0, turn) }) { retainedUnfinishedTurns[index] = turn }
        else { retainedUnfinishedTurns.append(turn) }
    }
    private func markCompleted(_ turn: PendingTurn, turnId: String? = nil) {
        completedRequestKeys.insert(turn.key)
        if let runId = turn.runId { completedRunIds.insert(runId); if let turnId { completedRunTurnIds[runId] = turnId } }
        retainedUnfinishedTurns.removeAll { sameUnfinishedTurn($0, turn) }
        if pending.map({ sameUnfinishedTurn($0, turn) }) == true { pending = nil }
        let count = stopRecords.count
        stopRecords.removeAll { sameUnfinishedTurn($0.turn, turn) }
        if stopRecords.count != count { persistStopRecords() }
    }
    /// Canonical history is merged by request/run identity, never by question text.
    /// Locally retained data remains until the server proves the run completed.
    private func mergeCanonicalConversation(_ value: AgentConversationResponse, completed: PendingTurn? = nil, selectRecovery: Bool = false) {
        let selectedKey = pending?.key
        retainUnfinishedTurn(pending)
        if let completed { markCompleted(completed) }
        conversation = value; pendingConversationId = value.conversationId
        for recovery in value.unfinishedRuns ?? [] {
            let restored = restoredTurn(recovery)
            guard !isCompleted(restored) else { continue }
            // Preserve local citations/canvas information absent from the recovery DTO.
            var merged = restored
            if let previous = retainedUnfinishedTurns.first(where: { sameUnfinishedTurn($0, restored) }) {
                // An already-issued request is immutable across explicit retries.
                // Canonical recovery can add identity/progress, never rewrite it.
                merged = previous; merged.runId = restored.runId; merged.answer = restored.answer; merged.status = restored.status
                merged.toolSteps = restored.toolSteps ?? previous.toolSteps; merged.research = restored.research ?? previous.research
            }
            retainUnfinishedTurn(merged)
            if recovery.cancelRequested && recovery.status == "running" && !stopRecords.contains(where: { $0.turn.key == restored.key }) {
                let confirmation = StopConfirmation(requestKey: restored.key, runId: restored.runId, conversationId: value.conversationId)
                stopRecords.append(StopRecoveryRecord(confirmation: confirmation, turn: merged, localWaitEnded: true))
                persistStopRecords()
            }
        }
        // Encrypted stop records can contain a request absent from unfinished_runs,
        // including a response lost before the client learned its run identity.
        for record in stopRecords where record.confirmation.conversationId == value.conversationId {
            if !retainedUnfinishedTurns.contains(where: { sameUnfinishedTurn($0, record.turn) }) { retainUnfinishedTurn(record.turn) }
        }
        let selection = selectedKey.flatMap { key in retainedUnfinishedTurns.first(where: { $0.key == key }) }
            ?? (selectRecovery ? retainedUnfinishedTurns.first : nil)
        pending = selection
        if let selection { retainedUnfinishedTurns.removeAll { sameUnfinishedTurn($0, selection) } }
    }
    func isStopPending(for key: String) -> Bool {
        stopRecords.contains { $0.turn.key == key && $0.confirmation.isPending }
            || (stopConfirmation?.requestKey == key && stopConfirmation?.isPending == true)
    }
    func canRetryUnfinishedTurn(_ key: String) -> Bool {
        session != nil && !running && !loadingConversation && !isCurrentStopPending && !isStopPending(for: key)
            && !unfinishedTurns.contains { $0.key != key && $0.status == "running" }
            && unfinishedTurns.contains { $0.key == key && !$0.status.hasPrefix("awaiting_") }
    }
    /// Selecting a waiting research run only reveals its saved confirmation card.
    /// It does not dispatch a request or accept a research plan.
    @discardableResult func selectUnfinishedTurn(_ key: String) -> Bool {
        guard session != nil, !running, !loadingConversation,
              let selected = unfinishedTurns.first(where: { $0.key == key }) else { return false }
        if pending?.key != selected.key { retainUnfinishedTurn(pending) }
        retainedUnfinishedTurns.removeAll { sameUnfinishedTurn($0, selected) }
        pending = selected; composerMode = selected.request.mode ?? "standard"
        selectedCitation = nil; selectedToolStep = nil
        return true
    }
    /// Canonical turns do not carry run_id. The read-only lookup supplies the
    /// authoritative run_id -> turn_id relation; a failed lookup never guesses.
    private func reconcileCompletedRuns(_ api: APIClient, epoch: UUID, navigation: UUID) async {
        guard let current = conversation else { return }
        let conversationId = current.conversationId, generation = runGeneration
        let recoverableIds = Set((current.unfinishedRuns ?? []).map(\.runId))
        let candidates = unfinishedTurns.filter { $0.runId.map { !recoverableIds.contains($0) } ?? true }
            + (completedTurnId == nil ? (completedPendingTurn.map { [$0] } ?? []) : [])
        for candidate in candidates {
            guard epoch == ownerEpoch, navigation == navigationEpoch, generation == runGeneration, !running, !Task.isCancelled else { return }
            do {
                let lookup: AgentRunLookupResponse = try await api.get(EverplainEndpoint.lookupAgentRun, key: candidate.key)
                guard epoch == ownerEpoch, navigation == navigationEpoch, generation == runGeneration, !running, !Task.isCancelled,
                      conversation?.conversationId == conversationId else { return }
                guard lookup.idempotencyKey == candidate.key, candidate.runId == nil || lookup.runId == candidate.runId,
                      lookup.conversationId == conversationId, lookup.status == "completed", let turnId = lookup.turnId,
                      conversation?.turns.contains(where: { $0.turnId == turnId }) == true else { continue }
                var confirmed = candidate; confirmed.runId = lookup.runId
                markCompleted(confirmed, turnId: turnId)
                if stopConfirmation?.requestKey == candidate.key { settleStopFromTerminalEvent("completed") }
                if completedPendingTurn?.key == candidate.key {
                    completedTurnId = turnId
                    completedPendingTurn?.answer = conversation?.turns.first(where: { $0.turnId == turnId })?.assistant.content ?? candidate.answer
                }
            } catch {
                guard epoch == ownerEpoch, navigation == navigationEpoch, !Task.isCancelled else { return }
                handleAuth(error)
            }
        }
    }
    func refreshUnfinishedTurns() async {
        guard let api = client, session != nil, !running, !loadingConversation,
              let id = conversation?.conversationId ?? pendingConversationId else { return }
        let epoch = ownerEpoch, navigation = navigationEpoch, generation = runGeneration
        do {
            let current: AgentConversationResponse = try await api.get("/api/agent/conversations/\(id)")
            guard epoch == ownerEpoch, navigation == navigationEpoch, generation == runGeneration, !running, !Task.isCancelled else { return }
            mergeCanonicalConversation(current)
            await reconcileCompletedRuns(api, epoch: epoch, navigation: navigation)
        } catch { if epoch == ownerEpoch, navigation == navigationEpoch, generation == runGeneration { handle(error) } }
    }
    func regenerateTurn(question: String) {
        guard !running, !isCurrentStopPending, !materialUploading, session != nil, !question.isEmpty else { return }
        let draft = composer
        composer = question
        send()
        composer = draft
    }
    func toggleResearchPanel() { researchPanelOpen.toggle() }
    func retry(_ key: String) {
        guard canRetryUnfinishedTurn(key), selectUnfinishedTurn(key) else { return }
        endStopWaiting()
        pending?.answer = ""; pending?.status = "thinking"
        pending?.toolSteps = nil; pending?.citations = nil; pending?.canvasPatches = nil
        beginStream()
    }
    private func beginStream() {
        guard let api = client, let request = pending else { return }
        streamTask?.cancel()
        let generation = UUID(); runGeneration = generation
        let epoch = ownerEpoch
        running = true; streamDispatched = false; error = nil; notice = nil
        streamTask = Task {
            guard !Task.isCancelled, generation == runGeneration, epoch == ownerEpoch else { return }
            streamDispatched = true
            defer { if generation == runGeneration { running = false } }
            do {
                for try await event in api.stream(request) {
                    guard epoch == ownerEpoch, generation == runGeneration, !Task.isCancelled else { return }
                    switch event {
                    case .status(let status): if !stopping { pending?.status = status }
                    case .started(let conversationId, let runId, _, let mode):
                        pending?.runId = runId; pendingConversationId = conversationId
                        if stopping {
                            try stopConfirmation?.bind(runId: runId, conversationId: conversationId)
                            runGeneration = UUID(); streamTask?.cancel(); running = false
                            launchStopReconciliation()
                            return
                        }
                        if mode == "mock" { error = "服务正在使用预览模式，当前回答不是真实模型结果。" }
                    case .delta(let text): pending?.answer += text
                    case .completed(let value):
                        let completed = pending
                        completedPendingTurn = completed; completedPendingTurn?.status = "completed"; completedTurnId = nil
                        mergeCanonicalConversation(value, completed: completed)
                        if (route == .workspace || ((route == .account || route == .agent) && settingsBackground == .workspace)), let taskId = value.taskId { workspaceTaskId = taskId }
                        running = false
                        settleStopFromTerminalEvent("completed")
                        await reconcileCompletedRuns(api, epoch: epoch, navigation: navigationEpoch)
                        await refreshHistory(); await refreshAccount()
                    case .failed(_, let message):
                        error = message; pending?.status = stopping ? "stopping" : "failed"
                        if stopping { stopConfirmation?.recordFailure(message); launchStopReconciliation() }
                    case .interrupted(let message): notice = message; pending?.status = "interrupted"; settleStopFromTerminalEvent("interrupted")
                    case .research(let event):
                        var progress = pending?.research ?? NativeResearchProgress(); progress.apply(event); pending?.research = progress
                    case .researchWaiting(let event):
                        pending?.runId = event.runId; pending?.status = event.state ?? "awaiting_plan_confirmation"
                        var progress = pending?.research ?? NativeResearchProgress(); progress.apply(event); pending?.research = progress
                        if stopping { launchStopReconciliation() }
                    case .tool(let event):
                        pending?.toolSteps = NativeToolStep.applying(event, to: pending?.toolSteps ?? [])
                        if !stopping { pending?.status = event.phase == "tool_started" ? "working" : "thinking" }
                    case .citation(let citation):
                        var citations = pending?.citations ?? []
                        if !citations.contains(where: { $0.citationId == citation.citationId }) { citations.append(citation) }
                        pending?.citations = citations
                    case .canvasPatch(let patch): pending?.canvasPatches = (pending?.canvasPatches ?? []) + [patch]
                    case .ignored: break
                    }
                }
            } catch {
                guard epoch == ownerEpoch, generation == runGeneration, !Task.isCancelled else { return }
                if stopping {
                    stopConfirmation?.recordFailure(error.localizedDescription)
                    pending?.status = "stopping"
                    notice = "连接中断，停止尚未确认。正在核对服务器状态。"
                    launchStopReconciliation()
                } else { pending?.status = "interrupted"; handle(error) }
            }
        }
    }
    func stop() async {
        guard client != nil, let pending, running || pending.runId != nil else { return }
        if stopConfirmation?.isPending == true, stopConfirmation?.requestKey == pending.key { launchStopReconciliation(); return }
        endStopWaiting()
        stopConfirmation = StopConfirmation(requestKey: pending.key, runId: pending.runId, conversationId: pendingConversationId ?? pending.request.conversationId)
        stopRecoveryTurn = pending
        stopping = true
        self.pending?.status = "stopping"
        retainStopRecord()
        notice = "正在请求停止；服务器确认前会保留这轮对话。"
        // A task that has never dispatched is the one case where local cancellation
        // proves no backend work exists. Already-dispatched unknowns require lookup.
        let neverDispatched = !streamDispatched && pending.runId == nil
        runGeneration = UUID(); streamTask?.cancel(); running = false
        if neverDispatched {
            do { try stopConfirmation?.confirmNeverDispatched() } catch { handle(error) }
            stopping = stopConfirmation?.isPending ?? true
            removeConfirmedStopRecord()
            self.pending?.status = "interrupted"
            notice = "消息尚未发往服务器，已取消。"
            return
        }
        // Closing transport promptly is a cooperative server cancellation. The
        // owner-scoped read-only lookup recovers identity without replaying the turn.
        launchStopReconciliation()
    }
    private func settleStopFromTerminalEvent(_ status: String) {
        guard stopConfirmation != nil else { return }
        stopConfirmation?.observeTerminalEvent(status)
        if stopConfirmation?.isPending == false {
            removeConfirmedStopRecord()
            stopping = false; stopTask?.cancel(); stopTask = nil
            notice = status == "completed" ? "回答已在停止确认前完成。" : "服务器已确认本轮结束。"
        }
    }
    private func launchStopReconciliation() {
        guard stopTask == nil, stopConfirmation?.isPending == true, let api = client else { return }
        let epoch = ownerEpoch
        let confirmationGeneration = UUID(); stopGeneration = confirmationGeneration
        stopTask = Task {
            defer { if epoch == ownerEpoch, stopGeneration == confirmationGeneration { stopTask = nil } }
            var delay: UInt64 = 1_500_000_000
            while !Task.isCancelled, epoch == ownerEpoch, stopConfirmation?.isPending == true {
                do {
                    if stopConfirmation?.runId == nil { try await discoverStoppedRun(api, epoch: epoch) }
                    guard epoch == ownerEpoch, !Task.isCancelled else { return }
                    if stopConfirmation?.isPending == false { await finishConfirmedStop(api, epoch: epoch); return }
                    if let runId = stopConfirmation?.runId, let key = stopConfirmation?.idempotencyKey {
                        let result: AgentRunStopResponse = try await api.post("/api/agent/runs/\(runId)/stop", key: key)
                        guard epoch == ownerEpoch, !Task.isCancelled else { return }
                        try stopConfirmation?.observe(result)
                        retainStopRecord()
                        if stopConfirmation?.isPending == false {
                            await finishConfirmedStop(api, epoch: epoch)
                            return
                        }
                        if pending?.key == stopConfirmation?.requestKey { pending?.status = "stopping" }
                        // Existing canonical-history reads recover expired worker leases
                        // and settle their holds. Lookup itself is intentionally read-only.
                        if let id = stopConfirmation?.conversationId {
                            let _: AgentConversationResponse = try await api.get("/api/agent/conversations/\(id)")
                            try await discoverStoppedRun(api, epoch: epoch)
                            if stopConfirmation?.isPending == false { await finishConfirmedStop(api, epoch: epoch); return }
                        }
                        notice = "停止请求已受理，服务器仍在收尾。可以离开页面，记录不会丢失。"
                        delay = 1_500_000_000
                    } else {
                        notice = "尚未找到本轮运行标识，停止仍待确认；不会重新启动回答。"
                        delay = min(delay * 2, 15_000_000_000)
                    }
                } catch {
                    guard epoch == ownerEpoch, !Task.isCancelled else { return }
                    if error as? ClientError == .authenticationRequired { handle(error); return }
                    stopConfirmation?.recordFailure(error.localizedDescription)
                    if pending?.key == stopConfirmation?.requestKey { pending?.status = "stopping" }
                    retainStopRecord()
                    stopping = false
                    notice = "停止结果未知：\(error.localizedDescription) 原请求已保留，可以稍后重新核对；不会自动重新生成。"
                    return
                }
                do { try await Task.sleep(nanoseconds: delay) } catch { return }
            }
        }
    }
    private func discoverStoppedRun(_ api: APIClient, epoch: UUID) async throws {
        try Task.checkCancellation()
        guard let stop = stopConfirmation else { return }
        // A read-only lookup never replays the model request. A 404 is provisional
        // and cannot be promoted to successful cancellation or permit a new turn.
        let lookup: AgentRunLookupResponse
        do {
            lookup = try await api.get(EverplainEndpoint.lookupAgentRun, key: stop.requestKey)
        } catch let error as ClientError {
            if case .server(404, _, _) = error {
                throw ClientError.server(status: 404, code: "run_lookup_unavailable",
                    message: "运行查询接口返回 HTTP 404，可能尚未部署或暂未找到本轮运行；无法确认服务器是否已停止。")
            }
            throw error
        }
        guard epoch == ownerEpoch, !Task.isCancelled else { return }
        try stopConfirmation?.observeLookup(lookup)
        stopRecoveryTurn?.runId = lookup.runId
        if !lookup.partialAnswer.isEmpty { stopRecoveryTurn?.answer = lookup.partialAnswer }
        if pending?.key == stop.requestKey {
            pending?.runId = lookup.runId; pendingConversationId = lookup.conversationId
            if !lookup.partialAnswer.isEmpty { pending?.answer = lookup.partialAnswer }
        }
        retainStopRecord()
    }
    private func finishConfirmedStop(_ api: APIClient, epoch: UUID) async {
        guard let confirmation = stopConfirmation, !confirmation.isPending, !Task.isCancelled else { return }
        let confirmationGeneration = stopGeneration
        let showingStoppedTurn = pending?.key == confirmation.requestKey
        if showingStoppedTurn { pending?.status = confirmation.terminalStatus ?? confirmation.quiescentStatus ?? "interrupted" }
        if confirmation.quiescentStatus != nil {
            notice = "本轮正在等待研究确认或补充信息，当前没有生成中的回答。记录已保留，可明确继续研究，也可新建另一对话。"
        } else { notice = confirmation.terminalStatus == "completed" ? "回答已在停止确认前完成。" : "服务器已确认本轮结束，当前内容已保留。" }
        if let id = confirmation.conversationId {
            do {
                let current: AgentConversationResponse = try await api.get("/api/agent/conversations/\(id)")
                guard epoch == ownerEpoch, confirmationGeneration == stopGeneration, !Task.isCancelled else { return }
                if (conversation?.conversationId ?? pendingConversationId) == id {
                    if confirmation.terminalStatus == "completed", let stopped = stopRecoveryTurn { markCompleted(stopped) }
                    mergeCanonicalConversation(current)
                    if showingStoppedTurn, let pending { composerMode = pending.request.mode ?? "standard" }
                    await reconcileCompletedRuns(api, epoch: epoch, navigation: navigationEpoch)
                }
            } catch { if epoch == ownerEpoch { self.error = error.localizedDescription } }
        }
        guard epoch == ownerEpoch, confirmationGeneration == stopGeneration, !Task.isCancelled else { return }
        removeConfirmedStopRecord()
        stopping = false
        await refreshHistory()
    }
    private func retainStopRecord(localWaitEnded: Bool = false) {
        guard let confirmation = stopConfirmation, let turn = stopRecoveryTurn else { return }
        let record = StopRecoveryRecord(confirmation: confirmation, turn: turn, localWaitEnded: localWaitEnded)
        if let index = stopRecords.firstIndex(where: { $0.turn.key == turn.key }) { stopRecords[index] = record }
        else { stopRecords.append(record) }
        persistStopRecords()
    }
    private func persistStopRecords() {
        guard let owner = session?.user.userId, let api = client else { return }
        do { try api.saveStopRecovery(stopRecords, ownerId: owner) }
        catch { self.error = error.localizedDescription }
    }
    private func removeConfirmedStopRecord() {
        guard let confirmation = stopConfirmation, !confirmation.isPending else { return }
        stopRecords.removeAll { $0.turn.key == confirmation.requestKey }
        persistStopRecords()
    }
    /// Ends local waiting only. The unresolved key/body remain encrypted for this owner.
    func endStopWaiting() {
        if stopConfirmation?.isPending == true { retainStopRecord(localWaitEnded: true) }
        stopTask?.cancel(); stopTask = nil; stopGeneration = UUID()
        stopping = false; stopConfirmation = nil; stopRecoveryTurn = nil
    }
    func recheckStop(_ key: String) {
        guard let record = stopRecords.first(where: { $0.turn.key == key }), !running else { return }
        endStopWaiting()
        stopConfirmation = record.confirmation; stopRecoveryTurn = record.turn
        stopping = true; retainStopRecord()
        launchStopReconciliation()
    }
    func showStopRecord(_ key: String) {
        guard let record = stopRecords.first(where: { $0.turn.key == key }), !running else { return }
        endStopWaiting(); conversationTask?.cancel(); navigationEpoch = UUID(); loadingConversation = false
        let sameConversation = record.confirmation.conversationId != nil && record.confirmation.conversationId == (conversation?.conversationId ?? pendingConversationId)
        if sameConversation { retainUnfinishedTurn(pending) }
        else { conversation = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; clearAttachments() }
        route = .chat; pending = record.turn
        retainedUnfinishedTurns.removeAll { sameUnfinishedTurn($0, record.turn) }
        pending?.status = "stopping"; pendingConversationId = record.confirmation.conversationId
        notice = "这轮停止结果仍待核对。此处仅显示保留记录，不会重新发送。"
    }
    func changePassword(current: String, new: String, revokeOtherSessions: Bool) async -> Bool {
        guard let api = client, session != nil, !saving else { return false }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let body = ChangePasswordRequest(currentPassword: current, newPassword: new, revokeOtherSessions: revokeOtherSessions)
            let key = try accountMutationLedger.key(for: "change-password", body: body)
            let _: ChangePasswordResponse = try await api.mutate("/api/account/password/change", body: body, key: key)
            guard epoch == ownerEpoch else { return false }
            accountMutationLedger.complete("change-password"); notice = "密码已更新。"; accountError = nil; await refreshAccount(); return true
        } catch { if epoch == ownerEpoch { accountError = error.localizedDescription; handleAuth(error) }; return false }
    }
    func renameConversation(_ id: String, title: String) async {
        guard let api = client, !saving else { return }
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 120 else { return }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let value: AgentConversationSummaryResponse = try await api.mutate("/api/agent/conversations/\(id)", method: "PATCH", body: AgentConversationUpdateRequest(title: title))
            guard epoch == ownerEpoch else { return }
            if conversation?.conversationId == id { conversation?.title = value.title }
            await refreshHistory()
        } catch { if epoch == ownerEpoch { handle(error) } }
    }
    func deleteConversation(_ id: String) async {
        guard let api = client, !saving else { return }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        if (conversation?.conversationId ?? pendingConversationId) == id { await stop() }
        guard epoch == ownerEpoch else { return }
        if stopRecords.contains(where: { $0.confirmation.isPending && $0.confirmation.conversationId == id }) {
            error = "停止结果仍未确认，暂不能删除这段历史。原请求已保留，可稍后重新核对。"; return
        }
        do {
            try await api.delete("/api/agent/conversations/\(id)")
            guard epoch == ownerEpoch else { return }
            if (conversation?.conversationId ?? pendingConversationId) == id { conversation = nil; pending = nil; clearRetainedTurns(); completedPendingTurn = nil; completedTurnId = nil; pendingConversationId = nil; composer = ""; route = .home }
            await refreshHistory()
        } catch { if epoch == ownerEpoch { handle(error) } }
    }
    func saveAccount(name: String, expectedVersion: Int) async -> Bool {
        guard let api = client, let account, !saving else { return false }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let body = UpdateProfileRequest(displayName: name, expectedVersion: expectedVersion)
            let key = try accountMutationLedger.key(for: "account-profile", body: body)
            let value: AccountResponse = try await api.mutate("/api/account/profile", method: "PATCH", body: body, key: key)
            guard epoch == ownerEpoch else { return false }
            guard value.userId == account.userId else { throw ClientError.authenticationRequired }
            accountMutationLedger.complete("account-profile"); self.account = value; notice = "账户已保存。"; accountError = nil; return true
        } catch { if epoch == ownerEpoch { accountError = conflictMessage(error); handleAuth(error) }; return false }
    }
    func savePreferences(locale: String, timezone: String, expectedVersion: Int) async -> Bool {
        guard let api = client, let preferences = account?.preferences, !saving else { return false }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let body = UpdatePreferencesRequest(expectedVersion: expectedVersion, locale: locale, researchUpdatesEnabled: preferences.researchUpdatesEnabled, timezone: timezone)
            let key = try accountMutationLedger.key(for: "account-preferences", body: body)
            let value: AccountPreferencesResponse = try await api.mutate("/api/account/preferences", method: "PATCH", body: body, key: key)
            guard epoch == ownerEpoch else { return false }; accountMutationLedger.complete("account-preferences"); account?.preferences = value; setInterfaceLocale(value.locale); notice = "偏好已保存。"; accountError = nil; return true
        } catch { if epoch == ownerEpoch { accountError = conflictMessage(error); handleAuth(error) }; return false }
    }
    func saveAgent(_ value: AgentProfileResponse) async -> Bool {
        guard let api = client, !saving else { return false }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let update = AgentProfileUpdate(avatarId: value.avatarId, color: value.color, expectedVersion: value.version, name: value.name.trimmingCharacters(in: .whitespacesAndNewlines), questionnaire: value.questionnaire, setupCompleted: true, setupStep: 4, soulText: value.soulText ?? "", speakingStyle: value.speakingStyle)
            let key = try accountMutationLedger.key(for: "agent-profile", body: update)
            let result: AgentProfileResponse = try await api.mutate("/api/agent-profile", method: "PATCH", body: update, key: key)
            guard epoch == ownerEpoch else { return false }; accountMutationLedger.complete("agent-profile"); profile = result; profileError = nil; notice = "Agent 已保存。"; return true
        } catch { if epoch == ownerEpoch { profileError = conflictMessage(error); handleAuth(error) }; return false }
    }
    func revokeSession(_ id: String) async {
        guard let api = client, !saving else { return }
        let epoch = ownerEpoch; saving = true; defer { if epoch == ownerEpoch { saving = false } }
        do {
            let key = try accountMutationLedger.key(for: "revoke-session:\(id)", body: ["session_id": id])
            let _: RevokeSessionResponse = try await api.post("/api/account/sessions/\(id)/revoke", key: key)
            guard epoch == ownerEpoch else { return }
            accountMutationLedger.complete("revoke-session:\(id)")
            if id == session?.sessionId { invalidateOwnerSession() } else { await refreshAccount() }
        } catch { if epoch == ownerEpoch { accountError = error.localizedDescription; handleAuth(error) } }
    }
    private func conflictMessage(_ error: Error) -> String {
        if (error as? ClientError)?.isConflict == true { return "设置已在其他设备更新。你的编辑仍保留，请重新读取最新版本后再保存。" }
        return error.localizedDescription
    }
    private func invalidateOwnerSession() {
        let endpoint = client?.endpoint
        client?.clearSession(); client?.close()
        resetOwner()
        // A fresh cookie jar prevents a late response from the former session
        // from clearing or replacing the next owner's authentication cookie.
        client = endpoint.map(APIClient.init(endpoint:))
    }
    private func handleAuth(_ error: Error) {
        if error as? ClientError == .authenticationRequired {
            invalidateOwnerSession(); self.error = error.localizedDescription
        }
    }
    private func handle(_ error: Error) { handleAuth(error); self.error = error.localizedDescription }
}
#endif
