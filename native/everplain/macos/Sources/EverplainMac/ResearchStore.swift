#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

@MainActor final class ResearchStore: ObservableObject {
    @Published var projects: [ResearchTaskNavigationResponse] = []
    @Published var materials: [ResearchMaterialResponse] = []
    @Published var selectedTaskId: String?
    @Published var selectedMaterial: ResearchMaterialResponse?
    @Published var tab = "projects"
    @Published var loading = false
    @Published var materialLoading = false
    @Published var uploading = false
    @Published var busy = false
    @Published var error: String?
    @Published var materialError: String?
    @Published var notice: String?
    @Published var materialFailures: Set<String> = []
    let memory = MemoryStore()
    var onAuthenticationRequired: (() -> Void)?
    var onOpenWorkspace: ((String?, String?) -> Void)?
    private var api: APIClient?
    private var ownerId: String?
    private var generation = UUID()
    private var loadGeneration = UUID()
    private var materialReadGeneration = UUID()
    private var selectionGeneration = UUID()
    private var uploadLedger = ResearchUploadLedger<ResearchMaterialResponse>()
    private var cancelFileRead: (() -> Void)?
    private var pollTask: Task<Void, Never>?
    static let supportedExtensions = ["pdf", "docx", "txt", "md", "markdown", "mp3", "m4a", "wav", "mp4", "webm"]
    var selectedProject: ResearchTaskNavigationResponse? { projects.first { $0.taskId == selectedTaskId } }
    func configure(api: APIClient?, ownerId: String?) {
        guard self.ownerId != ownerId || self.api !== api else { return }
        generation = UUID(); loadGeneration = UUID(); materialReadGeneration = UUID(); selectionGeneration = UUID(); pollTask?.cancel(); pollTask = nil
        cancelFileRead?(); cancelFileRead = nil
        uploadLedger.configure(owner: ownerId.flatMap { owner in api.map { "\($0.endpoint.origin.absoluteString)|\(owner)" } })
        self.api = api; self.ownerId = ownerId
        projects = []; materials = []; selectedTaskId = nil; selectedMaterial = nil; tab = "projects"
        loading = false; materialLoading = false; uploading = false; busy = false; error = nil; materialError = nil; notice = nil; materialFailures = []
        memory.onAuthenticationRequired = { [weak self] in self?.onAuthenticationRequired?() }
        memory.configure(api: api, ownerId: ownerId)
    }
    func load(includeMaterials: Bool = false) async {
        guard let api, ownerId != nil else { return }; let epoch = generation; let load = UUID(); loadGeneration = load
        loading = true; error = nil
        defer { if epoch == generation, load == loadGeneration { loading = false } }
        do {
            var all: [ResearchTaskNavigationResponse] = []; var cursor: String?; var cursors = Set<String>()
            repeat {
                let page: ResearchTaskPageResponse = try await api.get("/api/research-tasks", query: cursor.map { ["cursor": $0, "limit": "100"] } ?? ["limit": "100"])
                guard epoch == generation, load == loadGeneration, !Task.isCancelled else { return }
                all.append(contentsOf: page.items); cursor = page.nextCursor
                if let cursor, !cursors.insert(cursor).inserted { throw ClientError.invalidResponse }
            } while cursor != nil
            invalidateMaterialReads(); projects = all.sorted { $0.updatedAt > $1.updatedAt }
            if includeMaterials { await loadMaterials() }
        } catch { if epoch == generation, load == loadGeneration, !Task.isCancelled { fail(error) } }
    }
    func loadMaterials() async {
        guard let api, ownerId != nil, !Task.isCancelled else { return }; let epoch = generation
        let read = UUID(); materialReadGeneration = read
        materialLoading = true; materialFailures = []
        defer { if epoch == generation, read == materialReadGeneration { materialLoading = false } }
        let ids = projects.map(\.taskId)
        var loaded: [ResearchMaterialResponse] = []
        var failures = Set<String>()
        for id in ids {
            do {
                let value: ResearchMaterialListResponse = try await api.get("/api/research-tasks/\(id)/materials")
                guard epoch == generation, read == materialReadGeneration, !Task.isCancelled else { return }; loaded.append(contentsOf: value.items)
            } catch {
                guard epoch == generation, read == materialReadGeneration, !Task.isCancelled else { return }
                failures.insert(id)
                if error as? ClientError == .authenticationRequired { onAuthenticationRequired?(); return }
            }
        }
        guard epoch == generation, read == materialReadGeneration, !Task.isCancelled else { return }
        materials = loaded; materialFailures = failures; startIngestionPolling()
    }
    func selectProject(_ id: String?) {
        selectionGeneration = UUID(); selectedTaskId = id; selectedMaterial = nil; tab = id == nil ? "projects" : "files"
        memory.configure(api: api, ownerId: ownerId, taskId: id)
    }
    func openWorkspace(_ id: String?) { onOpenWorkspace?(id, projects.first(where: { $0.taskId == id })?.conversationId) }
    func openMaterial(_ item: ResearchMaterialResponse) async {
        guard let api, ownerId != nil, !Task.isCancelled else { return }; let epoch = generation; let selection = UUID(); selectionGeneration = selection
        selectedMaterial = item; materialError = nil
        do {
            let value: ResearchMaterialResponse = try await api.get("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)")
            guard epoch == generation, selection == selectionGeneration, !Task.isCancelled else { return }; selectedMaterial = value
        } catch { if epoch == generation, selection == selectionGeneration, !Task.isCancelled { materialError = error.localizedDescription; if error as? ClientError == .authenticationRequired { onAuthenticationRequired?() } } }
    }
    func removeMaterial(_ item: ResearchMaterialResponse) async {
        guard !busy, let api, ownerId != nil, !Task.isCancelled else { return }; let epoch = generation; busy = true; materialError = nil
        defer { if epoch == generation { busy = false } }
        let action = "DELETE:/api/research-tasks/\(item.taskId)/materials/\(item.materialId)"
        do {
            try await api.delete("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)", key: uploadLedger.operationKey(for: action))
            guard epoch == generation, !Task.isCancelled else { return }
            uploadLedger.finishOperation(action); invalidateMaterialReads(); materials.removeAll { $0.materialId == item.materialId }
            if selectedMaterial?.materialId == item.materialId { selectionGeneration = UUID(); selectedMaterial = nil }
        } catch { if epoch == generation, !Task.isCancelled { materialError = error.localizedDescription; if error as? ClientError == .authenticationRequired { onAuthenticationRequired?() } } }
    }
    func reparse(_ item: ResearchMaterialResponse) async {
        guard !busy, let api, ownerId != nil, !Task.isCancelled else { return }; let epoch = generation; busy = true
        defer { if epoch == generation { busy = false } }
        let action = "POST:/api/research-tasks/\(item.taskId)/materials/\(item.materialId)/reparse"
        do {
            let value: ResearchMaterialResponse = try await api.post("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)/reparse", key: uploadLedger.operationKey(for: action))
            guard epoch == generation, !Task.isCancelled else { return }; uploadLedger.finishOperation(action); replaceMaterial(value); startIngestionPolling()
        } catch { if epoch == generation, !Task.isCancelled { fail(error) } }
    }
    func chooseFiles(taskId: String? = nil) {
        guard !uploading else { return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = Self.supportedExtensions.compactMap { UTType(filenameExtension: $0) }
        panel.message = "导入文档、音频或视频，整理原文并与 Agent 讨论。"
        let epoch = generation, destination = taskId ?? selectedTaskId
        panel.begin { [weak self] result in
            guard result == .OK else { return }
            Task { @MainActor in guard let self, epoch == self.generation else { return }; await self.uploadFiles(panel.urls, taskId: destination) }
        }
    }
    @discardableResult func uploadFiles(_ urls: [URL], taskId: String?) async -> String? {
        guard !uploading, !urls.isEmpty, api != nil, ownerId != nil, !Task.isCancelled else { return nil }
        let epoch = generation
        uploading = true; materialError = nil; notice = nil
        defer { if epoch == generation { uploading = false } }
        var destination = taskId
        do {
            let batch = try await prepareBatch(urls: urls, taskId: taskId, scope: "research-material-input", allowResolvedDestination: true, epoch: epoch)
            destination = batch.destinationTaskId
            if destination == nil {
                guard let api else { throw CancellationError() }
                let value: ResearchTaskResponse = try await api.mutate("/api/research-tasks", body: CreateResearchTaskRequest(entryMode: "from_scratch", entryType: "material_input", projectTitle: batch.files[0].identity.filename), key: batch.projectKey)
                try requireCurrent(epoch)
                guard uploadLedger.setDestination(value.taskId, for: batch) else { throw CancellationError() }
                destination = value.taskId
            }
            guard let destination else { throw ClientError.invalidResponse }
            _ = try await performBatch(batch, urls: urls, taskId: destination, epoch: epoch)
            try requireCurrent(epoch)
            notice = "材料已添加"; await load(includeMaterials: true)
            try requireCurrent(epoch)
            selectProject(destination); return destination
        } catch {
            if epoch == generation, !Task.isCancelled, !(error is CancellationError) {
                materialError = error.localizedDescription
                if error as? ClientError == .authenticationRequired { onAuthenticationRequired?() }
            }
            // Keep a confirmed project destination usable after partial failure. The journal also
            // recognizes it on a retry, even when the first attempt requested a new project.
            return epoch == generation && !Task.isCancelled ? destination : nil
        }
    }

    /// The caller supplies its stable attachment context. This never creates a project.
    /// Returns confirmed successes from earlier attempts as well as newly uploaded files, in order.
    func uploadAttachmentBatch(urls: [URL], taskId: String, scope: String) async throws -> [ResearchMaterialResponse] {
        guard !uploading else { throw ResearchUploadError.alreadyUploading }
        guard api != nil, ownerId != nil else { throw ClientError.authenticationRequired }
        guard !taskId.isEmpty else { throw ClientError.invalidResponse }
        guard !urls.isEmpty else { return [] }
        let epoch = generation
        try requireCurrent(epoch)
        uploading = true
        defer { if epoch == generation { uploading = false } }
        let batch = try await prepareBatch(urls: urls, taskId: taskId, scope: "attachments:" + scope, epoch: epoch)
        return try await performBatch(batch, urls: urls, taskId: taskId, epoch: epoch)
    }

    /// Compatibility for the research entry flow. The supplied key is a retry scope; the journal
    /// assigns a new wire key if the actual file bytes or other multipart fields change.
    func uploadFile(_ url: URL, taskId: String, key: String) async throws -> ResearchMaterialResponse {
        let values = try await uploadAttachmentBatch(urls: [url], taskId: taskId, scope: "single-file:" + key)
        guard let value = values.first else { throw ClientError.invalidResponse }
        return value
    }

    private func prepareBatch(urls: [URL], taskId: String?, scope: String, allowResolvedDestination: Bool = false,
                              epoch: UUID) async throws -> ResearchUploadLedger<ResearchMaterialResponse>.Batch {
        guard urls.allSatisfy({ Self.supportedExtensions.contains($0.pathExtension.lowercased()) }) else { throw ResearchUploadError.unsupportedFile }
        // Hash one file at a time in a detached worker. The journal retains only hashes and results,
        // so retries do not keep entire audio/video batches resident in memory.
        var identities: [ResearchUploadFileIdentity] = []
        for url in urls {
            try requireCurrent(epoch)
            let work = Task.detached(priority: .userInitiated) { try Self.identifyFile(url) }
            cancelFileRead = { work.cancel() }
            defer { if epoch == generation { cancelFileRead = nil } }
            let identity = try await withTaskCancellationHandler(operation: { try await work.value }, onCancel: { work.cancel() })
            try requireCurrent(epoch)
            identities.append(identity)
        }
        return try uploadLedger.begin(scope: scope, taskId: taskId, files: identities, allowResolvedDestination: allowResolvedDestination)
    }

    private func performBatch(_ batch: ResearchUploadLedger<ResearchMaterialResponse>.Batch, urls: [URL],
                              taskId: String, epoch: UUID) async throws -> [ResearchMaterialResponse] {
        guard let api else { throw ClientError.authenticationRequired }
        for index in batch.pendingIndices {
            try requireCurrent(epoch)
            let file = batch.files[index], url = urls[index]
            let work = Task.detached(priority: .userInitiated) { try Self.readUploadForm(url, file: file) }
            cancelFileRead = { work.cancel() }
            defer { if epoch == generation { cancelFileRead = nil } }
            let form = try await withTaskCancellationHandler(operation: { try await work.value }, onCancel: { work.cancel() })
            try requireCurrent(epoch)
            let value: ResearchMaterialResponse = try await api.upload("/api/research-tasks/\(taskId)/materials", form: form, key: file.key)
            try requireCurrent(epoch)
            guard value.taskId == taskId, uploadLedger.succeed(value, at: index, in: batch) else { throw ClientError.invalidResponse }
            replaceMaterial(value); startIngestionPolling()
        }
        try requireCurrent(epoch)
        guard let results = uploadLedger.finish(batch) else { throw ClientError.invalidResponse }
        return results
    }

    private func requireCurrent(_ epoch: UUID) throws {
        try Task.checkCancellation()
        guard epoch == generation, api != nil, ownerId != nil else { throw CancellationError() }
    }

    private nonisolated static func identifyFile(_ url: URL) throws -> ResearchUploadFileIdentity {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var digest = ResearchUploadDigest()
        while true {
            try Task.checkCancellation()
            guard let data = try handle.read(upToCount: 1_048_576), !data.isEmpty else { break }
            digest.update(data)
        }
        try Task.checkCancellation()
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return ResearchUploadFileIdentity(filename: url.lastPathComponent, mimeType: type, byteCount: digest.byteCount, sha256: digest.finalized())
    }

    private nonisolated static func readUploadForm(_ url: URL, file: ResearchUploadLedger<ResearchMaterialResponse>.File) throws -> MultipartBody {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var digest = ResearchUploadDigest(), bytes = Data()
        while true {
            try Task.checkCancellation()
            guard let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty else { break }
            digest.update(chunk); bytes.append(chunk)
        }
        try Task.checkCancellation()
        // A file can change between the initial batch fingerprint and this read. Never send its new
        // body under the old key: retain the old batch and let a deliberate retry create a new one.
        guard digest.byteCount == file.identity.byteCount, digest.finalized() == file.identity.sha256 else { throw ResearchUploadError.fileChanged }
        return try MultipartBody(parts: [
            .file(name: "file", filename: file.identity.filename, mimeType: file.identity.mimeType, bytes: bytes),
            .field(name: "material_kind", value: file.identity.materialKind),
            .field(name: "defer_processing", value: file.identity.deferProcessing ? "true" : "false")
        ], boundary: file.boundary)
    }
    func readMaterial(taskId: String, materialId: String, parseId: String? = nil) async throws -> ResearchMaterialResponse {
        guard let api, ownerId != nil else { throw ClientError.authenticationRequired }
        let epoch = generation; try requireCurrent(epoch)
        let value: ResearchMaterialResponse = try await api.get("/api/research-tasks/\(taskId)/materials/\(materialId)", query: parseId.map { ["parse_id": $0] } ?? [:])
        try requireCurrent(epoch); return value
    }
    private func invalidateMaterialReads() { materialReadGeneration = UUID(); materialLoading = false }
    private func replaceMaterial(_ value: ResearchMaterialResponse) {
        invalidateMaterialReads(); materials.removeAll { $0.materialId == value.materialId }; materials.insert(value, at: 0)
        if selectedMaterial?.materialId == value.materialId { selectionGeneration = UUID(); selectedMaterial = value }
    }
    private func startIngestionPolling() {
        guard pollTask == nil, materials.contains(where: Self.pending), let api else { return }; let epoch = generation
        pollTask = Task {
            defer { if epoch == generation { pollTask = nil } }
            while !Task.isCancelled, epoch == generation {
                let waiting = materials.filter(Self.pending); if waiting.isEmpty { return }
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                for item in waiting {
                    guard !materialLoading else { break }
                    guard materials.contains(where: { $0.materialId == item.materialId && Self.pending($0) }) else { continue }
                    let read = materialReadGeneration
                    do {
                        let value: ResearchMaterialResponse = try await api.get("/api/research-tasks/\(item.taskId)/materials/\(item.materialId)")
                        guard epoch == generation, !Task.isCancelled else { return }
                        guard read == materialReadGeneration else { continue }
                        replaceMaterial(value)
                    } catch {
                        guard epoch == generation, !Task.isCancelled else { return }
                        guard read == materialReadGeneration else { continue }
                        materialError = "材料状态暂时无法更新，可以稍后重试读取。"
                        if error as? ClientError == .authenticationRequired { onAuthenticationRequired?() }; return
                    }
                }
            }
        }
    }
    private static func pending(_ item: ResearchMaterialResponse) -> Bool { ["queued", "processing"].contains(item.ingestionStatus ?? "") }
    private func fail(_ failure: Error) { error = failure.localizedDescription; if failure as? ClientError == .authenticationRequired { onAuthenticationRequired?() } }
    static func title(_ item: ResearchTaskNavigationResponse) -> String {
        if !item.projectTitle.isEmpty, item.projectTitle != "未命名研究" { return item.projectTitle }
        if let title = item.phenomenonSummary?.phenomenon, !title.isEmpty, title != "尚未确认现象" { return title }
        return "未命名研究"
    }
}

private enum ResearchUploadError: LocalizedError {
    case alreadyUploading, unsupportedFile, fileChanged
    var errorDescription: String? {
        switch self {
        case .alreadyUploading: return "已有材料正在上传，请等待完成后重试。"
        case .unsupportedFile: return "所选文件包含不支持的研究材料格式。"
        case .fileChanged: return "文件在读取期间发生了变化，请重新选择当前文件后重试。"
        }
    }
}
#endif
