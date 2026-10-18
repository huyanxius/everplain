#if os(macOS)
import SwiftUI
import EverplainCore

/// Owner-scoped auxiliary account state. Every asynchronous application is guarded;
/// configure cancels in-flight work and synchronously discards private state.
@MainActor final class AccountManagementStore: ObservableObject {
    @Published private(set) var credits: CreditSummaryResponse?
    @Published private(set) var creditPage = 1
    @Published private(set) var dataExport: DataExportResponse?
    @Published private(set) var pending: String?
    @Published var error: String?
    @Published var feedback: String?
    @Published var redemptionCode = ""
    @Published private(set) var gateways: [ChannelGatewayInfoResponse] = []
    @Published private(set) var bindings: [ChannelBindingResponse] = []
    @Published private(set) var channelGrant: ChannelLinkCodeResponse?
    @Published private(set) var channelsLoading = false
    @Published private(set) var channelsLoaded = false
    @Published private(set) var selectedGateway = ""
    @Published var channelConsent = false
    @Published private(set) var channelError: String?
    @Published private(set) var channelFeedback: String?
    @Published private(set) var now = Date()
    private(set) var ownerId: String?
    var onAuthenticationRequired: (() -> Void)?
    var onAccountClosed: (() -> Void)?
    var onPreferencesChanged: ((AccountPreferencesResponse) -> Void)?
    var onCreditsChanged: ((CreditSummaryResponse) -> Void)?
    private var api: APIClient?
    private var generation = UUID()
    private var channelGeneration = UUID()
    private var creditRead = UUID()
    private var creditCursors: [String?] = [nil]
    private var channelPoll: Task<Void, Never>?
    private var cancellers: [UUID: () -> Void] = [:]
    private var ledger = AccountMutationLedger()
    private var priorBindings = Set<String>()
    private var userActions: [UUID: Task<Void, Never>] = [:]
    var busy: Bool { pending != nil }
    var remaining: Int { channelGrant.map { max(0, Int(ceil(Double($0.expiresAt) - now.timeIntervalSince1970))) } ?? 0 }
    var command: String? { AccountManagementLogic.bindingCommand(channelGrant) }
    var selectedBot: ChannelGatewayInfoResponse? { gateways.first { $0.gatewayId == selectedGateway } }

    func configure(api: APIClient?, ownerId: String?) {
        guard self.api !== api || self.ownerId != ownerId else { return }
        generation = UUID(); creditRead = UUID(); channelGeneration = UUID()
        cancellers.values.forEach { $0() }; cancellers.removeAll(); userActions.values.forEach { $0.cancel() }; userActions.removeAll(); channelPoll?.cancel(); channelPoll = nil
        self.api = api; self.ownerId = ownerId
        credits = nil; creditPage = 1; creditCursors = [nil]; dataExport = nil
        pending = nil; error = nil; feedback = nil; redemptionCode = ""; ledger.reset()
        gateways = []; bindings = []; channelGrant = nil; selectedGateway = ""; channelConsent = false
        channelError = nil; channelFeedback = nil; channelsLoading = false; channelsLoaded = false; priorBindings = []
    }
    func performUserAction(_ operation: @escaping @MainActor () async -> Void) {
        let epoch = generation; let id = UUID()
        userActions[id] = Task { [weak self] in
            guard let self, epoch == self.generation, !Task.isCancelled else { return }
            await operation(); self.userActions[id] = nil
        }
    }
    func matchesOwner(_ value: String?) -> Bool { value != nil && value == ownerId }
    func clearMessages() { error = nil; feedback = nil }
    func seedCredits(_ value: CreditSummaryResponse?) { if credits == nil { credits = value } }

