import Foundation
import EverplainCore
actor Gate {
    var continuation: CheckedContinuation<Void, Never>?
    var entered = false
    func wait() async { entered = true; await withCheckedContinuation { continuation = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
actor MutationCounter { var value = 0; func increment() { value += 1 } }
actor RequestLog {
    private var requests: [APIClient.Request] = []
    private var failures = Int.max
    func failNext(_ count: Int) { failures = count }
    func capture(_ request: APIClient.Request) -> Bool {
        requests.append(request)
        guard request.method != "GET", failures > 0 else { return false }
        failures -= 1; return true
    }
    func writes() -> [APIClient.Request] { requests.filter { $0.method != "GET" } }
}
actor AutoLibraryScenario {
    var requests: [APIClient.Request] = []
    var creations = 0
    var uploads = 0
    let library: Data, document: Data, emptyList: Data, batches: Data
    init(library: Data, document: Data, emptyList: Data, batches: Data) {
        self.library = library; self.document = document; self.emptyList = emptyList; self.batches = batches
    }
    func respond(_ request: APIClient.Request) throws -> Data {
        requests.append(request)
        if request.method == "GET" {
            if request.path == EverplainEndpoint.getKnowledgeStorage {
                return try JSONEncoder().encode(KnowledgeStorageResponse(libraryCount: creations > 0 ? 1 : 0, maxBytes: 1000, maxDocumentCharacters: 1000, maxDocumentsPerLibrary: 10, maxFileBytes: 100, maxLibraries: 1, usedBytes: uploads > 0 ? 1000 : 0))
            }
            if request.path == EverplainEndpoint.listSharedKnowledgeBases { return emptyList }
            if request.path == EverplainEndpoint.listImportBatches { return batches }
            return library
        }
        if request.contentType != nil {
            uploads += 1
            if uploads == 1 { throw URLError(.timedOut) }
            return document
        }
        creations += 1
        if creations == 1 { throw URLError(.timedOut) }
        return library
    }
}
@main struct Harness {
    @MainActor static func main() async throws {
        let document = SharedDocumentResponse(createdAt: "fixture", filename: "Synthetic.md", id: "doc", indexStatus: "ready", knowledgeStatus: "ready", mediaType: "text/plain", parseId: "parse", sizeBytes: 1, status: "ready")
        let library = SharedKnowledgeResponse(documents: [document], id: "lib", name: "Synthetic library", viewerAccess: "owner")
        let encoder = JSONEncoder()
        let listData = try encoder.encode(SharedKnowledgeListResponse(items: [library])), libraryData = try encoder.encode(library)
        let quotaData = try encoder.encode(KnowledgeStorageResponse(libraryCount: 1, maxBytes: 1000, maxDocumentCharacters: 1000, maxDocumentsPerLibrary: 10, maxFileBytes: 100, maxLibraries: 10, usedBytes: 1))
        let batchesData = try encoder.encode(ImportBatchListResponse(items: []))
        let old = APIClient()
        old.handler = { path in path == EverplainEndpoint.listSharedKnowledgeBases ? listData : path == EverplainEndpoint.getKnowledgeStorage ? quotaData : path == EverplainEndpoint.listImportBatches ? batchesData : libraryData }
        let store = KnowledgeStore()
        store.configure(api: old, ownerId: "owner-a")
        await store.load()
        precondition(store.libraries.count == 1 && store.storage != nil)
        store.query = "private search"; store.graphQuery = "private graph"; store.showAdd(source: .file)
        let oldRevision = store.ownerRevision
        store.configure(api: APIClient(), ownerId: "owner-b")
        precondition(store.ownerRevision != oldRevision && store.libraries.isEmpty && store.storage == nil && store.source == nil && store.personalGraph == nil && store.batches.isEmpty && store.query.isEmpty && store.graphQuery.isEmpty && store.addSource == nil && store.uploadQueue.isEmpty && !store.busy)
        print("PASS synchronous owner reset")
        let gate = Gate(), delayed = APIClient()
        delayed.handler = { _ in await gate.wait(); return listData }
        store.configure(api: delayed, ownerId: "owner-a")
        let request = Task { await store.load() }
        while !(await gate.entered) { await Task.yield() }
        store.configure(api: APIClient(), ownerId: "owner-b")
        await gate.release(); await request.value
        precondition(store.ownerId == "owner-b" && store.libraries.isEmpty && !store.loading && store.error == nil)
        print("PASS canceled late catalog cannot restore old owner data")
        let expired = APIClient(); expired.handler = { _ in throw ClientError.authenticationRequired }
        var authCallbacks = 0
        store.onAuthenticationRequired = { authCallbacks += 1 }
        store.configure(api: expired, ownerId: "owner-c")
        await store.load()
        precondition(authCallbacks == 1 && store.ownerId == nil && store.libraries.isEmpty && !store.loading)
        print("PASS authentication expiry clears before notifying parent")
        let sourceGate = Gate(), sourceAPI = APIClient()
        var second = document; second.id = "doc2"
        var both = library; both.documents = [document, second]
        let bothData = try encoder.encode(both)
        let source1 = try encoder.encode(SharedDocumentSourceResponse(document: document, knowledgeBaseId: "lib", knowledgeBaseName: "Synthetic", segments: []))
        let source2 = try encoder.encode(SharedDocumentSourceResponse(document: second, knowledgeBaseId: "lib", knowledgeBaseName: "Synthetic", segments: []))
        sourceAPI.handler = { path in
            if path.hasSuffix("/doc/source") { await sourceGate.wait(); return source1 }
            if path.hasSuffix("/doc2/source") { return source2 }
            return bothData
        }
        store.configure(api: sourceAPI, ownerId: "owner-d")
        let earlier = Task { await store.openDocument(libraryId: "lib", documentId: "doc") }
        while !(await sourceGate.entered) { await Task.yield() }
        await store.openDocument(libraryId: "lib", documentId: "doc2")
        await sourceGate.release(); await earlier.value
        precondition(store.source?.document.id == "doc2" && !store.sourceLoading)
        print("PASS newer document navigation rejects stale source")
        let counter = MutationCounter(), nextAPI = APIClient()
        nextAPI.mutationObserver = { await counter.increment() }
        nextAPI.handler = { _ in libraryData }
        store.configure(api: sourceAPI, ownerId: "prior-owner")
        store.performUserAction { _ = await store.saveLibrary(id: nil, name: "Queued prior-owner value", description: "") }
        store.configure(api: nextAPI, ownerId: "next-owner")
        for _ in 0..<20 { await Task.yield() }
        let queuedWrites = await counter.value
        precondition(queuedWrites == 0 && store.libraries.isEmpty)
        print("PASS queued UI mutation cannot start under a new owner")
        let publishAPI = APIClient()
        let publishCounter = MutationCounter()
        publishAPI.mutationObserver = { await publishCounter.increment() }
        var changed = library; changed.readyDocumentCount = 2
        let changedData = try encoder.encode(changed)
        publishAPI.handler = { path in path == EverplainEndpoint.listSharedKnowledgeBases ? listData : path == EverplainEndpoint.getKnowledgeStorage ? quotaData : path == EverplainEndpoint.listImportBatches ? batchesData : changedData }
        store.configure(api: publishAPI, ownerId: "fixture-publisher")
        await store.load()
        let unchecked = await store.publishLibrary("lib", title: "Synthetic public title", description: "", topics: [], confirmedPublic: false, expectedDocumentCount: 1)
        precondition(!unchecked)
        let changedCount = await store.publishLibrary("lib", title: "Synthetic public title", description: "", topics: [], confirmedPublic: true, expectedDocumentCount: 1)
        let publicWrites = await publishCounter.value
        precondition(!changedCount && publicWrites == 0 && store.error?.contains("数量已变化") == true)
        print("PASS public publish requires checkbox and unchanged reviewed document count")
        try await retryChecks(document: document, library: library, listData: listData, libraryData: libraryData, quotaData: quotaData, batchesData: batchesData)
        print("Passed 12 offline KnowledgeStore checks. No network or real account mutation occurred.")
    }

    @MainActor static func retryChecks(document: SharedDocumentResponse, library: SharedKnowledgeResponse,
                                      listData: Data, libraryData: Data, quotaData: Data, batchesData: Data) async throws {
        let log = RequestLog(), api = APIClient(), store = KnowledgeStore()
        api.requestHandler = { request in
            if await log.capture(request) { throw URLError(.timedOut) }
            if request.path == EverplainEndpoint.getKnowledgeStorage { return quotaData }
            if request.path == EverplainEndpoint.listImportBatches { return batchesData }
            if request.method == "GET", request.path == EverplainEndpoint.listSharedKnowledgeBases { return listData }
            return libraryData
        }
        store.configure(api: api, ownerId: "retry-owner")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "original")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "original")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "changed")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "original")
        var writes = await log.writes()
        precondition(writes.count == 4 && writes[0].key == writes[1].key && writes[0].key == writes[3].key && writes[0].key != writes[2].key)
        await log.failNext(0)
        let acknowledged = await store.saveLibrary(id: nil, name: "Same intent", description: "original")
        let nextIntent = await store.saveLibrary(id: nil, name: "Same intent", description: "original")
        precondition(acknowledged && nextIntent)
        writes = await log.writes()
        precondition(writes[4].key == writes[0].key && writes[5].key != writes[4].key)
        await log.failNext(Int.max)
        let replacementAPI = APIClient(); replacementAPI.requestHandler = api.requestHandler
        store.configure(api: replacementAPI, ownerId: "retry-owner")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "changed")
        store.configure(api: replacementAPI, ownerId: "different-retry-owner")
        _ = await store.saveLibrary(id: nil, name: "Same intent", description: "changed")
        writes = await log.writes()
        precondition(writes[6].key == writes[2].key && writes[7].key != writes[6].key)
        print("PASS real create retries retain canonical-body key; changed body and confirmed new intent use new keys")

        await log.failNext(Int.max)
        await store.load()
        let material = KnowledgeMaterial(library: library, document: document)
        _ = await store.deleteDocument(material); _ = await store.deleteDocument(material)
        await store.retryDocument(material); await store.retryDocument(material)
        writes = await log.writes()
        let deletes = writes.filter { $0.method == "DELETE" }
        let posts = writes.filter { $0.path.hasSuffix("/organize") }
        precondition(deletes.count == 2 && deletes[0].key == deletes[1].key)
        precondition(posts.count == 2 && posts[0].key == posts[1].key && posts[0].key != deletes[0].key)
        print("PASS real DELETE and bodyless POST retries retain separate keys")

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("knowledge-retry-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = directory.appendingPathComponent("first.md"), second = directory.appendingPathComponent("second.md")
        try Data("original".utf8).write(to: first); try Data("second".utf8).write(to: second)
        let importLog = RequestLog(), importAPI = APIClient()
        importAPI.requestHandler = { request in
            if await importLog.capture(request) { throw URLError(.timedOut) }
            return quotaData
        }
        store.configure(api: importAPI, ownerId: "import-owner")
        await store.upload(urls: [first, second], source: .obsidian, targetLibraryId: nil)
        await store.upload(urls: [first, second], source: .obsidian, targetLibraryId: nil)
        try Data("modified".utf8).write(to: first) // Same name and byte count, changed bytes.
        await store.upload(urls: [first, second], source: .obsidian, targetLibraryId: nil)
        try Data("original".utf8).write(to: first)
        await store.upload(urls: [second, first], source: .obsidian, targetLibraryId: nil)
        await store.upload(urls: [first, second], source: .appleNotes, targetLibraryId: nil)
        let imports = await importLog.writes()
        precondition(imports.count == 5)
        precondition(imports[0].key == imports[1].key && imports[0].body == imports[1].body && imports[0].contentType == imports[1].contentType)
        precondition(Set(imports.dropFirst().map(\.key)).count == 4)
        print("PASS actual import bytes and boundary replay exactly; content, order, and source changes separate intents")

        let queueLog = RequestLog(), queueAPI = APIClient(), documentData = try JSONEncoder().encode(document)
        queueAPI.requestHandler = { request in
            if await queueLog.capture(request) { throw URLError(.timedOut) }
            if request.path == EverplainEndpoint.getKnowledgeStorage { return quotaData }
            if request.path == EverplainEndpoint.listImportBatches { return batchesData }
            if request.path == EverplainEndpoint.listSharedKnowledgeBases { return listData }
            if request.contentType != nil { return documentData }
            return libraryData
        }
        store.configure(api: queueAPI, ownerId: "queue-owner")
        await store.upload(urls: [first], source: .file, targetLibraryId: "lib")
        precondition(store.uploadQueue.count == 1 && store.uploadQueue[0].document == nil)
        let id = store.uploadQueue[0].id
        // Retry retains the original queue bytes even if the selected disk file subsequently changes.
        try Data("different on disk".utf8).write(to: first)
        await queueLog.failNext(0); await store.retryUpload(id)
        let uploads = await queueLog.writes()
        precondition(uploads.count == 2 && uploads[0].key == uploads[1].key && uploads[0].body == uploads[1].body && uploads[0].contentType == uploads[1].contentType)
        precondition(store.uploadQueue[0].document?.id == document.id)
        print("PASS raw queue retries preserve original bytes, key, boundary, and queue identity")

        var emptyLibrary = library; emptyLibrary.documents = []
        let emptyLibraryData = try JSONEncoder().encode(emptyLibrary)
        let emptyList = try JSONEncoder().encode(SharedKnowledgeListResponse(items: []))
        let automatic = AutoLibraryScenario(library: emptyLibraryData, document: documentData, emptyList: emptyList, batches: batchesData)
        let autoAPI = APIClient(); autoAPI.requestHandler = { try await automatic.respond($0) }
        store.configure(api: autoAPI, ownerId: "auto-owner")
        await store.upload(urls: [first], source: .file, targetLibraryId: nil)
        precondition(store.uploadQueue.isEmpty)
        await store.upload(urls: [first], source: .file, targetLibraryId: nil)
        precondition(store.uploadQueue.count == 1 && store.uploadQueue[0].document == nil)
        let pendingID = store.uploadQueue[0].id
        await store.upload(urls: [first], source: .file, targetLibraryId: nil)
        let autoRequests = await automatic.requests
        let creates = autoRequests.filter { $0.method == "POST" && $0.contentType == nil }
        let autoUploads = autoRequests.filter { $0.contentType != nil }
        precondition(creates.count == 2 && creates[0].key == creates[1].key)
        precondition(autoUploads.count == 2 && autoUploads[0].key == autoUploads[1].key && autoUploads[0].body == autoUploads[1].body)
        precondition(store.uploadQueue.count == 1 && store.uploadQueue[0].id == pendingID && store.uploadQueue[0].document != nil)
        print("PASS uncertain automatic library creation replays once; confirmed destination and queue survive empty catalog/full quota")

        let ownerGate = Gate(), oldLog = RequestLog(), newLog = RequestLog(), delayedAPI = APIClient(), nextAPI = APIClient()
        let batch = ImportBatchResponse(createdAt: "fixture", duplicates: 0, failed: 0, finished: 0, id: "old-batch", imported: 0, items: [], libraryId: "lib", sourceType: "obsidian", status: "processing", total: 1)
        let batchData = try JSONEncoder().encode(batch)
        delayedAPI.requestHandler = { request in
            _ = await oldLog.capture(request)
            if request.contentType != nil { await ownerGate.wait(); return batchData }
            return quotaData
        }
        nextAPI.requestHandler = { request in
            if await newLog.capture(request) { throw URLError(.timedOut) }
            return quotaData
        }
        store.configure(api: delayedAPI, ownerId: "old-upload-owner")
        let oldUpload = Task { await store.upload(urls: [first], source: .obsidian, targetLibraryId: nil) }
        while !(await ownerGate.entered) { await Task.yield() }
        store.configure(api: nextAPI, ownerId: "new-upload-owner")
        await ownerGate.release(); await oldUpload.value
        precondition(store.batches.isEmpty && store.uploadQueue.isEmpty && store.notice == nil && !store.busy)
        await store.upload(urls: [first], source: .obsidian, targetLibraryId: nil)
        let oldWrites = await oldLog.writes(), nextWrites = await newLog.writes()
        precondition(oldWrites.count == 1 && nextWrites.count == 1 && oldWrites[0].key != nextWrites[0].key)
        print("PASS late old-owner upload cannot restore data or complete the next owner's intent")
    }
}
