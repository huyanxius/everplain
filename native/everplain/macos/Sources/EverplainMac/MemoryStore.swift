#if os(macOS)
import SwiftUI
import EverplainCore

@MainActor final class MemoryStore: ObservableObject {
    @Published var items: [MemoryResponse] = []
    @Published var settings: MemorySettings?
    @Published var limits: MemoryLimits?
    @Published var summary = ""
    @Published var loading = false
    @Published var busy = false
    @Published var summaryBusy = false
    @Published var error: String?
    @Published var summaryError: String?
    @Published var notice: String?
    @Published var editor: MemoryResponse?
    @Published var editing = false
    @Published var draft = ""
    @Published var selected: MemoryResponse?
    @Published var history: [MemoryResponse] = []
    @Published private(set) var historyId: String?
    @Published private(set) var historyBusy = false
    private(set) var taskId: String?
    var onAuthenticationRequired: (() -> Void)?
    private var api: APIClient?
    private var ownerId: String?
    private var generation = UUID()
    private var readGeneration = UUID()
    private var historyGeneration = UUID()
    private var overviewTask: Task<Void, Never>?
    private var writeKey = UUID().uuidString
    private var ledger = AccountMutationLedger()
    private var cancellers: [UUID: () -> Void] = [:]
    private var userActions: [UUID: Task<Void, Never>] = [:]
    var editorNeedsReview: Bool { guard let editor else { return false }; return items.first(where: { $0.memoryId == editor.memoryId })?.version != editor.version }
    var canSave: Bool {
        guard editing, let limits else { return false }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return !busy && !loading && !editorNeedsReview && !text.isEmpty && text.utf8.count <= limits.maxContentBytes && (editor != nil || items.count < limits.maxEntries)
    }
    func configure(api: APIClient?, ownerId: String?, taskId: String? = nil) {
        guard self.ownerId != ownerId || self.api !== api || self.taskId != taskId else { return }
        generation = UUID(); readGeneration = UUID(); historyGeneration = UUID()
        overviewTask?.cancel(); overviewTask = nil
        cancellers.values.forEach { $0() }; cancellers.removeAll()
        userActions.values.forEach { $0.cancel() }; userActions.removeAll()
        self.api = api; self.ownerId = ownerId; self.taskId = taskId
        items = []; settings = nil; limits = nil; summary = ""; error = nil; summaryError = nil; notice = nil
        editor = nil; editing = false; draft = ""; selected = nil; history = []; historyId = nil; historyBusy = false
        loading = false; busy = false; summaryBusy = false; writeKey = UUID().uuidString; ledger.reset()
    }
    func performUserAction(_ operation: @escaping @MainActor () async -> Void) {
        let epoch = generation; let id = UUID()
        userActions[id] = Task { [weak self] in
            guard let self, self.current(epoch) else { return }
            await operation(); self.userActions[id] = nil
        }
    }
    func load() async {
        guard !Task.isCancelled, let api, ownerId != nil else { return }
        let epoch = generation; let read = UUID(); let scope = taskId; readGeneration = read
        loading = true; error = nil; invalidateSummary()
        defer { if epoch == generation, read == readGeneration { loading = false } }
        do {
            let query = scope.map { ["task_id": $0] } ?? [:]
            let result: (MemoryCollection, MemorySettings) = try await tracked {
                async let list: MemoryCollection = api.get("/api/memories", query: query)
                async let prefs: MemorySettings = api.get("/api/memories/settings", query: query)
                return try await (list, prefs)
            }
            guard current(epoch), read == readGeneration else { return }
            let (collection, preferences) = result
            guard preferences.taskId == scope, collection.items.allSatisfy({ $0.taskId == scope }) else { throw ClientError.invalidResponse }
            items = collection.items; limits = collection.limits; settings = preferences
            if let selected { self.selected = items.first(where: { $0.memoryId == selected.memoryId }) }
            if !items.isEmpty { startOverview(expectedVersion: preferences.version, read: read) }
        } catch { if current(epoch), read == readGeneration { fail(error) } }
    }
    func beginEditing(_ item: MemoryResponse? = nil) {
        guard !busy, !loading, ownerId != nil else { return }
        if let item, !items.contains(where: { $0.memoryId == item.memoryId }) { return }
        editor = item; selected = item; draft = item?.content ?? ""; editing = true; error = nil; notice = nil
        writeKey = UUID().uuidString; ledger.complete("memory-save"); closeHistory()
    }
    func cancelEditing() { guard !busy else { return }; editor = nil; editing = false; draft = "" }
    func select(_ item: MemoryResponse?) { guard !busy, !editing else { return }; selected = item; error = nil; closeHistory() }
    func closeHistory() { history = []; historyId = nil; historyBusy = false; historyGeneration = UUID() }
    func acknowledgeLatestVersion() {
        guard let editor, let latest = items.first(where: { $0.memoryId == editor.memoryId }) else { return }
        self.editor = latest; ledger.complete("memory-save")
    }
    func save() async {
        guard !Task.isCancelled, canSave, let api else { return }; let epoch = generation; let scope = taskId
        busy = true; error = nil
        defer { if epoch == generation { busy = false } }
        do {
            let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            let value: MemoryResponse
            if let editor {
                let body = MemoryUpdate(content: content, expectedVersion: editor.version)
                let key = try ledger.key(for: "memory-save", body: body)
                value = try await tracked { try await api.mutate("/api/memories/\(editor.memoryId)", method: "PATCH", body: body, key: key) }
            } else {
                let body = MemoryCreate(content: content, key: "note.\(writeKey)", taskId: scope)
                let key = try ledger.key(for: "memory-save", body: body)
                value = try await tracked { try await api.mutate("/api/memories", body: body, key: key) }
            }
            guard current(epoch) else { return }
            guard value.taskId == scope else { throw ClientError.invalidResponse }
            ledger.complete("memory-save"); items.removeAll { $0.memoryId == value.memoryId }; items.insert(value, at: 0)
            editing = false; editor = nil; draft = ""; selected = value; notice = "记忆已保存。"
            settings = nil; invalidateSummary(); await load()
        } catch {
            guard current(epoch) else { return }; fail(error)
            if (error as? ClientError)?.isConflict == true {
                await load()
                if current(epoch) { self.error = "这条记录已在别处更新。你的修改仍在编辑框内，请对照最新版本后继续。" }
            }
        }
    }
    func remove(_ item: MemoryResponse) async {
        guard !Task.isCancelled, !busy, item.taskId == taskId, items.contains(where: { $0.memoryId == item.memoryId }), let api else { return }
        let epoch = generation; busy = true; error = nil
        defer { if epoch == generation { busy = false } }
        do {
            let query = ["expected_version": String(item.version)]
            let key = try ledger.key(for: "memory-delete-\(item.memoryId)", body: query)
            try await tracked { try await api.delete("/api/memories/\(item.memoryId)", query: query, key: key) }
            guard current(epoch) else { return }
            ledger.complete("memory-delete-\(item.memoryId)"); items.removeAll { $0.memoryId == item.memoryId }
            selected = nil; editing = false; editor = nil; draft = ""; notice = "记忆已删除。"
            settings = nil; invalidateSummary(); await load()
        } catch { if current(epoch) { fail(error) } }
    }
    func toggle(_ field: String) async {
        guard !Task.isCancelled, !busy, ["use", "learn"].contains(field), let api, let current = settings, current.taskId == taskId else { return }
        let epoch = generation; let scope = taskId; busy = true; error = nil
        defer { if epoch == generation { busy = false } }
        do {
            let body = MemorySettingsUpdate(expectedVersion: current.version, learnMemory: field == "learn" ? !current.learnMemory : current.learnMemory, useMemory: field == "use" ? !current.useMemory : current.useMemory)
            let key = try ledger.key(for: "memory-settings", body: body)
            let value: MemorySettings = try await tracked { try await api.mutate("/api/memories/settings", method: "PATCH", body: body, key: key, query: scope.map { ["task_id": $0] } ?? [:]) }
            guard self.current(epoch) else { return }
            guard value.taskId == scope else { throw ClientError.invalidResponse }
            ledger.complete("memory-settings"); settings = value; notice = "记忆设置已保存。"
        } catch { if self.current(epoch) { fail(error) } }
    }
    func loadHistory(_ item: MemoryResponse) async {
        guard !Task.isCancelled, let api, selected?.memoryId == item.memoryId else { return }
        if historyId == item.memoryId { closeHistory(); return }
        let epoch = generation; let read = UUID(); historyGeneration = read
        historyId = item.memoryId; historyBusy = true; history = []; error = nil
        defer { if epoch == generation, read == historyGeneration { historyBusy = false } }
        do {
            let value: MemoryList = try await tracked { try await api.get("/api/memories/\(item.memoryId)/revisions") }
            if current(epoch), read == historyGeneration, selected?.memoryId == item.memoryId { history = value.items.sorted { $0.version > $1.version } }
        } catch { if current(epoch), read == historyGeneration { fail(error) } }
    }
    private func startOverview(expectedVersion: Int, read: UUID) {
        guard let api else { return }; let epoch = generation; let scope = taskId
        summaryBusy = true; summaryError = nil
        overviewTask = Task {
            defer { if epoch == generation, read == readGeneration, !Task.isCancelled { summaryBusy = false } }
            do {
                let value: MemoryOverviewResponse = try await api.mutate("/api/memories/overview", body: MemoryOverviewRequest(expectedVersion: expectedVersion, taskId: scope))
                guard current(epoch), read == readGeneration else { return }; summary = value.summary
            } catch {
                guard current(epoch), read == readGeneration else { return }
                if error as? ClientError == .authenticationRequired { onAuthenticationRequired?(); return }
                summaryError = (error as? ClientError)?.isConflict == true ? "记忆已更新，请刷新记录后重新整理。" : "概览暂未生成，你仍可查看和编辑记忆明细。"
            }
        }
    }
    private func tracked<T>(_ operation: @escaping () async throws -> T) async throws -> T {
        let id = UUID(); let task = Task { try await operation() }; cancellers[id] = { task.cancel() }
        defer { cancellers[id] = nil }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private func current(_ epoch: UUID) -> Bool { epoch == generation && ownerId != nil && !Task.isCancelled }
    private func invalidateSummary() { overviewTask?.cancel(); overviewTask = nil; summary = ""; summaryError = nil; summaryBusy = false; closeHistory() }
    private func fail(_ failure: Error) {
        if failure is CancellationError { return }
        if failure as? ClientError == .authenticationRequired { onAuthenticationRequired?(); return }
        error = failure.localizedDescription
    }
}
#endif