    func loadCredits(page: Int = 1) async {
        guard !Task.isCancelled, !busy, page > 0, page <= creditCursors.count, let api, ownerId != nil else { return }
        let epoch = generation; let read = UUID(); creditRead = read
        pending = "credit-page"; error = nil
        defer { if epoch == generation, read == creditRead { pending = nil } }
        do {
            var query = ["limit": String(AccountManagementLogic.creditPageSize)]
            if let cursor = creditCursors[page - 1] { query["cursor"] = cursor }
            let value: CreditSummaryResponse = try await tracked { try await api.get("/api/account/credits", query: query) }
            guard epoch == generation, read == creditRead, !Task.isCancelled else { return }
            applyCredits(value, page: page)
        } catch { if epoch == generation, read == creditRead { fail(error) } }
    }
    private func applyCredits(_ value: CreditSummaryResponse, page: Int) {
        credits = value; creditPage = page
        creditCursors = Array(creditCursors.prefix(page))
        if let cursor = value.nextCursor { creditCursors.append(cursor) }
        onCreditsChanged?(value)
    }
    func redeemCredits() async -> Bool {
        let code = redemptionCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, code.utf16.count <= 64, let api else { error = "请输入兑换码。"; return false }
        let epoch = generation; let body = CreditRedemptionRequest(code: code)
        let value: CreditRedemptionResponse? = await perform("credit-redemption", body: body) { key in
            try await api.mutate("/api/account/credit-redemptions", body: body, key: key)
        }
        guard epoch == generation, let value else { return false }
        // Redemption has succeeded. A failing follow-up read must never invite a second redemption.
        redemptionCode = ""; feedback = "兑换成功。"
        if var previous = credits { previous.balance = value.balance; previous.activeUsageBuckets = nil; credits = previous; onCreditsChanged?(previous) }
        creditCursors = [nil]; creditPage = 1
        await loadCredits()
        if epoch == generation { feedback = "兑换成功。" }
        return true
    }
    func updateModelConsent(allowed: Bool, preferences: AccountPreferencesResponse) async -> Bool {
        guard let api else { return false }
        let body = UpdateModelDataAuthorizationRequest(allowed: allowed, expectedVersion: preferences.version, policyVersion: preferences.consentPolicyVersion)
        let value: AccountPreferencesResponse? = await perform("model-authorization", body: body) { key in
            try await api.mutate("/api/account/model-data-authorization", method: "PATCH", body: body, key: key)
        }
        guard let value else { return false }
        onPreferencesChanged?(value); feedback = allowed ? "模型数据授权已开启。" : "模型数据授权已关闭。"
        return true
    }
    func requestExport() async {
        guard let api else { return }; let body = DataExportCreateRequest(format: "json")
        let value: DataExportResponse? = await perform("export", body: body) { key in
            try await api.mutate("/api/account/data-exports", body: body, key: key)
        }
        if let value { dataExport = value; feedback = value.status == "ready" ? "数据副本已准备。" : "数据副本正在准备，请稍后重新查看。" }
    }
    func downloadExport() async -> DownloadedContent? {
        guard let api, let dataExport, let path = AccountManagementLogic.exportPath(dataExport, origin: api.endpoint.origin) else {
            error = "数据副本暂不可下载或已过期，请重新导出。"; return nil
        }
        return await perform("download-export", body: dataExport.exportId) { _ in try await api.download(path) }
    }
    func deactivate(account: AccountResponse, password: String, reason: String) async -> Bool {
        guard AccountManagementLogic.canDeactivate(account, ownerId: ownerId, password: password, reason: reason), let api else { return false }
        let body = DeactivateAccountRequest(currentPassword: password, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
        let value: DeactivateAccountResponse? = await perform("deactivate", body: body) { key in try await api.mutate("/api/account/deactivate", body: body, key: key) }
        guard value != nil else { return false }; onAccountClosed?(); return true
    }
    func deleteAccount(account: AccountResponse, password: String, email: String) async -> Bool {
        guard AccountManagementLogic.canDelete(account, ownerId: ownerId, password: password, email: email), let api else { return false }
        let body = DeleteAccountRequest(confirmationEmail: email.trimmingCharacters(in: .whitespacesAndNewlines), currentPassword: password)
        let value: DeleteAccountResponse? = await perform("delete", body: body) { key in try await api.mutate("/api/account/delete", body: body, key: key) }
        guard value != nil else { return false }; onAccountClosed?(); return true
    }

    func loadChannels() async {
        guard !Task.isCancelled, !busy, !channelsLoading, let api, ownerId != nil else { return }
        let epoch = generation; let view = channelGeneration
        channelsLoading = true; channelError = nil
        defer { if epoch == generation, view == channelGeneration { channelsLoading = false } }
        do {
            let result: ([ChannelGatewayInfoResponse], [ChannelBindingResponse]) = try await tracked {
                async let gateways: [ChannelGatewayInfoResponse] = api.get("/api/channels/gateways")
                async let bindings: [ChannelBindingResponse] = api.get("/api/channels/bindings")
                return try await (gateways, bindings)
            }
            guard epoch == generation, view == channelGeneration, !Task.isCancelled else { return }
            gateways = result.0; bindings = result.1; channelsLoaded = true
            if !gateways.contains(where: { $0.gatewayId == selectedGateway }) { selectedGateway = gateways.first?.gatewayId ?? "" }
        } catch { if epoch == generation, view == channelGeneration { failChannel(error, mutation: false) } }
    }
    func refreshChannels() async {
        guard !busy else { return }; hideGrant(); await loadChannels()
    }
    func chooseGateway(_ value: String) {
        guard !busy, gateways.contains(where: { $0.gatewayId == value }) else { return }
        hideGrant(); selectedGateway = value; channelConsent = false; channelError = nil; channelFeedback = nil
    }
    /// Source codes exist only in the mounted channel panel. Hiding does not revoke on the server.
    func closeChannels() {
        hideGrant(); channelGeneration = UUID(); channelConsent = false; channelsLoaded = false; channelsLoading = false
        channelFeedback = nil; channelError = nil
    }
    func generateCode() async {
        guard !busy, !channelsLoading, channelConsent, !selectedGateway.isEmpty, let api else { return }
        let epoch = generation; let view = channelGeneration
        priorBindings = Set(bindings.map(\.bindingId))
        let body = ChannelLinkCodeRequest(acknowledgePrivateDataAndUsage: true, gatewayId: selectedGateway)
        let result: ChannelLinkCodeResponse? = await perform("channel-generate", body: body, channel: true) { key in
            try await api.mutate("/api/channels/link-codes", body: body, key: key)
        }
        guard epoch == generation, view == channelGeneration, let result else { return }
        channelGrant = result; now = Date(); startChannelPolling()
    }
    func cancelCode() async {
        guard let grant = channelGrant, let api else { return }
        let result: Bool? = await perform("channel-cancel", body: grant.gatewayId, channel: true) { key in
            try await api.delete("/api/channels/link-codes", query: ["gateway_id": grant.gatewayId], key: key); return true
        }
        if result == true { hideGrant(); channelFeedback = "绑定码已作废。" }
    }
    func revokeBinding(_ binding: ChannelBindingResponse) async -> Bool {
        guard bindings.contains(where: { $0.bindingId == binding.bindingId }), let api,
              let id = binding.bindingId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) else { return false }
        let result: Bool? = await perform("channel-revoke", body: binding.bindingId, channel: true) { key in
            try await api.delete("/api/channels/bindings/\(id)", key: key); return true
        }
        guard result == true else { return false }
        bindings.removeAll { $0.bindingId == binding.bindingId }
        if channelGrant?.gatewayId == binding.gatewayId { hideGrant() }
        channelFeedback = "已解除绑定，尚未发送的私人回复将停止投递。"; return true
    }
    func copiedCommand(succeeded: Bool) {
        if succeeded { channelFeedback = "命令已复制。只发送给你选择的机器人私聊。"; channelError = nil }
        else { channelError = "未能写入剪贴板，请手动选中并复制下面的命令。" }
    }
    private func hideGrant() { channelPoll?.cancel(); channelPoll = nil; channelGrant = nil }
    private func startChannelPolling() {
        channelPoll?.cancel(); let epoch = generation; let view = channelGeneration
        channelPoll = Task { [weak self] in
            var ticks = 0
            while let self, epoch == self.generation, view == self.channelGeneration, let grant = self.channelGrant, !Task.isCancelled {
                self.now = Date()
                if self.remaining == 0 { self.channelGrant = nil; self.channelFeedback = "绑定码已过期，请重新生成。"; return }
                if ticks > 0, ticks % 3 == 0, !self.busy, let api = self.api {
                    do {
                        let rows: [ChannelBindingResponse] = try await self.tracked { try await api.get("/api/channels/bindings") }
                        guard epoch == self.generation, view == self.channelGeneration, !Task.isCancelled, self.channelGrant?.code == grant.code else { return }
                        guard AccountManagementLogic.bindingCommand(grant) != nil else { continue }
                        self.bindings = rows
                        if rows.contains(where: { $0.gatewayId == grant.gatewayId && !self.priorBindings.contains($0.bindingId) }) {
                            self.channelGrant = nil; self.channelFeedback = "已确认绑定成功，可以去平台私聊了。"; return
                        }
                    } catch {
                        guard epoch == self.generation, view == self.channelGeneration, !Task.isCancelled else { return }
                        if error as? ClientError == .authenticationRequired { self.channelGrant = nil; self.failChannel(error, mutation: false); return }
                    }
                }
                ticks += 1
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
            }
        }
    }
    private func tracked<T>(_ operation: @escaping () async throws -> T) async throws -> T {
        let id = UUID(); let task = Task { try await operation() }
        cancellers[id] = { task.cancel() }
        defer { cancellers[id] = nil }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private func perform<Body: Encodable, Value>(_ action: String, body: Body, channel: Bool = false, operation: @escaping (String) async throws -> Value) async -> Value? {
        guard !Task.isCancelled, !busy, api != nil, ownerId != nil else { return nil }
        let epoch = generation; let view = channelGeneration
        pending = action
        if channel { channelError = nil; channelFeedback = nil } else { error = nil; feedback = nil }
        defer { if epoch == generation { pending = nil } }
        do {
            let key = try ledger.key(for: action, body: body)
            let value = try await tracked { try await operation(key) }
            guard epoch == generation, !Task.isCancelled else { return nil }
            ledger.complete(action)
            guard !channel || view == channelGeneration else { return nil }
            return value
        } catch {
            guard epoch == generation, !Task.isCancelled, !channel || view == channelGeneration else { return nil }
            if channel { failChannel(error, mutation: true) } else { fail(error) }
            return nil
        }
    }
    private func fail(_ failure: Error) {
        guard !(failure is CancellationError) else { return }
        if failure as? ClientError == .authenticationRequired { onAuthenticationRequired?(); return }
        error = failure.localizedDescription
    }
    private func failChannel(_ failure: Error, mutation: Bool) {
        guard !(failure is CancellationError) else { return }
        if failure as? ClientError == .authenticationRequired { channelError = "登录已过期，请重新登录。"; onAuthenticationRequired?() }
        else { channelError = mutation ? "操作结果尚未确认。请刷新绑定状态后再操作。" : "暂时无法读取聊天平台，请重试。" }
    }
}
#endif
