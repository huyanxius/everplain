#if os(macOS)
import Foundation
import Security

/// Private in-memory cookie jar; only the HttpOnly session cookie is persisted in Keychain.
/// No password, completed-chat cache, account record, bearer token or model secret is saved.
/// Unresolved stop intent is separately encrypted in owner-scoped Keychain storage.
public final class APIClient: @unchecked Sendable {
    public let endpoint: Endpoint
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage
    private let vault: SessionVault
    private let redirectPolicy = RejectRedirects()

    public init(endpoint: Endpoint) {
        self.endpoint = endpoint
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 600
        // Ephemeral configurations own a private, nonpersistent cookie store.
        cookieStorage = configuration.httpCookieStorage!
        vault = SessionVault(origin: endpoint.origin.absoluteString)
        session = URLSession(configuration: configuration, delegate: redirectPolicy, delegateQueue: nil)
        if let cookie = vault.load(), cookie.expiresDate.map({ $0 > Date() }) ?? true {
            let host = endpoint.origin.host ?? ""
            if cookie.name == "everplain_session" && cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == host {
                cookieStorage.setCookie(cookie)
            }
        }
    }

    public func get<T: Decodable>(_ path: String, key: String? = nil, query: [String: String] = [:], as: T.Type = T.self) async throws -> T {
        try await perform(endpoint.request(path, idempotencyKey: key, query: query))
    }
    public func mutate<B: Encodable, T: Decodable>(_ path: String, method: String = "POST", body: B, key: String = UUID().uuidString, query: [String: String] = [:], as: T.Type = T.self) async throws -> T {
        try await perform(endpoint.request(path, method: method, body: JSONEncoder().encode(body), idempotencyKey: key, query: query))
    }
    public func post<T: Decodable>(_ path: String, key: String = UUID().uuidString, as: T.Type = T.self) async throws -> T {
        try await perform(endpoint.request(path, method: "POST", idempotencyKey: key))
    }
    public func delete(_ path: String, query: [String: String] = [:], key: String = UUID().uuidString) async throws {
        let (data, response) = try await session.data(for: endpoint.request(path, method: "DELETE", idempotencyKey: key, query: query))
        try Self.validate(response, data: data)
    }
    public func upload<T: Decodable>(_ path: String, form: MultipartBody, key: String, as: T.Type = T.self) async throws -> T {
        var request = try endpoint.request(path, method: "POST", body: form.data, idempotencyKey: key)
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }
    public func download(_ path: String, method: String = "GET", body: Data? = nil, query: [String: String] = [:], key: String? = nil, maximumBytes: Int? = nil) async throws -> DownloadedContent {
        var request = try endpoint.request(path, method: method, body: body, idempotencyKey: key, query: query)
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        if let maximumBytes {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
            if !(200..<300).contains(http.statusCode) {
                if http.statusCode == 401 { throw ClientError.authenticationRequired }
                var failure = Data()
                for try await byte in bytes { failure.append(byte); if failure.count >= 65_536 { break } }
                try Self.validate(response, data: failure)
            }
            var buffer = try BoundedDownloadBuffer(maximumBytes: maximumBytes, expectedLength: response.expectedContentLength)
            for try await byte in bytes {
                if buffer.data.count % 4096 == 0 { try Task.checkCancellation() }
                try buffer.append(byte)
            }
            return DownloadedContent(data: buffer.data, mimeType: response.mimeType ?? "application/octet-stream", suggestedFilename: response.suggestedFilename)
        }
        let (data, response) = try await session.data(for: request)
        try Self.validate(response, data: data)
        return DownloadedContent(data: data, mimeType: response.mimeType ?? "application/octet-stream", suggestedFilename: response.suggestedFilename)
    }
    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        try Self.validate(response, data: data)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw ClientError.invalidResponse }
    }
    public func saveSession() throws {
        guard let cookie = cookieStorage.cookies(for: endpoint.origin)?.first(where: { $0.name == "everplain_session" }) else {
            throw ClientError.authenticationRequired
        }
        try vault.save(cookie)
    }
    public func clearSession() {
        cookieStorage.cookies?.forEach(cookieStorage.deleteCookie)
        vault.clear()
    }
    public func close() { session.invalidateAndCancel() }
    public func saveStopRecovery(_ records: [StopRecoveryRecord], ownerId: String) throws {
        let storage = StopRecoveryVault(origin: endpoint.origin.absoluteString, ownerId: ownerId)
        if records.isEmpty { storage.clear() } else { try storage.save(JSONEncoder().encode(records)) }
    }
    public func loadStopRecovery(ownerId: String) throws -> [StopRecoveryRecord] {
        guard let data = try StopRecoveryVault(origin: endpoint.origin.absoluteString, ownerId: ownerId).load() else { return [] }
        return try JSONDecoder().decode([StopRecoveryRecord].self, from: data)
    }

    public func stream(_ pending: PendingTurn) -> AsyncThrowingStream<AgentEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let request = try endpoint.request("/api/agent/turns", method: "POST", body: JSONEncoder().encode(pending.request), idempotencyKey: pending.key, stream: true)
                    let (bytes, response) = try await session.bytes(for: request)
                    defer { bytes.task.cancel() }
                    guard let http = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
                    if !(200..<300).contains(http.statusCode) {
                        var data = Data()
                        for try await byte in bytes {
                            data.append(byte)
                            if data.count > 65_536 { break }
                        }
                        try Self.validate(http, data: data)
                    }
                    guard http.value(forHTTPHeaderField: "Content-Type")?.lowercased().contains("text/event-stream") == true else { throw ClientError.invalidResponse }
                    var parser = SSEParser()
                    var chunk = Data()
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        chunk.append(byte)
                        // Flush on line boundaries for prompt token display, or bounded chunks.
                        if byte == 10 || byte == 13 || chunk.count >= 1024 {
                            for frame in try parser.append(chunk) {
                                let event = try AgentEvent(frame)
                                continuation.yield(event)
                                switch event {
                                case .completed, .failed, .interrupted, .researchWaiting:
                                    continuation.finish()
                                    return
                                default: break
                                }
                            }
                            chunk.removeAll(keepingCapacity: true)
                        }
                    }
                    // A successful HTTP EOF is not a successful model completion.
                    throw ClientError.streamEnded
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
    private static func validate(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
        if (200..<300).contains(response.statusCode) { return }
        if response.statusCode == 401 { throw ClientError.authenticationRequired }
        if let envelope = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
            if ["session_expired", "unauthenticated", "account_inactive"].contains(envelope.error.code) { throw ClientError.authenticationRequired }
            throw ClientError.server(status: response.statusCode, code: envelope.error.code, message: envelope.error.message)
        }
        if let validation = try? JSONDecoder().decode(HTTPValidationError.self, from: data), let details = validation.detail, !details.isEmpty {
            // Never include validator input values: those can contain a password.
            throw ClientError.server(status: response.statusCode, code: "validation_error", message: details.map(\.msg).joined(separator: "；"))
        }
        throw ClientError.server(status: response.statusCode, code: "http_error", message: "请求失败（HTTP \(response.statusCode)）。请稍后重试。")
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward passwords/cookies to redirected hosts or silently downgrade HTTPS.
        completionHandler(nil)
    }
}

