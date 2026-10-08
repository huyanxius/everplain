import Foundation
import EverplainCore
protocol ObservableObject {}
@propertyWrapper struct Published<T> { var wrappedValue: T; init(wrappedValue: T) { self.wrappedValue = wrappedValue } }
struct UTType { init?(filenameExtension: String) {}; var preferredMIMEType: String? { nil } }
extension URL { func startAccessingSecurityScopedResource() -> Bool { false }; func stopAccessingSecurityScopedResource() {} }
// Offline transport facade; no network requests are made by this harness.
final class APIClient: @unchecked Sendable {
    struct Request: Sendable {
        let path: String
        let method: String
        let body: Data?
        let key: String?
        var contentType: String? = nil
    }
    var mutationObserver: @Sendable () async -> Void = {}
    var handler: @Sendable (String) async throws -> Data = { _ in throw ClientError.invalidResponse }
    var requestHandler: (@Sendable (Request) async throws -> Data)?
    let endpoint = try! Endpoint("https://example.com")
    private func response(_ request: Request) async throws -> Data {
        if let requestHandler { return try await requestHandler(request) }
        return try await handler(request.path)
    }
    func get<T: Decodable>(_ path: String, key: String? = nil, query: [String:String] = [:], as: T.Type = T.self) async throws -> T { try JSONDecoder().decode(T.self, from: await response(.init(path: path, method: "GET", body: nil, key: key))) }
    func mutate<B: Encodable,T: Decodable>(_ path: String, method: String = "POST", body: B, key: String = UUID().uuidString, as: T.Type = T.self) async throws -> T {
        await mutationObserver()
        return try JSONDecoder().decode(T.self, from: await response(.init(path: path, method: method, body: try JSONEncoder().encode(body), key: key)))
    }
    func post<T: Decodable>(_ path: String, key: String = UUID().uuidString, as: T.Type = T.self) async throws -> T { try JSONDecoder().decode(T.self, from: await response(.init(path: path, method: "POST", body: nil, key: key))) }
    func delete(_ path: String, key: String = UUID().uuidString) async throws { if let requestHandler { _ = try await requestHandler(.init(path: path, method: "DELETE", body: nil, key: key)) } }
    func upload<T: Decodable>(_ path: String, form: MultipartBody, key: String, as: T.Type = T.self) async throws -> T { try JSONDecoder().decode(T.self, from: await response(.init(path: path, method: "POST", body: form.data, key: key, contentType: form.contentType))) }
    func download(_ path: String) async throws -> DownloadedContent { throw ClientError.invalidResponse }
}
