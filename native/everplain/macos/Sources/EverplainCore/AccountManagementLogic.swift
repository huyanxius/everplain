import Foundation

/// Source account guards shared by native controls and offline acceptance tests.
public enum AccountManagementLogic {
    public static let creditPageSize = 10
    public static func validEmail(_ raw: String) -> Bool {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.utf16.count <= 320 && value.range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil
    }
    public static func canDeactivate(_ account: AccountResponse, ownerId: String?, password: String, reason: String) -> Bool {
        account.userId == ownerId && !account.isProtectedAdmin && !password.isEmpty &&
        !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && reason.utf16.count <= 240
    }
    public static func canDelete(_ account: AccountResponse, ownerId: String?, password: String, email: String) -> Bool {
        account.userId == ownerId && !account.isProtectedAdmin && !password.isEmpty &&
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == account.email.lowercased()
    }
    public static func exportPath(_ value: DataExportResponse, origin: URL, now: Date = Date()) -> String? {
        guard value.status == "ready", !value.exportId.isEmpty,
              value.exportId.rangeOfCharacter(from: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_" )).inverted) == nil,
              let href = URL(string: value.downloadHref, relativeTo: origin)?.absoluteURL,
              href.scheme == origin.scheme, href.host == origin.host, href.port == origin.port,
              href.user == nil, href.password == nil, href.query == nil, href.fragment == nil,
              href.path == "/api/account/data-exports/\(value.exportId)/download" else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let expiry = formatter.date(from: value.expiresAt) ?? ISO8601DateFormatter().date(from: value.expiresAt), expiry > now else { return nil }
        return href.path
    }
    /// A code is never copied after expiry, even if a view timer has not fired yet.
    public static func bindingCommand(_ grant: ChannelLinkCodeResponse?, now: Date = Date()) -> String? {
        guard let grant, Double(grant.expiresAt) > now.timeIntervalSince1970 else { return nil }
        return "/bind \(grant.code)"
    }
    public static func safeBotURL(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

/// Retain the key for an unchanged uncertain request; change it for a new intent.
/// Only process-local hashes are retained, so credentials are not cached here.
public struct AccountMutationLedger {
    private struct Intent { let fingerprint: Int; let key: String }
    private var intents: [String: Intent] = [:]
    public init() {}
    public mutating func key<Body: Encodable>(for action: String, body: Body) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let fingerprint = try encoder.encode(body).hashValue
        if let value = intents[action], value.fingerprint == fingerprint { return value.key }
        let key = UUID().uuidString
        intents[action] = Intent(fingerprint: fingerprint, key: key)
        return key
    }
    public mutating func complete(_ action: String) { intents.removeValue(forKey: action) }
    public mutating func reset() { intents.removeAll() }
}