private struct SessionVault {
    let origin: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.everplain.native.session",
         kSecAttrAccount as String: origin,
         kSecAttrSynchronizable as String: false]
    }
    func save(_ cookie: HTTPCookie) throws {
        guard let properties = cookie.properties else { throw ClientError.invalidResponse }
        let values = Dictionary(uniqueKeysWithValues: properties.map { ($0.key.rawValue, $0.value) })
        let data = try PropertyListSerialization.data(fromPropertyList: values, format: .binary, options: 0)
        let update = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if result == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(add as CFDictionary, nil)
            guard status == errSecSuccess else { throw vaultError(status) }
        } else if result != errSecSuccess { throw vaultError(result) }
    }
    func load() -> HTTPCookie? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let values = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return nil }
        return HTTPCookie(properties: Dictionary(uniqueKeysWithValues: values.map { (HTTPCookiePropertyKey($0.key), $0.value) }))
    }
    func clear() { SecItemDelete(query as CFDictionary) }
    private func vaultError(_ status: OSStatus) -> ClientError {
        .server(status: Int(status), code: "keychain_unavailable", message: "已登录，但钥匙串暂时无法保存会话；退出应用后需要重新登录。")
    }
}

private struct StopRecoveryVault {
    let origin: String
    let ownerId: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.everplain.native.pending-stop",
         kSecAttrAccount as String: origin + "#" + ownerId,
         kSecAttrSynchronizable as String: false]
    }
    func save(_ data: Data) throws {
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw failure }
        } else if status != errSecSuccess { throw failure }
    }
    func load() throws -> Data? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw failure }
        return data
    }
    func clear() { SecItemDelete(query as CFDictionary) }
    private var failure: ClientError { .server(status: 0, code: "stop_recovery_storage", message: "待核对记录暂时无法写入钥匙串；关闭应用后可能无法自动找回，请保留本次会话。") }
}
#endif
