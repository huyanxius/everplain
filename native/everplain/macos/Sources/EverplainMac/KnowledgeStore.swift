#if os(macOS)
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import EverplainCore

@MainActor final class KnowledgeStore: ObservableObject {
    enum GraphMode: String, CaseIterable { case graph = "关系图", points = "知识点" }
    struct UploadItem: Identifiable, Sendable {
        let id: UUID
        let filename: String
        let bytes: Data
        let mimeType: String
        let libraryId: String
        let key: String
        let boundary: String
        var state = "queued"
        var error: String?
        var document: SharedDocumentResponse?
    }
    @Published private(set) var ownerRevision = UUID()
    @Published private(set) var ownerId: String?
    @Published private(set) var libraries: [SharedKnowledgeResponse] = []
    @Published private(set) var storage: KnowledgeStorageResponse?
    @Published private(set) var batches: [ImportBatchResponse] = []
    @Published private(set) var personalGraph: PersonalGraphResponse?
    @Published private(set) var source: SharedDocumentSourceResponse?
    @Published private(set) var graphSource: SharedDocumentSourceResponse?
    @Published private(set) var images: [String: Data] = [:]
    @Published private(set) var loading = false
    @Published private(set) var sourceLoading = false
    @Published private(set) var graphLoading = false
    @Published private(set) var graphSourceLoading = false
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var sourceError: String?
    @Published var graphError: String?
    @Published var graphSourceError: String?
    @Published var notice: String?
    @Published var partialError: String?
    @Published private(set) var importError: String?
    @Published private(set) var storageError: String?
    @Published private(set) var supplementaryLoading = false
    @Published var selectedLibraryId: String?
    @Published var selectedSegmentId: String?
    @Published var query = ""
    @Published var kindFilter = ""
    @Published var manageLibraries = false
    @Published var graphMode = GraphMode.graph
    @Published var graphQuery = ""
    @Published var selectedNodeId: String?
    @Published var selectedEdgeId: String?
    @Published var addSource: KnowledgeImportSource?
    @Published private(set) var uploadQueue: [UploadItem] = []
    var onAuthenticationRequired: (() -> Void)?
    private var api: APIClient?
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var catalogRequest = UUID()
    private var sourceRequest = UUID()
    private var graphRequest = UUID()
    private var graphSourceRequest = UUID()
    private var supplementaryRequest = UUID()
    private var retryOwner: String?
    private var mutationJournal = KnowledgeMutationJournal()
    private var rawUploads: [String: KnowledgeRawUpload] = [:]
    private var cancelFileRead: (() -> Void)?

    var ownedLibraries: [SharedKnowledgeResponse] { libraries.filter { $0.viewerAccess == "owner" } }
    var selectedLibrary: SharedKnowledgeResponse? { libraries.first { $0.id == selectedLibraryId } }
    var materials: [KnowledgeMaterial] { KnowledgeLogic.materials(libraries, selectedId: selectedLibraryId) }
    var visibleMaterials: [KnowledgeMaterial] { KnowledgeLogic.materials(libraries, selectedId: selectedLibraryId, query: query, kind: kindFilter) }
    var allMaterials: [KnowledgeMaterial] { KnowledgeLogic.materials(libraries, selectedId: nil) }
    var pendingCount: Int { materials.filter { KnowledgeLogic.processing($0.document) }.count }
    var projection: NativeKnowledgeGraph { selectedLibrary.map(KnowledgeLogic.graph) ?? personalGraph.map(KnowledgeLogic.graph) ?? NativeKnowledgeGraph() }
    var pointsLibraries: [SharedKnowledgeResponse] { ownedLibraries.filter { selectedLibraryId == nil || $0.id == selectedLibraryId } }
    var isReadOnly: Bool { selectedLibrary?.viewerAccess == "reader" }
    var full: Bool { selectedLibrary.map { ($0.documents?.count ?? 0) >= (storage?.maxDocumentsPerLibrary ?? 100) } ?? false }
    var serviceOrigin: URL? { api?.endpoint.origin }

