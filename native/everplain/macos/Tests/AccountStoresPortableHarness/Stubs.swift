import Foundation
import EverplainCore
protocol ObservableObject {}
@propertyWrapper struct Published<T> { var wrappedValue: T; init(wrappedValue: T) { self.wrappedValue = wrappedValue } }
struct OfflineRequest: Sendable { let path: String; let method: String; let body: Data?; let key: String?; let query: [String:String] }
final class APIClient: @unchecked Sendable {
    var handler: @Sendable (OfflineRequest) async throws -> Data = { _ in throw ClientError.invalidResponse }
    let endpoint = try! Endpoint("https://service.example.invalid")
    func get<T: Decodable>(_ path: String, key: String? = nil, query: [String:String] = [:], as: T.Type = T.self) async throws -> T { try JSONDecoder().decode(T.self, from: await handler(.init(path:path,method:"GET",body:nil,key:key,query:query))) }
    func mutate<B: Encodable,T: Decodable>(_ path: String, method: String = "POST", body: B, key: String = UUID().uuidString, query: [String:String] = [:], as: T.Type = T.self) async throws -> T { try JSONDecoder().decode(T.self, from: await handler(.init(path:path,method:method,body:try JSONEncoder().encode(body),key:key,query:query))) }
    func delete(_ path: String, query: [String:String] = [:], key: String = UUID().uuidString) async throws { _ = try await handler(.init(path:path,method:"DELETE",body:nil,key:key,query:query)) }
    func download(_ path: String) async throws -> DownloadedContent { throw ClientError.invalidResponse }
}
