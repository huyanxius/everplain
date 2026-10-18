#if os(macOS)
import Foundation
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

/// An owner-scoped, in-memory controller for the source welcome flow.
/// Configure synchronously at every account/origin boundary before presenting account UI.
@MainActor final class WelcomeSetupStore: ObservableObject {
    enum Operation { case save, importing, retry, choosing }
    @Published private(set) var ownerRevision = UUID()
    @Published private(set) var ownerId: String?
    @Published private(set) var profile: AgentProfileResponse?
    @Published private(set) var latestProfile: AgentProfileResponse?
    @Published var draft = WelcomeSetupDraft()
    @Published private(set) var step = 0
    @Published private(set) var loading = false
    @Published private(set) var busy: Operation?
    @Published private(set) var error: String?
    @Published private(set) var importsLoaded = false
    @Published private(set) var importProgressLoading = false
    @Published private(set) var importProgressError: String?
    @Published var favoritesVisible = false
    @Published var favoritesUID = ""
    var onAuthenticationRequired: (() -> Void)?
    var onProfileChanged: ((AgentProfileResponse) -> Void)?
    private var api: APIClient?
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var profileRequest = UUID()
    private var importRequest = UUID()
    private var activePanel: NSOpenPanel?
    var isBusy: Bool { loading || busy != nil }
    var importsReadable: Bool { importsLoaded && importProgressError == nil }
    var serviceOrigin: URL? { api?.endpoint.origin }

    func configure(api: APIClient?, ownerId: String?) {
        guard self.api !== api || self.ownerId != ownerId else { return }
        ownerRevision = UUID(); profileRequest = UUID(); importRequest = UUID()
        tasks.values.forEach { $0.cancel() }; tasks.removeAll()
        activePanel?.cancel(nil); activePanel = nil
        self.api = api; self.ownerId = ownerId
        profile = nil; latestProfile = nil; draft = WelcomeSetupDraft(); step = 0
        loading = false; busy = nil; error = nil
        importsLoaded = false; importProgressLoading = false; importProgressError = nil
        favoritesVisible = false; favoritesUID = ""
    }

    /// Source "重新走一遍" is navigation to setup, not deletion/reset of saved profile data.
    /// Call only for the current owner, then present the explicit welcome route.
    func restart(with saved: AgentProfileResponse? = nil) {
        guard ownerId != nil, api != nil, !isBusy else { return }
        if let saved { profile = saved }
        if let profile { draft = WelcomeSetupDraft(profile: profile) }
        step = 0; latestProfile = nil; error = nil; favoritesVisible = false; favoritesUID = ""
    }
    func reset() { restart() }

    /// Capture scope at the click, not after a Task is scheduled under a later account.
    func performUserAction(_ work: @escaping @MainActor () async -> Void) {
        let revision = ownerRevision, id = UUID()
        tasks[id] = Task { [weak self] in
            guard let self, self.current(revision) else { return }
            await work()
            self.tasks.removeValue(forKey: id)
        }
    }
    private func current(_ revision: UUID) -> Bool {
        ownerRevision == revision && api != nil && ownerId != nil && !Task.isCancelled
    }
    private func sharesOwner(_ knowledge: KnowledgeStore) -> Bool {
        ownerId != nil && ownerId == knowledge.ownerId && serviceOrigin == knowledge.serviceOrigin
    }
    private func failed(_ failure: Error, revision: UUID) -> String? {
        guard current(revision), !(failure is CancellationError) else { return nil }
        if failure as? ClientError == .authenticationRequired {
            let callback = onAuthenticationRequired
            configure(api: nil, ownerId: nil); callback?()
            return nil
        }
        return failure.localizedDescription
    }

