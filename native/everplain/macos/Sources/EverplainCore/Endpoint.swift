import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct Endpoint: Equatable, Sendable {
    public let origin: URL
    public init(_ value: String, allowLoopback: Bool = Endpoint.debugLoopbackAllowed) throws {
        guard let parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              let scheme = parts.scheme?.lowercased(),
              scheme == "https" || (allowLoopback && scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host.lowercased())),
              let url = parts.url else { throw ClientError.invalidEndpoint }
        var normalized = parts
        normalized.scheme = scheme
        normalized.host = host.lowercased()
        normalized.path = ""
        guard let canonical = normalized.url else { throw ClientError.invalidEndpoint }
        _ = url
        origin = canonical
    }
    public static var debugLoopbackAllowed: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
    public func url(_ path: String, query: [String: String] = [:]) throws -> URL {
        for prefix in ["/api/agent/conversations/", "/api/agent/runs/", "/api/account/sessions/"] where path.hasPrefix(prefix) && path != EverplainEndpoint.lookupAgentRun {
            let id = String(path.dropFirst(prefix.count).split(separator: "/").first ?? "")
            guard UUID(uuidString: id) != nil else { throw ClientError.invalidEndpoint }
        }
        guard path.hasPrefix("/api/"), !path.contains(".."), !path.contains("?"), !path.contains("#"),
              let result = URL(string: path, relativeTo: origin)?.absoluteURL,
              result.host == origin.host, result.scheme == origin.scheme, result.port == origin.port
        else { throw ClientError.invalidEndpoint }
        guard var components = URLComponents(url: result, resolvingAgainstBaseURL: false) else { throw ClientError.invalidEndpoint }
        if !query.isEmpty { components.queryItems = query.keys.sorted().map { URLQueryItem(name: $0, value: query[$0]) } }
        guard let url = components.url else { throw ClientError.invalidEndpoint }
        return url
    }
    public func request(_ path: String, method: String = "GET", body: Data? = nil, idempotencyKey: String? = nil, stream: Bool = false, query: [String: String] = [:]) throws -> URLRequest {
        if let key = idempotencyKey {
            guard (8...128).contains(key.count), key.rangeOfCharacter(from: .controlCharacters) == nil else { throw ClientError.invalidResponse }
        }
        var request = URLRequest(url: try url(path, query: query))
        request.httpMethod = method
        request.httpBody = body
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = stream ? 180 : 45
        request.setValue(stream ? "text/event-stream" : "application/json", forHTTPHeaderField: "Accept")
        request.setValue("Everplain-macOS/0.1", forHTTPHeaderField: "User-Agent")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if method != "GET" || idempotencyKey != nil {
            request.setValue(idempotencyKey ?? UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        }
        return request
    }
}

public enum ClientError: Error, LocalizedError, Equatable, Sendable {
    case invalidEndpoint, invalidResponse, authenticationRequired, eventTooLarge, malformedEvent, streamEnded
    case server(status: Int, code: String, message: String)
    public var errorDescription: String? {
        switch self {
        case .invalidEndpoint: return "请填写 HTTPS 服务地址。仅本机开发地址允许 HTTP。"
        case .invalidResponse: return "服务返回了无法识别的响应。"
        case .authenticationRequired: return "登录已过期，请重新登录。"
        case .eventTooLarge: return "响应数据超过安全限制。请重新打开对话。"
        case .malformedEvent: return "流式响应格式有误，已保留当前内容。"
        case .streamEnded: return "连接提前断开。已保留当前内容，可安全重试。"
        case .server(_, _, let message): return message
        }
    }
    public var isConflict: Bool { if case .server(409, _, _) = self { return true }; return false }
}
