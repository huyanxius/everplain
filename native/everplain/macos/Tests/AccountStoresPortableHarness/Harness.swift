import Foundation
import EverplainCore

func encoded<T: Encodable>(_ value: T) -> Data { try! JSONEncoder().encode(value) }
func quota(_ balance: Int = 20, cursor: String? = nil) -> CreditSummaryResponse { .init(balance: balance, creditLimit: 100, entries: [], grantAmount: 100, isUnlimited: false, nextCursor: cursor, pricing: .init(inputTokensPerCredit: 100, outputTokensPerCredit: 100), totalEntries: 25) }
func preferences(_ version: Int = 4) -> AccountPreferencesResponse { .init(consentPolicyVersion: "2026-01", locale: "zh-CN", modelImprovementAllowed: false, researchUpdatesEnabled: true, timezone: "UTC", version: version) }
actor OfflineServer {
    enum Reply: Sendable { case data(Data), failure(ClientError), delayed(Data) }
    var routes: [String: [Reply]]
    var requests: [OfflineRequest] = []
    var waits: [(CheckedContinuation<Data, Error>, Data)] = []
    init(_ routes: [String:[Reply]]) { self.routes = routes }
    func request(_ request: OfflineRequest) async throws -> Data {
        requests.append(request)
        guard var replies = routes[request.path], !replies.isEmpty else { throw ClientError.invalidResponse }
        let reply = replies.removeFirst(); routes[request.path] = replies
        switch reply {
        case .data(let value): return value
        case .failure(let error): throw error
        case .delayed(let data): return try await withCheckedThrowingContinuation { waits.append(($0, data)) }
        }
    }
    func count(_ path: String) -> Int { requests.filter { $0.path == path }.count }
    func all(_ path: String) -> [OfflineRequest] { requests.filter { $0.path == path } }
    func release() { let copies = waits; waits = []; for (continuation, data) in copies { continuation.resume(returning: data) } }
}
func client(_ server: OfflineServer) -> APIClient { let api = APIClient(); api.handler = { try await server.request($0) }; return api }
func awaitRequest(_ server: OfflineServer, _ path: String) async {
    for _ in 0..<10_000 { if await server.count(path) > 0 { return }; await Task.yield() }
    fatalError("A synthetic request never started: \(path)")
}
@main struct AccountStoresHarness {
    @MainActor static func main() async {
        await accountOwnerLifecycle()
        await uncertainRedemption()
        await redemptionReadFailure()
        await opaqueCreditPagination()
        await staleConsent()
        await channelClosure()
        await memoryEmptyAndReview()
        await memoryOwnerLifecycle()
        await memoryConflictRetention()
        await memoryCommittedReadFailure()
        await memoryReadOrdering()
        print("Passed 11 offline account/memory lifecycle checks. No network or real account mutation occurred.")
    }
    @MainActor static func accountOwnerLifecycle() async {
        let server = OfflineServer(["/api/account/credits": [.delayed(encoded(quota()))]])
        let api = client(server); let store = AccountManagementStore(); store.configure(api: api, ownerId: "owner-a")
        let reading = Task { await store.loadCredits() }; await awaitRequest(server, "/api/account/credits")
        store.configure(api: api, ownerId: "owner-b")
        precondition(store.credits == nil && store.pending == nil && store.redemptionCode.isEmpty)
        await server.release(); await reading.value
        precondition(store.credits == nil, "Late owner-a data leaked")
        var ran = false
        store.performUserAction { ran = true }
        store.configure(api: api, ownerId: "owner-c")
        await Task.yield(); precondition(!ran, "A queued action crossed owners")
    }
    @MainActor static func uncertainRedemption() async {
        let server = OfflineServer([
            "/api/account/credit-redemptions": [.failure(.server(status: 503, code: "synthetic", message: "Offline retry")), .data(encoded(CreditRedemptionResponse(balance: 30, redeemedPoints: 10)))],
            "/api/account/credits": [.data(encoded(quota(30)))]
        ])
        let store = AccountManagementStore(); store.configure(api: client(server), ownerId: "owner")
        store.redemptionCode = "SYNTHETIC-CODE"
        let first = await store.redeemCredits(); precondition(!first && !store.redemptionCode.isEmpty)
        let second = await store.redeemCredits(); precondition(second && store.redemptionCode.isEmpty)
        let mutations = await server.all("/api/account/credit-redemptions")
        precondition(mutations.count == 2 && mutations[0].key == mutations[1].key, "Unchanged uncertain request lost its key")
    }
    @MainActor static func redemptionReadFailure() async {
        let server = OfflineServer([
            "/api/account/credit-redemptions": [.data(encoded(CreditRedemptionResponse(balance: 40, redeemedPoints: 20)))],
            "/api/account/credits": [.failure(.invalidResponse)]
        ])
        let store = AccountManagementStore(); store.configure(api: client(server), ownerId: "owner"); store.seedCredits(quota())
        store.redemptionCode = "SYNTHETIC-CODE"
        let result = await store.redeemCredits()
        precondition(result && store.redemptionCode.isEmpty && store.credits?.balance == 40 && store.credits?.activeUsageBuckets == nil)
        precondition(store.feedback == "兑换成功。" && store.error != nil)
        let count = await server.count("/api/account/credit-redemptions"); precondition(count == 1)
    }
    @MainActor static func opaqueCreditPagination() async {
        let server = OfflineServer(["/api/account/credits": [.data(encoded(quota(cursor: "opaque-next"))), .data(encoded(quota(cursor: "opaque-last"))), .data(encoded(quota(cursor: "opaque-next")))]])
        let store = AccountManagementStore(); store.configure(api: client(server), ownerId: "owner")
        await store.loadCredits(); await store.loadCredits(page: 2); await store.loadCredits(page: 1)
        let calls = await server.all("/api/account/credits")
        precondition(calls.count == 3 && calls[0].query["limit"] == "10" && calls[1].query["cursor"] == "opaque-next" && calls[2].query["cursor"] == nil)
        precondition(store.creditPage == 1)
    }
    @MainActor static func staleConsent() async {
        let server = OfflineServer(["/api/account/model-data-authorization": [.delayed(encoded(preferences(5)))]])
        let api = client(server); let store = AccountManagementStore(); store.configure(api: api, ownerId: "a")
        var applied = false; store.onPreferencesChanged = { _ in applied = true }
        let saving = Task { await store.updateModelConsent(allowed: true, preferences: preferences()) }
        await awaitRequest(server, "/api/account/model-data-authorization")
        store.configure(api: api, ownerId: "b"); await server.release()
        let success = await saving.value; precondition(!success && !applied && store.feedback == nil)
    }
    @MainActor static func channelClosure() async {
        let server = OfflineServer([
            "/api/channels/gateways": [.data(encoded([ChannelGatewayInfoResponse(gatewayId: "gateway", name: "Synthetic bot", platform: "telegram")]))],
            "/api/channels/bindings": [.data(encoded([ChannelBindingResponse]()))],
            "/api/channels/link-codes": [.delayed(encoded(ChannelLinkCodeResponse(code: "SYNTHETIC", expiresAt: Int(Date().timeIntervalSince1970) + 60, gatewayId: "gateway")))]
        ])
        let store = AccountManagementStore(); store.configure(api: client(server), ownerId: "owner")
        await store.loadChannels(); precondition(store.channelsLoaded && store.selectedGateway == "gateway")
        store.channelConsent = true; let generation = Task { await store.generateCode() }
        await awaitRequest(server, "/api/channels/link-codes"); store.closeChannels(); await server.release(); await generation.value
        precondition(store.channelGrant == nil && store.command == nil && !store.channelConsent, "A closed panel retained a secret grant")
    }
    @MainActor static func memoryEmptyAndReview() async {
        let empty = MemoryCollection(items: [], limits: .init(maxContentBytes: 6, maxEntries: 2))
        let prefs = MemorySettings(learnMemory: true, useMemory: true, version: 2)
        let server = OfflineServer(["/api/memories": [.data(encoded(empty))], "/api/memories/settings": [.data(encoded(prefs))]])
        let store = MemoryStore(); store.configure(api: client(server), ownerId: "owner")
        await store.load(); precondition(!store.loading && !store.summaryBusy)
        let overviewCalls = await server.count("/api/memories/overview"); precondition(overviewCalls == 0, "Empty memory triggered a model overview")
        store.beginEditing(); store.draft = "中文"; precondition(store.canSave)
        store.draft = "中文多"; precondition(!store.canSave)
        store.cancelEditing()
    }
    @MainActor static func memoryOwnerLifecycle() async {
        let empty = MemoryCollection(items: [], limits: .init(maxContentBytes: 2000, maxEntries: 10))
        let server = OfflineServer(["/api/memories": [.delayed(encoded(empty))], "/api/memories/settings": [.data(encoded(MemorySettings(learnMemory: true, useMemory: true, version: 1)))]])
        let api = client(server); let store = MemoryStore(); store.configure(api: api, ownerId: "a")
        let read = Task { await store.load() }; await awaitRequest(server, "/api/memories")
        store.draft = "Old owner draft"; store.configure(api: api, ownerId: "b")
        precondition(store.draft.isEmpty && store.limits == nil && store.settings == nil)
        await server.release(); await read.value; precondition(store.limits == nil && store.items.isEmpty)
        var ran = false; store.performUserAction { ran = true }; store.configure(api: api, ownerId: "c"); await Task.yield(); precondition(!ran)
    }
    static func memory(_ version: Int, _ text: String) -> MemoryResponse {
        .init(content: text, createdAt: "2026-01-01T00:00:00Z", key: "note.synthetic", memoryId: "memory-1", origin: "manual", updatedAt: "2026-01-01T00:00:00Z", version: version)
    }
    @MainActor static func memoryConflictRetention() async {
        let original = memory(1, "Original"), latest = memory(2, "Other edit")
        let server = OfflineServer([
            "/api/memories/memory-1": [.failure(.server(status: 409, code: "version_conflict", message: "Synthetic conflict"))],
            "/api/memories": [.data(encoded(MemoryCollection(items: [latest], limits: .init(maxContentBytes: 2000, maxEntries: 10))))],
            "/api/memories/settings": [.data(encoded(MemorySettings(learnMemory: true, useMemory: true, version: 3)))],
            "/api/memories/overview": [.data(encoded(MemoryOverviewResponse(memoryCount: 1, scopeVersion: 3, summary: "Synthetic overview")))]
        ])
        let store = MemoryStore(); store.configure(api: client(server), ownerId: "owner")
        store.items = [original]; store.limits = .init(maxContentBytes: 2000, maxEntries: 10)
        store.beginEditing(original); store.draft = "User unsaved draft"; await store.save()
        precondition(store.editing && store.draft == "User unsaved draft" && store.editorNeedsReview && !store.canSave)
        store.acknowledgeLatestVersion()
        precondition(store.editor?.version == 2 && store.draft == "User unsaved draft" && store.canSave)
        store.configure(api: nil, ownerId: nil)
    }
    @MainActor static func memoryCommittedReadFailure() async {
        let original = memory(1, "Original"), committed = memory(2, "Saved")
        let server = OfflineServer([
            "/api/memories/memory-1": [.data(encoded(committed))],
            "/api/memories": [.failure(.invalidResponse)],
            "/api/memories/settings": [.data(encoded(MemorySettings(learnMemory: true, useMemory: true, version: 3)))]
        ])
        let store = MemoryStore(); store.configure(api: client(server), ownerId: "owner")
        store.items = [original]; store.limits = .init(maxContentBytes: 2000, maxEntries: 10); store.summary = "Old overview"
        store.beginEditing(original); store.draft = "Saved"; await store.save()
        precondition(store.items.first?.content == "Saved" && !store.editing && store.notice == "记忆已保存。")
        precondition(store.summary.isEmpty && !store.summaryBusy && store.settings == nil && store.error != nil)
    }
    @MainActor static func memoryReadOrdering() async {
        let old = MemoryCollection(items: [memory(1, "Old")], limits: .init(maxContentBytes: 2000, maxEntries: 10))
        let current = MemoryCollection(items: [], limits: .init(maxContentBytes: 4000, maxEntries: 20))
        let server = OfflineServer([
            "/api/memories": [.delayed(encoded(old)), .data(encoded(current))],
            "/api/memories/settings": [.data(encoded(MemorySettings(learnMemory: true, useMemory: true, version: 1))), .data(encoded(MemorySettings(learnMemory: false, useMemory: false, version: 2)))]
        ])
        let store = MemoryStore(); store.configure(api: client(server), ownerId: "owner")
        let first = Task { await store.load() }; await awaitRequest(server, "/api/memories"); await awaitRequest(server, "/api/memories/settings")
        await store.load(); await server.release(); await first.value
        precondition(store.items.isEmpty && store.limits?.maxEntries == 20 && store.settings?.version == 2 && !store.loading && !store.summaryBusy)
        let calls = await server.count("/api/memories/overview"); precondition(calls == 0, "Stale nonempty list started an overview")
    }

}