    func load() async {
        guard let api, ownerId != nil, busy == nil else { return }
        let revision = ownerRevision, request = UUID(); profileRequest = request
        loading = true; error = nil
        defer { if current(revision), profileRequest == request { loading = false } }
        do {
            let saved: AgentProfileResponse = try await api.get(EverplainEndpoint.getAgentProfile)
            guard current(revision), profileRequest == request else { return }
            let previous = profile
            let dirty = previous.map { draft != WelcomeSetupDraft(profile: $0) } ?? false
            if let base = previous, dirty, base.version != saved.version {
                latestProfile = saved
                error = "档案已更新，请查看最新版本。你的输入已保留。"
            } else {
                profile = saved; latestProfile = nil
                // First hydration restores the persisted step; same-owner revisits retain navigation.
                if previous == nil { step = WelcomeSetupLogic.initialStep(saved) }
                if !dirty { draft = WelcomeSetupDraft(profile: saved) }
            }
            onProfileChanged?(saved)
        } catch {
            if current(revision), profileRequest == request { self.error = failed(error, revision: revision) }
        }
    }

    @discardableResult func change(to next: Int, skip: Bool = false) async -> Bool {
        guard let api, let profile, ownerId != nil, !isBusy else { return false }
        guard latestProfile == nil else { error = "请先查看最新档案，并选择保留输入或重新载入。"; return false }
        let revision = ownerRevision
        let update: AgentProfileUpdate
        do { update = try WelcomeSetupLogic.update(profile: profile, draft: draft, step: step, next: next, skip: skip) }
        catch { self.error = error.localizedDescription; return false }
        busy = .save; error = nil
        defer { if current(revision) { busy = nil } }
        do {
            let saved: AgentProfileResponse = try await api.mutate(EverplainEndpoint.updateAgentProfile, method: "PATCH", body: update)
            guard current(revision) else { return false }
            self.profile = saved; draft = WelcomeSetupDraft(profile: saved); latestProfile = nil
            step = min(3, next); onProfileChanged?(saved)
            return true
        } catch {
            guard current(revision) else { return false }
            self.error = failed(error, revision: revision)
            if case ClientError.server(let status, _, _) = error, status == 409 {
                await readConflict(api: api, revision: revision)
            }
            return false
        }
    }

    private func readConflict(api: APIClient, revision: UUID) async {
        do {
            let latest: AgentProfileResponse = try await api.get(EverplainEndpoint.getAgentProfile)
            guard current(revision) else { return }
            latestProfile = latest; error = "档案已在别处更新。请查看最新版本，再决定如何保存；你的输入已保留。"
        } catch {
            guard current(revision) else { return }
            if error as? ClientError == .authenticationRequired { _ = failed(error, revision: revision) }
            else { self.error = "档案版本有冲突，最新版本暂时无法读取。请重新读取；你的输入已保留。" }
        }
    }
    func keepDraftAfterReview() {
        guard !isBusy, let base = profile, let latest = latestProfile else { return }
        draft = WelcomeSetupLogic.merging(draft: draft, base: base, latest: latest)
        profile = latest; latestProfile = nil; error = nil
    }
    func discardDraftAfterReview() {
        guard !isBusy, let latest = latestProfile else { return }
        profile = latest; draft = WelcomeSetupDraft(profile: latest); latestProfile = nil; error = nil
        step = WelcomeSetupLogic.initialStep(latest)
    }

    func refreshImports(using knowledge: KnowledgeStore) async {
        guard sharesOwner(knowledge) else { return }
        let revision = ownerRevision, knowledgeRevision = knowledge.ownerRevision, request = UUID()
        importRequest = request; importProgressLoading = true
        await knowledge.loadSupplementary()
        guard current(revision), knowledge.ownerRevision == knowledgeRevision, importRequest == request else { return }
        importsLoaded = true; importProgressLoading = false; importProgressError = knowledge.importError
    }
    func pollImports(using knowledge: KnowledgeStore) async {
        let revision = ownerRevision, knowledgeRevision = knowledge.ownerRevision
        while current(revision), sharesOwner(knowledge), knowledge.ownerRevision == knowledgeRevision,
              knowledge.batches.contains(where: { $0.status == "processing" }) {
            do { try await Task.sleep(nanoseconds: 1_200_000_000) } catch { return }
            guard current(revision), knowledge.ownerRevision == knowledgeRevision else { return }
            await refreshImports(using: knowledge)
            // An unavailable read is visible and explicitly retryable, never "finished".
            if importProgressError != nil { return }
        }
    }