    /// Parent must call at every API / owner boundary, before routing to account UI.
    func configure(api: APIClient?, ownerId: String?) {
        guard self.api !== api || self.ownerId != ownerId else { return }
        ownerRevision = UUID()
        tasks.values.forEach { $0.cancel() }; tasks.removeAll()
        cancelFileRead?(); cancelFileRead = nil
        let retryOwner = ownerId.flatMap { owner in api.map { "\($0.endpoint.origin.absoluteString)|\(owner)" } }
        let ownerChanged = retryOwner == nil || retryOwner != self.retryOwner
        if ownerChanged { mutationJournal = KnowledgeMutationJournal(); rawUploads = [:]; uploadQueue = [] }
        else {
            for index in uploadQueue.indices where uploadQueue[index].state == "uploading" {
                uploadQueue[index].state = "failed"; uploadQueue[index].error = "上传结果尚未确认，可以安全重试。"
            }
        }
        self.retryOwner = retryOwner
        self.api = api; self.ownerId = ownerId
        catalogRequest = UUID(); sourceRequest = UUID(); graphRequest = UUID(); graphSourceRequest = UUID(); supplementaryRequest = UUID()
        libraries = []; storage = nil; batches = []; personalGraph = nil; source = nil; graphSource = nil; images = [:]
        loading = false; sourceLoading = false; graphLoading = false; graphSourceLoading = false; busy = false
        error = nil; sourceError = nil; graphError = nil; graphSourceError = nil; notice = nil; partialError = nil; importError = nil; storageError = nil; supplementaryLoading = false
        selectedLibraryId = nil; selectedSegmentId = nil; query = ""; kindFilter = ""; manageLibraries = false
        graphMode = .graph; graphQuery = ""; selectedNodeId = nil; selectedEdgeId = nil; addSource = nil
    }
    /// Capture the owner synchronously in a UI event, before an async task can be scheduled.
    /// Otherwise a click queued immediately before logout could start under the next account.
    func performUserAction(_ work: @escaping @MainActor () async -> Void) {
        let revision = ownerRevision, id = UUID()
        let task = Task { [weak self] in
            guard let self, self.current(revision) else { return }
            await work()
            self.tasks.removeValue(forKey: id)
        }
        tasks[id] = task
    }
    private func current(_ revision: UUID) -> Bool { ownerRevision == revision && ownerId != nil && api != nil && !Task.isCancelled }
    private func failed(_ failure: Error, revision: UUID) -> String? {
        guard current(revision), !(failure is CancellationError) else { return nil }
        if failure as? ClientError == .authenticationRequired {
            let callback = onAuthenticationRequired
            configure(api: nil, ownerId: nil)
            callback?()
            return nil
        }
        return failure.localizedDescription
    }
    private func tracked(_ work: @escaping @MainActor () async -> Void) async {
        let id = UUID(), task = Task { await work() }
        tasks[id] = task
        await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
        tasks.removeValue(forKey: id)
    }
    private func path(_ template: String, _ values: [String: String]) throws -> String {
        var result = template
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        for (key, value) in values {
            guard !value.isEmpty, value.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { throw ClientError.invalidResponse }
            result = result.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return result
    }
    func selectLibrary(_ id: String?, reload: Bool = true) {
        selectedLibraryId = id; query = ""; kindFilter = ""; manageLibraries = false; error = nil
        closeDocument(); closeGraphDetail(); graphQuery = ""
        if reload, let id {
            // Revalidate scope on entry, including revoked read-only access. Never reveal a
            // cached shared document while the fresh permission check is outstanding.
            catalogRequest = UUID()
            if let index = libraries.firstIndex(where: { $0.id == id }) { libraries[index].documents = [] }
            loading = true
            performUserAction { [weak self] in await self?.load() }
        }
    }
    func closeDocument() {
        sourceRequest = UUID(); source = nil; sourceError = nil; sourceLoading = false; selectedSegmentId = nil
    }
    func showAdd(source: KnowledgeImportSource = .extensionGuide) { addSource = source; error = nil; notice = nil }

    func load() async {
        guard let api, ownerId != nil else { return }
        let revision = ownerRevision, request = UUID(); catalogRequest = request
        loading = loading || libraries.isEmpty; error = nil; partialError = nil
        await tracked { [weak self] in
            guard let self else { return }
            do {
                let result: SharedKnowledgeListResponse = try await api.get(EverplainEndpoint.listSharedKnowledgeBases)
                guard self.current(revision), self.catalogRequest == request else { return }
                let visible = result.items.filter { ["owner", "reader"].contains($0.viewerAccess) }
                var detailed: [SharedKnowledgeResponse] = [], partial = false
                for item in visible {
                    try Task.checkCancellation()
                    do {
                        let value: SharedKnowledgeResponse = try await api.get(self.path(EverplainEndpoint.getSharedKnowledgeBase, ["kb_id": item.id]))
                        guard self.current(revision), self.catalogRequest == request else { return }
                        if ["owner", "reader"].contains(value.viewerAccess) { detailed.append(value) }
                        else { partial = true }
                    } catch {
                        guard self.current(revision), self.catalogRequest == request else { return }
                        if error as? ClientError == .authenticationRequired { throw error }
                        partial = true
                        var unavailable = item; unavailable.documents = []; detailed.append(unavailable)
                    }
                }
                guard self.current(revision), self.catalogRequest == request else { return }
                self.libraries = detailed
                let accessibleDocuments = Set(detailed.flatMap { ($0.documents ?? []).map(\.id) })
                self.images = self.images.filter { accessibleDocuments.contains($0.key) }
                self.partialError = partial ? "部分资料暂时无法读取。已保留可访问的资料，可以重试或打开对应知识库。" : nil
                if let id = self.selectedLibraryId, !detailed.contains(where: { $0.id == id }) { self.closeDocument(); self.error = "此知识库不可访问。" }
                if let original = self.source, let library = detailed.first(where: { $0.id == original.knowledgeBaseId }), let document = library.documents?.first(where: { $0.id == original.document.id }) {
                    var next = original; next.document = document; self.source = next
                } else if self.source != nil { self.closeDocument() }
            } catch { if self.current(revision), self.catalogRequest == request { self.error = self.failed(error, revision: revision) } }
            if self.current(revision), self.catalogRequest == request { self.loading = false }
        }
        if current(revision) { await loadSupplementary() }
    }
    func loadSupplementary() async {
        guard let api, ownerId != nil else { return }
        let revision = ownerRevision, request = UUID(); supplementaryRequest = request
        supplementaryLoading = true; storageError = nil; importError = nil
        await tracked { [weak self] in
            guard let self, self.current(revision) else { return }
            do { let value: KnowledgeStorageResponse = try await api.get(EverplainEndpoint.getKnowledgeStorage); if self.current(revision), self.supplementaryRequest == request { self.storage = value } }
            catch { if self.current(revision), self.supplementaryRequest == request { self.storageError = self.failed(error, revision: revision) } }
            guard self.current(revision), self.supplementaryRequest == request else { return }
            do { let value: ImportBatchListResponse = try await api.get(EverplainEndpoint.listImportBatches); if self.current(revision), self.supplementaryRequest == request { self.batches = value.items } }
            catch { if self.current(revision), self.supplementaryRequest == request { self.importError = self.failed(error, revision: revision) } }
            if self.current(revision), self.supplementaryRequest == request { self.supplementaryLoading = false }
        }
    }
    func openDocument(libraryId: String, documentId: String, segmentId: String? = nil) async {
        guard let api, ownerId != nil else { return }
        selectLibrary(libraryId, reload: false)
        selectedSegmentId = segmentId; sourceLoading = true; sourceError = nil
        let revision = ownerRevision, request = UUID(); sourceRequest = request
        await tracked { [weak self] in
            guard let self else { return }
            do {
                let library: SharedKnowledgeResponse = try await api.get(self.path(EverplainEndpoint.getSharedKnowledgeBase, ["kb_id": libraryId]))
                guard self.current(revision), self.sourceRequest == request else { return }
                guard ["owner", "reader"].contains(library.viewerAccess), library.documents?.contains(where: { $0.id == documentId }) == true else { throw ClientError.server(status: 403, code: "inaccessible", message: "此资料不可访问。") }
                self.upsert(library)
                let value: SharedDocumentSourceResponse = try await api.get(self.path(EverplainEndpoint.getSharedDocumentSource, ["kb_id": libraryId, "document_id": documentId]), query: segmentId.map { ["segment_id": $0] } ?? [:])
                guard self.current(revision), self.sourceRequest == request else { return }
                guard value.knowledgeBaseId == libraryId, value.document.id == documentId else { throw ClientError.invalidResponse }
                self.source = value
            } catch { if self.current(revision), self.sourceRequest == request { self.sourceError = self.failed(error, revision: revision) } }
            if self.current(revision), self.sourceRequest == request { self.sourceLoading = false }
        }
    }
    func loadGraph() async {
        guard let api, ownerId != nil else { return }
        let revision = ownerRevision, request = UUID(); graphRequest = request; graphLoading = personalGraph == nil; graphError = nil
        await tracked { [weak self] in
            guard let self else { return }
            do {
                let value: PersonalGraphResponse = try await api.get(EverplainEndpoint.getPersonalGraph)
                if self.current(revision), self.graphRequest == request { self.personalGraph = value }
            } catch { if self.current(revision), self.graphRequest == request { self.graphError = self.failed(error, revision: revision) } }
            if self.current(revision), self.graphRequest == request { self.graphLoading = false }
        }
    }
    func closeGraphDetail() {
        selectedNodeId = nil; selectedEdgeId = nil; graphSource = nil; graphSourceError = nil; graphSourceLoading = false; graphSourceRequest = UUID()
    }
    func selectNode(_ id: String) async {
        closeGraphDetail(); selectedNodeId = id; graphQuery = ""
        guard selectedLibraryId == nil, let record = personalGraph?.sources[id], let api else { return }
        let revision = ownerRevision, request = UUID(); graphSourceRequest = request; graphSourceLoading = true
        await tracked { [weak self] in
            guard let self else { return }
            do {
                let value: SharedDocumentSourceResponse = try await api.get(self.path(EverplainEndpoint.getSharedDocumentSource, ["kb_id": record.libraryId, "document_id": record.documentId]), query: record.segmentId.map { ["segment_id": $0] } ?? [:])
                guard self.current(revision), self.graphSourceRequest == request else { return }
                guard value.knowledgeBaseId == record.libraryId, value.document.id == record.documentId else { throw ClientError.invalidResponse }
                self.graphSource = value
            } catch { if self.current(revision), self.graphSourceRequest == request { self.graphSourceError = self.failed(error, revision: revision) } }
            if self.current(revision), self.graphSourceRequest == request { self.graphSourceLoading = false }
        }
    }
    func monitor() async {
        let revision = ownerRevision
        while !Task.isCancelled, ownerId != nil, ownerRevision == revision {
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard !Task.isCancelled, ownerRevision == revision else { return }
            if busy { continue }
            if allMaterials.contains(where: { KnowledgeLogic.processing($0.document) }) || batches.contains(where: { $0.status == "processing" }) { await load() }
            if (personalGraph?.pendingCount ?? 0) > 0 { await loadGraph() }
        }
    }
    private func upsert(_ library: SharedKnowledgeResponse) {
        if let index = libraries.firstIndex(where: { $0.id == library.id }) { libraries[index] = library } else { libraries.append(library) }
    }
    private func action(_ work: @escaping @MainActor (APIClient, UUID) async throws -> Void) async -> Bool {
        guard let api, ownerId != nil, !busy else { return false }
        let revision = ownerRevision; busy = true; error = nil; notice = nil
        var succeeded = false
        await tracked { [weak self] in
            guard let self else { return }
            do { guard self.current(revision) else { return }; try await work(api, revision); if self.current(revision) { await self.loadSupplementary() }; succeeded = self.current(revision) }
            catch { if self.current(revision) { self.error = self.failed(error, revision: revision) } }
            if self.current(revision) { self.busy = false }
        }
        return succeeded
    }
    private func mutate<Body: Encodable & Sendable, Value: Decodable & Sendable>(_ api: APIClient, revision: UUID, _ path: String,
                                                          method: String = "POST", body: Body) async throws -> Value {
        guard current(revision) else { throw CancellationError() }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let intent = mutationJournal.intent(path: path, method: method, body: try encoder.encode(body))
        let value: Value = try await api.mutate(path, method: method, body: body, key: intent.key)
        guard current(revision) else { throw CancellationError() }
        mutationJournal.finish(intent); return value
    }
    private func hasPendingMutation<Body: Encodable>(_ path: String, method: String = "POST", body: Body) throws -> Bool {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return mutationJournal.contains(path: path, method: method, body: try encoder.encode(body))
    }
    private func post<Value: Decodable & Sendable>(_ api: APIClient, revision: UUID, _ path: String) async throws -> Value {
        guard current(revision) else { throw CancellationError() }
        let intent = mutationJournal.intent(path: path, method: "POST", body: nil)
        let value: Value = try await api.post(path, key: intent.key)
        guard current(revision) else { throw CancellationError() }
        mutationJournal.finish(intent); return value
    }
    private func delete(_ api: APIClient, revision: UUID, _ path: String) async throws {
        guard current(revision) else { throw CancellationError() }
        let intent = mutationJournal.intent(path: path, method: "DELETE", body: nil)
        try await api.delete(path, key: intent.key)
        guard current(revision) else { throw CancellationError() }
        mutationJournal.finish(intent)
    }
    func saveLibrary(id: String?, name: String, description: String) async -> Bool {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 100, description.count <= 1000 else { error = "请填写有效的知识库名称与说明。"; return false }
        return await action { api, revision in
            let value: SharedKnowledgeResponse
            if let id {
                guard self.libraries.first(where: { $0.id == id })?.viewerAccess == "owner" else { throw ClientError.invalidResponse }
                value = try await self.mutate(api, revision: revision, self.path(EverplainEndpoint.updateSharedKnowledgeBase, ["kb_id": id]), method: "PATCH", body: UpdateSharedKnowledgeRequest(description: description, name: title))
            } else { value = try await self.mutate(api, revision: revision, EverplainEndpoint.createSharedKnowledgeBase, body: CreateSharedKnowledgeRequest(description: description, name: title)) }
            guard self.current(revision) else { return }; self.upsert(value); self.selectLibrary(value.id, reload: false)
        }
    }
    func deleteLibrary(_ id: String) async -> Bool {
        await action { api, revision in
            guard self.libraries.first(where: { $0.id == id })?.viewerAccess == "owner" else { throw ClientError.invalidResponse }
            try await self.delete(api, revision: revision, self.path(EverplainEndpoint.deleteSharedKnowledgeBase, ["kb_id": id]))
            guard self.current(revision) else { return }; if let library = self.libraries.first(where: { $0.id == id }) { for document in library.documents ?? [] { self.images.removeValue(forKey: document.id) } }
            self.uploadQueue.removeAll { $0.libraryId == id }
            self.rawUploads = self.rawUploads.filter { $0.value.libraryId != id }
            self.libraries.removeAll { $0.id == id }; self.selectLibrary(nil)
        }
    }
    func deleteDocument(_ material: KnowledgeMaterial) async -> Bool {
        await action { api, revision in
            guard self.libraries.first(where: { $0.id == material.library.id })?.viewerAccess == "owner", self.libraries.first(where: { $0.id == material.library.id })?.documents?.contains(where: { $0.id == material.document.id }) == true else { throw ClientError.invalidResponse }
            try await self.delete(api, revision: revision, self.path(EverplainEndpoint.detachSharedDocument, ["kb_id": material.library.id, "document_id": material.document.id]))
            guard self.current(revision) else { return }
            if let index = self.libraries.firstIndex(where: { $0.id == material.library.id }) { self.libraries[index].documents?.removeAll { $0.id == material.document.id } }
            self.images.removeValue(forKey: material.document.id)
            self.uploadQueue.removeAll { $0.document?.id == material.document.id }
            self.rawUploads = self.rawUploads.filter { $0.value.entryIDs.allSatisfy { id in self.uploadQueue.contains { $0.id == id } } }
            if self.source?.document.id == material.document.id { self.closeDocument() }
        }
    }
    func retryDocument(_ material: KnowledgeMaterial) async {
        _ = await action { api, revision in
            guard self.libraries.first(where: { $0.id == material.library.id })?.viewerAccess == "owner", self.libraries.first(where: { $0.id == material.library.id })?.documents?.contains(where: { $0.id == material.document.id }) == true else { throw ClientError.invalidResponse }
            let result: SharedDocumentResponse = try await self.post(api, revision: revision, self.path(EverplainEndpoint.organizeSharedDocument, ["kb_id": material.library.id, "document_id": material.document.id]))
            if self.current(revision) { self.replaceDocument(result, libraryId: material.library.id) }
        }
    }
    private func replaceDocument(_ value: SharedDocumentResponse, libraryId: String) {
        if let index = libraries.firstIndex(where: { $0.id == libraryId }) {
            var documents = libraries[index].documents ?? []
            if let position = documents.firstIndex(where: { $0.id == value.id }) { documents[position] = value } else { documents.append(value) }
            libraries[index].documents = documents
        }
        if source?.knowledgeBaseId == libraryId, source?.document.id == value.id { source?.document = value }
    }
    func saveKnowledge(_ input: UpdateDocumentKnowledgeRequest) async -> Bool {
        guard let source, selectedLibrary?.viewerAccess == "owner" else { return false }
        if let reason = KnowledgeLogic.validateKnowledge(input, segments: Set(source.segments.map(\.segmentId))) { error = reason; return false }
        return await action { api, revision in
            let value: SharedDocumentResponse = try await self.mutate(api, revision: revision, self.path(EverplainEndpoint.updateDocumentKnowledge, ["kb_id": source.knowledgeBaseId, "document_id": source.document.id]), method: "PUT", body: input)
            if self.current(revision) { self.replaceDocument(value, libraryId: source.knowledgeBaseId) }
        }
    }
    func refreshGraph() async {
        _ = await action { api, revision in
            let value: PersonalGraphResponse = try await self.post(api, revision: revision, EverplainEndpoint.refreshPersonalGraph)
            if self.current(revision) { self.personalGraph = value }
        }
    }
    func importBilibili(_ uid: String) async {
        let value = uid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard KnowledgeImportSource.validPublicUID(value) else { error = "请填写 1 至 20 位数字的公开账户 UID。"; return }
        if await action({ api, revision in
            let batch: ImportBatchResponse = try await self.mutate(api, revision: revision, EverplainEndpoint.createBilibiliImport, body: BilibiliImportRequest(uid: value))
            if self.current(revision) { self.batches.insert(batch, at: 0); self.notice = "已接收 \(batch.total) 条资料，正在后台导入" }
        }) { await load() }
    }
    func retryImport(batchId: String, itemId: String) async {
        if await action({ api, revision in
            let _: ImportBatchResponse = try await self.post(api, revision: revision, self.path(EverplainEndpoint.retryImportItem, ["batch_id": batchId, "item_id": itemId]))
            guard self.current(revision) else { return }
        }) { await load() }
    }
    func upload(urls: [URL], source: KnowledgeImportSource, targetLibraryId: String?, folder: URL? = nil, relativeNames: [URL: String] = [:]) async {
        guard !urls.isEmpty else { return }
        if await action({ api, revision in
            let quota: KnowledgeStorageResponse = try await api.get(EverplainEndpoint.getKnowledgeStorage)
            guard self.current(revision) else { return }; self.storage = quota
            let files = try await self.background(revision: revision) {
                try Self.readFiles(urls, source: source, quota: quota, folder: folder, relativeNames: relativeNames)
            }
            let fingerprint = try KnowledgePreparedFile.fingerprint(files, source: source)
            if source != .file {
                guard quota.usedBytes < quota.maxBytes || self.mutationJournal.contains(path: EverplainEndpoint.createImportBatch, method: "POST", body: fingerprint) else { throw KnowledgeFailure("存储空间已满，请先整理资料。") }
                let intent = self.mutationJournal.intent(path: EverplainEndpoint.createImportBatch, method: "POST", body: fingerprint)
                let form = try await self.background(revision: revision) {
                    let parts = [MultipartBody.Part.field(name: "source_type", value: source.rawValue)] + files.map {
                        MultipartBody.Part.file(name: "files", filename: $0.filename, mimeType: $0.mimeType, bytes: $0.bytes)
                    }
                    return try MultipartBody(parts: parts, boundary: intent.boundary)
                }
                let batch: ImportBatchResponse = try await api.upload(EverplainEndpoint.createImportBatch, form: form, key: intent.key)
                guard self.current(revision) else { return }
                self.mutationJournal.finish(intent)
                self.batches.removeAll { $0.id == batch.id }; self.batches.insert(batch, at: 0)
                self.notice = "已接收 \(batch.total) 条资料，正在后台导入"
                return
            }
            let attemptId = self.rawAttempt(fingerprint: ResearchUploadDigest.hash(fingerprint), targetLibraryId: targetLibraryId)
            guard let attempt = self.rawUploads[attemptId] else { throw CancellationError() }
            let defaultBody = CreateSharedKnowledgeRequest(description: "", name: "我的资料")
            let retryingCreation = try self.hasPendingMutation(EverplainEndpoint.createSharedKnowledgeBase, body: defaultBody)
            let library: SharedKnowledgeResponse
            if let destination = attempt.libraryId ?? targetLibraryId {
                library = try await api.get(self.path(EverplainEndpoint.getSharedKnowledgeBase, ["kb_id": destination]))
            } else if retryingCreation {
                // Resolve an uncertain create before choosing from a subsequently refreshed catalog.
                library = try await self.mutate(api, revision: revision, EverplainEndpoint.createSharedKnowledgeBase, body: defaultBody)
            } else if let existing = self.ownedLibraries.first {
                library = try await api.get(self.path(EverplainEndpoint.getSharedKnowledgeBase, ["kb_id": existing.id]))
            } else {
                guard quota.libraryCount < quota.maxLibraries else { throw KnowledgeFailure("知识库数量已达上限，请先整理已有知识库。") }
                library = try await self.mutate(api, revision: revision, EverplainEndpoint.createSharedKnowledgeBase, body: defaultBody)
            }
            guard self.current(revision) else { return }
            guard library.viewerAccess == "owner" else { throw KnowledgeFailure("此知识库为只读，不能上传资料。") }
            // Record a confirmed destination before any subsequent quota, upload or refresh failure.
            self.rawUploads[attemptId]?.libraryId = library.id
            self.upsert(library)
            let prior = attempt.entryIDs.compactMap { id in self.uploadQueue.first(where: { $0.id == id }) }
            let entries: [UploadItem]
            if attempt.entryIDs.isEmpty {
                guard (library.documents?.count ?? 0) + files.count <= quota.maxDocumentsPerLibrary else { throw KnowledgeFailure("当前知识库剩余位置不足，请选择其他知识库。") }
                guard files.reduce(0, { $0 + $1.bytes.count }) <= max(0, quota.maxBytes - quota.usedBytes) else { throw KnowledgeFailure("存储空间不足。") }
                entries = files.map { file in
                    let token = UUID().uuidString
                    return UploadItem(id: UUID(), filename: file.filename, bytes: file.bytes, mimeType: file.mimeType, libraryId: library.id, key: token, boundary: "----everplain-" + token)
                }
                self.uploadQueue += entries; self.rawUploads[attemptId]?.entryIDs = entries.map(\.id)
            } else {
                guard prior.count == attempt.entryIDs.count else { throw KnowledgeFailure("上传队列已变化，请重新选择文件。") }
                entries = prior
            }
            for entry in entries where entry.document == nil {
                guard self.current(revision) else { return }
                await self.sendUpload(entry, api: api, revision: revision)
            }
            if self.current(revision) { self.notice = "上传结果已保留。资料在后台建立语义索引并整理知识。" }
        }) { await load() }
    }

    private func rawAttempt(fingerprint: String, targetLibraryId: String?) -> String {
        if let existing = rawUploads.first(where: {
            $0.value.fingerprint == fingerprint && ($0.value.requestedLibraryId == targetLibraryId || (targetLibraryId != nil && $0.value.libraryId == targetLibraryId))
        }) { return existing.key }
        let id = UUID().uuidString
        rawUploads[id] = KnowledgeRawUpload(fingerprint: fingerprint, requestedLibraryId: targetLibraryId, libraryId: targetLibraryId)
        return id
    }
    private func finishRawUploads() {
        rawUploads = rawUploads.filter { _, attempt in
            attempt.entryIDs.isEmpty || !attempt.entryIDs.allSatisfy { id in uploadQueue.contains { $0.id == id && $0.document != nil } }
        }
    }
    private func background<Value: Sendable>(revision: UUID, _ work: @escaping @Sendable () throws -> Value) async throws -> Value {
        guard current(revision) else { throw CancellationError() }
        let task = Task.detached(priority: .userInitiated, operation: work)
        cancelFileRead = { task.cancel() }
        defer { if ownerRevision == revision { cancelFileRead = nil } }
        let value = try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
        guard current(revision) else { throw CancellationError() }; return value
    }
    private nonisolated static func readFiles(_ urls: [URL], source: KnowledgeImportSource, quota: KnowledgeStorageResponse,
                                             folder: URL?, relativeNames: [URL: String]) throws -> [KnowledgePreparedFile] {
        let folderAccess = folder?.startAccessingSecurityScopedResource() ?? false
        defer { if folderAccess { folder?.stopAccessingSecurityScopedResource() } }
        var files: [KnowledgePreparedFile] = [], total = 0
        // Exact transport retries may already have consumed the remaining server quota. Read the
        // bytes first; only new queue entries are checked against remaining capacity above.
        let totalLimit = source == .file ? max(0, quota.maxBytes) : 64 * 1024 * 1024
        for url in urls {
            try Task.checkCancellation()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let keys: Set<URLResourceKey> = [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey]
            let attributes = try url.resourceValues(forKeys: keys)
            guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { throw KnowledgeFailure("请选择普通文件，不能上传符号链接。") }
            if let folder, !url.standardizedFileURL.path.hasPrefix(folder.standardizedFileURL.path + "/") { throw KnowledgeFailure("文件不在所选文件夹内。") }
            let filename = relativeNames[url] ?? folder.map { $0.lastPathComponent + "/" + String(url.standardizedFileURL.path.dropFirst(($0.standardizedFileURL.path + "/").count)) } ?? url.lastPathComponent
            guard (source == .obsidian && (folder != nil || relativeNames[url] != nil)) || source.accepts(filename: filename) else { throw KnowledgeFailure("请选择\(source.formats)文件。") }
            let limit = source == .file ? quota.maxFileBytes : 16 * 1024 * 1024
            guard let size = attributes.fileSize, size >= 0, size <= limit else { throw KnowledgeFailure("单个文件超过允许大小。") }
            guard size <= totalLimit - total else { throw KnowledgeFailure(source == .file ? "存储空间不足。" : "每批导入文件最多 64 MB，请分批导入。") }
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var bytes = Data(), digest = ResearchUploadDigest()
            while true {
                try Task.checkCancellation()
                guard let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty else { break }
                guard chunk.count <= size - bytes.count else { throw KnowledgeFailure("文件已变化，请重新选择。") }
                bytes.append(chunk); digest.update(chunk)
            }
            try Task.checkCancellation()
            let after = try url.resourceValues(forKeys: keys)
            guard bytes.count == size, after.fileSize == size, after.contentModificationDate == attributes.contentModificationDate,
                  after.isRegularFile == true, after.isSymbolicLink != true else { throw KnowledgeFailure("文件已变化，请重新选择。") }
            total += bytes.count
            files.append(KnowledgePreparedFile(filename: filename, bytes: bytes, mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream", digest: digest.finalized()))
        }
        return files
    }
    private func sendUpload(_ entry: UploadItem, api: APIClient, revision: UUID) async {
        guard let index = uploadQueue.firstIndex(where: { $0.id == entry.id }), current(revision) else { return }
        uploadQueue[index].state = "uploading"; uploadQueue[index].error = nil
        do {
            let form = try await background(revision: revision) {
                try MultipartBody(parts: [.file(name: "file", filename: entry.filename, mimeType: entry.mimeType, bytes: entry.bytes)], boundary: entry.boundary)
            }
            let result: SharedDocumentResponse = try await api.upload(path(EverplainEndpoint.uploadSharedDocument, ["kb_id": entry.libraryId]), form: form, key: entry.key)
            guard current(revision), let index = uploadQueue.firstIndex(where: { $0.id == entry.id }) else { return }
            uploadQueue[index].state = result.status == "failed" ? "failed" : "done"; uploadQueue[index].document = result
            uploadQueue[index].error = result.status == "failed" ? result.errorMessage ?? "解析失败，请重新上传可读取的文件。" : nil
            replaceDocument(result, libraryId: entry.libraryId); finishRawUploads()
        } catch {
            let message = failed(error, revision: revision)
            guard current(revision), let index = uploadQueue.firstIndex(where: { $0.id == entry.id }) else { return }
            uploadQueue[index].state = "failed"; uploadQueue[index].error = message
        }
    }
    func retryUpload(_ id: UUID) async {
        guard let entry = uploadQueue.first(where: { $0.id == id }) else { return }
        _ = await action { api, revision in
            // A transport retry uses the identical bytes and idempotency key.
            // A parsed failure is a new explicit upload intent and gets a new key.
            let token = UUID().uuidString
            let retry = entry.document == nil ? entry : UploadItem(id: entry.id, filename: entry.filename, bytes: entry.bytes, mimeType: entry.mimeType, libraryId: entry.libraryId, key: token, boundary: "----everplain-" + token)
            if let index = self.uploadQueue.firstIndex(where: { $0.id == id }) { self.uploadQueue[index] = retry }
            await self.sendUpload(retry, api: api, revision: revision)
        }
    }
    func loadImage(documentId: String) async {
        guard images[documentId] == nil, let api, ownerId != nil else { return }; let revision = ownerRevision
        await tracked { [weak self] in
            guard let self else { return }
            do {
                let content = try await api.download(self.path(EverplainEndpoint.getImportImageAsset, ["document_id": documentId]))
                if self.current(revision), content.mimeType.hasPrefix("image/"), content.data.count <= 20 * 1024 * 1024 { self.images[documentId] = content.data }
            } catch { _ = self.failed(error, revision: revision) }
        }
    }
    func setSharing(libraryId: String, enabled: Bool) async -> Bool {
        await action { api, revision in
            guard self.libraries.first(where: { $0.id == libraryId })?.viewerAccess == "owner" else { throw ClientError.invalidResponse }
            let value: SharedKnowledgeResponse = try await self.mutate(api, revision: revision, self.path(EverplainEndpoint.updateSharedKnowledgeBase, ["kb_id": libraryId]), method: "PATCH", body: UpdateSharedKnowledgeRequest(sharingEnabled: enabled))
            if self.current(revision) { self.upsert(value) }
        }
    }
    func joinLibrary(invitation: String) async -> Bool {
        let trimmed = invitation.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = URLComponents(string: trimmed)?.queryItems?.first(where: { $0.name == "invite" })?.value ?? trimmed
        guard !token.isEmpty, token.count <= 2048, token.rangeOfCharacter(from: .controlCharacters) == nil else { error = "请填写有效的邀请链接或口令。"; return false }
        let joined = await action { api, revision in
            let _: SharedKnowledgeJoinResponse = try await self.mutate(api, revision: revision, EverplainEndpoint.joinSharedKnowledgeBase, body: JoinSharedKnowledgeRequest(shareToken: token))
            if self.current(revision) { self.notice = "已加入知识库，可以阅读对方共享的资料。" }
        }
        if joined { await load() }
        return joined
    }
    func leaveLibrary(_ id: String) async -> Bool {
        await action { api, revision in
            guard self.libraries.first(where: { $0.id == id })?.viewerAccess == "reader" else { throw ClientError.invalidResponse }
            try await self.delete(api, revision: revision, self.path(EverplainEndpoint.leaveSharedKnowledgeBase, ["kb_id": id]))
            guard self.current(revision) else { return }
            self.libraries.removeAll { $0.id == id }
            if self.selectedLibraryId == id { self.selectLibrary(nil) }
            self.notice = "已退出知识库。"
        }
    }
    func publishLibrary(_ id: String, title: String, description: String, topics: [String], confirmedPublic: Bool, expectedDocumentCount: Int) async -> Bool {
        guard confirmedPublic else { error = "请确认将当前资料与原文公开。"; return false }
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 100, description.count <= 1000, topics.count <= 12 else { error = "请核对标题、简介与主题标签。"; return false }
        return await action { api, revision in
            guard self.libraries.first(where: { $0.id == id })?.viewerAccess == "owner" else { throw ClientError.invalidResponse }
            let latest: SharedKnowledgeResponse = try await api.get(self.path(EverplainEndpoint.getSharedKnowledgeBase, ["kb_id": id]))
            guard self.current(revision) else { return }
            guard latest.viewerAccess == "owner" else { throw ClientError.invalidResponse }
            guard (latest.readyDocumentCount ?? latest.documents?.filter { $0.status == "ready" }.count ?? 0) == expectedDocumentCount else { self.upsert(latest); throw KnowledgeFailure("可读资料数量已变化，请关闭后重新核对要公开的资料。") }
            let value: PublicKnowledgePublicationResponse = try await self.mutate(api, revision: revision, self.path(EverplainEndpoint.publishKnowledgeMetadata, ["kb_id": id]), method: "PUT", body: PublishKnowledgeRequest(confirmPublicContent: true, description: description, title: title, topics: topics))
            guard self.current(revision) else { return }
            if let index = self.libraries.firstIndex(where: { $0.id == id }) { self.libraries[index].publication = value }
        }
    }
    func unpublishLibrary(_ id: String) async -> Bool {
        await action { api, revision in
            guard self.libraries.first(where: { $0.id == id })?.viewerAccess == "owner" else { throw ClientError.invalidResponse }
            try await self.delete(api, revision: revision, self.path(EverplainEndpoint.unpublishKnowledgeMetadata, ["kb_id": id]))
            guard self.current(revision) else { return }
            if let index = self.libraries.firstIndex(where: { $0.id == id }) { self.libraries[index].publication = nil }
        }
    }
    func invitationURL(for library: SharedKnowledgeResponse) -> URL? {
        guard library.viewerAccess == "owner", library.sharingEnabled == true, let token = library.shareToken, let origin = serviceOrigin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/sharing"; components.queryItems = [URLQueryItem(name: "invite", value: token)]
        return components.url
    }
    func sourceURL(for material: KnowledgeMaterial) -> URL? {
        for batch in batches where batch.libraryId == material.library.id {
            if let item = batch.items.first(where: { $0.documentId == material.document.id }) { return KnowledgeLogic.safeWebURL(item.sourceUrl) }
        }
        return nil
    }
}
private struct KnowledgeRawUpload {
    let fingerprint: String
    let requestedLibraryId: String?
    var libraryId: String?
    var entryIDs: [UUID] = []
}
private struct KnowledgePreparedFile: Sendable {
    let filename: String
    let bytes: Data
    let mimeType: String
    let digest: String
    static func fingerprint(_ files: [Self], source: KnowledgeImportSource) throws -> Data {
        struct FileBody: Encodable { let filename: String; let mimeType: String; let count: Int; let sha256: String }
        struct BatchBody: Encodable { let source: String; let files: [FileBody] }
        let body = BatchBody(source: source.rawValue, files: files.map { FileBody(filename: $0.filename, mimeType: $0.mimeType, count: $0.bytes.count, sha256: $0.digest) })
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(body)
    }
}
/// Owner-scoped by KnowledgeStore.configure. No request bodies or file contents are retained here.
private struct KnowledgeMutationJournal {
    struct Fingerprint: Hashable, Sendable { let path: String; let method: String; let bodyDigest: String? }
    struct Intent: Sendable { let fingerprint: Fingerprint; let key: String; let boundary: String }
    private var pending: [Fingerprint: Intent] = [:]
    func contains(path: String, method: String, body: Data?) -> Bool {
        pending[Fingerprint(path: path, method: method.uppercased(), bodyDigest: body.map(ResearchUploadDigest.hash))] != nil
    }
    mutating func intent(path: String, method: String, body: Data?) -> Intent {
        let fingerprint = Fingerprint(path: path, method: method.uppercased(), bodyDigest: body.map(ResearchUploadDigest.hash))
        if let current = pending[fingerprint] { return current }
        let token = UUID().uuidString
        let value = Intent(fingerprint: fingerprint, key: token, boundary: "----everplain-" + token)
        pending[fingerprint] = value; return value
    }
    mutating func finish(_ intent: Intent) {
        guard pending[intent.fingerprint]?.key == intent.key else { return }
        pending.removeValue(forKey: intent.fingerprint)
    }
}
private struct KnowledgeFailure: LocalizedError { let message: String; init(_ message: String) { self.message = message }; var errorDescription: String? { message } }
#endif