    func importFavorites(using knowledge: KnowledgeStore) async {
        let uid = favoritesUID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard KnowledgeImportSource.validPublicUID(uid) else { error = "请输入有效的 B 站 UID。"; return }
        await runImport(using: knowledge, operation: .importing) { await knowledge.importBilibili(uid) }
    }
    func retry(batchId: String, itemId: String, using knowledge: KnowledgeStore) async {
        await runImport(using: knowledge, operation: .retry) { await knowledge.retryImport(batchId: batchId, itemId: itemId) }
    }
    private func runImport(using knowledge: KnowledgeStore, operation: Operation, work: () async throws -> Void) async {
        guard !isBusy, !knowledge.busy, sharesOwner(knowledge) else { return }
        let revision = ownerRevision, knowledgeRevision = knowledge.ownerRevision
        busy = operation; error = nil
        defer { if current(revision) { busy = nil } }
        do {
            try await work()
            guard current(revision), knowledge.ownerRevision == knowledgeRevision else { return }
            error = knowledge.error
            await refreshImports(using: knowledge)
        } catch { if current(revision) { self.error = failed(error, revision: revision) } }
    }

    func chooseFiles(source: KnowledgeImportSource, using knowledge: KnowledgeStore) {
        guard !isBusy, !knowledge.busy, sharesOwner(knowledge), [.chrome, .obsidian, .appleNotes].contains(source) else { return }
        let revision = ownerRevision, knowledgeRevision = knowledge.ownerRevision
        let folder = source == .obsidian
        let panel = NSOpenPanel()
        panel.canChooseDirectories = folder; panel.canChooseFiles = !folder
        panel.allowsMultipleSelection = source == .appleNotes
        panel.prompt = folder ? "选择 Vault 文件夹" : "导入"
        if !folder {
            let extensions = source == .chrome ? ["html", "htm"] : ["md", "markdown", "txt", "html", "htm"]
            panel.allowedContentTypes = extensions.compactMap { UTType(filenameExtension: $0) }
        }
        error = nil; busy = .choosing; activePanel = panel
        panel.begin { [weak self, weak knowledge] result in
            Task { @MainActor in
                guard let self, let knowledge, self.current(revision), knowledge.ownerRevision == knowledgeRevision else { return }
                self.activePanel = nil; self.busy = nil
                guard result == .OK else { return }
                let urls = panel.urls
                self.performUserAction { [weak self] in await self?.importFiles(urls, source: source, using: knowledge) }
            }
        }
    }
    private func importFiles(_ urls: [URL], source: KnowledgeImportSource, using knowledge: KnowledgeStore) async {
        await runImport(using: knowledge, operation: .importing) {
            var scoped: [URL] = [], files: [URL] = [], relativeNames: [URL: String] = [:]
            defer { scoped.forEach { $0.stopAccessingSecurityScopedResource() } }
            for root in urls {
                if root.startAccessingSecurityScopedResource() { scoped.append(root) }
                let value = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                guard value.isSymbolicLink != true else { throw WelcomeSetupFailure("不能上传符号链接。") }
                if value.isDirectory == true {
                    guard source == .obsidian, let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else {
                        throw WelcomeSetupFailure("无法读取此 Vault 文件夹。")
                    }
                    for case let url as URL in enumerator {
                        try Task.checkCancellation()
                        let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                        if attributes.isSymbolicLink == true { enumerator.skipDescendants(); continue }
                        guard attributes.isRegularFile == true, url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") else { continue }
                        files.append(url)
                        relativeNames[url] = root.lastPathComponent + "/" + String(url.standardizedFileURL.path.dropFirst((root.standardizedFileURL.path + "/").count))
                    }
                } else { files.append(root) }
            }
            guard !files.isEmpty else { throw WelcomeSetupFailure("没有找到可导入的文件。") }
            await knowledge.upload(urls: files, source: source, targetLibraryId: nil, relativeNames: relativeNames)
        }
    }
}
#endif
