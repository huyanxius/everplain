#if os(macOS)
import Foundation
import Security
import XCTest
@testable import EverplainCore

/// Real Foundation/Security integration using synthetic data and one held loopback origin.
/// No URLProtocol mock, shared cookie store, production service, or real account is used.
final class NativeSessionRuntimeTests: XCTestCase {
    func testLoginUsesPrivateHttpOnlyCookieWithoutTurningSessionIDIntoBearer() async throws {
        let fixture = try await NativeSessionFixture.start()
        defer { fixture.stop() }
        let vault = try NativeSessionKeychainProbe(unoccupied: fixture.endpoint)
        defer { vault.removeOwnedItem() }
        let client = APIClient(endpoint: fixture.endpoint)
        let otherClient = APIClient(endpoint: fixture.endpoint)
        defer { client.close(); otherClient.close() }

        let signedIn = try await fixture.login(client)
        XCTAssertEqual(signedIn.sessionId, fixture.sessionID)
        let headers = try await fixture.headers(client)
        XCTAssertEqual(headers.cookies["everplain_session"], fixture.firstCookie)
        XCTAssertEqual(headers.cookies["fixture_auxiliary"], "synthetic-only")
        XCTAssertNil(headers.authorization)
        XCTAssertNotEqual(headers.cookies["everplain_session"], signedIn.sessionId)

        // Clients constructed before persistence must not share an ephemeral cookie jar.
        let otherHeaders = try await fixture.headers(otherClient)
        XCTAssertTrue(otherHeaders.cookies.isEmpty)
        XCTAssertNil(otherHeaders.authorization)
        try await assertUnauthenticated(otherClient)
        XCTAssertNil(try vault.readCookie(), "Login alone must not write the Keychain")

        try client.saveSession()
        let cookie = try XCTUnwrap(vault.readCookie())
        XCTAssertEqual(cookie.name, "everplain_session")
        XCTAssertEqual(cookie.value, fixture.firstCookie)
        XCTAssertEqual(cookie.domain, "127.0.0.1")
        XCTAssertEqual(cookie.path, "/")
        XCTAssertTrue(cookie.isHTTPOnly)
        XCTAssertFalse(cookie.isSecure, "Only this explicitly enabled debug loopback uses HTTP")
        XCTAssertGreaterThan(try XCTUnwrap(cookie.expiresDate), Date())

        // Persisting one client's cookie must not mutate an already-existing client.
        let stillIsolated = try await fixture.headers(otherClient)
        XCTAssertTrue(stillIsolated.cookies.isEmpty)
        let restored = APIClient(endpoint: fixture.endpoint)
        defer { restored.close() }
        let restoredHeaders = try await fixture.headers(restored)
        XCTAssertEqual(restoredHeaders.cookies, ["everplain_session": fixture.firstCookie])
        XCTAssertNil(restoredHeaders.authorization)
        let current: SessionResponse = try await restored.get("/api/session")
        XCTAssertEqual(current.sessionId, signedIn.sessionId)
    }

    func testKeychainSaveUpdateRecreationAndLogoutRemoveTheActualCredential() async throws {
        let fixture = try await NativeSessionFixture.start()
        defer { fixture.stop() }
        let vault = try NativeSessionKeychainProbe(unoccupied: fixture.endpoint)
        defer { vault.removeOwnedItem() }
        let initial = APIClient(endpoint: fixture.endpoint)
        defer { initial.close() }
        _ = try await fixture.login(initial)
        try initial.saveSession() // SecItemAdd, because the exact account was absent.
        XCTAssertEqual(try vault.readCookie()?.value, fixture.firstCookie)
        initial.close()

        let relaunched = APIClient(endpoint: fixture.endpoint)
        defer { relaunched.close() }
        let restored: SessionResponse = try await relaunched.get("/api/session")
        XCTAssertEqual(restored.sessionId, fixture.sessionID)
        _ = try await fixture.login(relaunched)
        try relaunched.saveSession() // SecItemUpdate on this test's same origin.
        XCTAssertEqual(try vault.readCookie()?.value, fixture.secondCookie)

        let afterRotation = APIClient(endpoint: fixture.endpoint)
        defer { afterRotation.close() }
        let rotatedHeaders = try await fixture.headers(afterRotation)
        XCTAssertEqual(rotatedHeaders.cookies, ["everplain_session": fixture.secondCookie])
        XCTAssertNil(rotatedHeaders.authorization)
        let rotatedSession: SessionResponse = try await afterRotation.get("/api/session")
        XCTAssertEqual(rotatedSession.sessionId, fixture.sessionID)
        afterRotation.close()
        let logout: LogoutSessionResponse = try await relaunched.post("/api/session/logout")
        XCTAssertEqual(logout.status, "revoked")
        let expiredHeaders = try await fixture.headers(relaunched)
        XCTAssertNil(expiredHeaders.cookies["everplain_session"], "URLSession must apply the server's expired Set-Cookie")
        XCTAssertEqual(expiredHeaders.cookies["fixture_auxiliary"], "synthetic-only")

        // AppStore's successful logout calls this public production adapter.
        relaunched.clearSession()
        let clearedHeaders = try await fixture.headers(relaunched)
        XCTAssertTrue(clearedHeaders.cookies.isEmpty)
        XCTAssertNil(try vault.readCookie(), "Logout must delete this origin's Keychain item")
        XCTAssertThrowsError(try relaunched.saveSession()) {
            XCTAssertEqual($0 as? ClientError, .authenticationRequired)
        }
        let afterLogout = APIClient(endpoint: fixture.endpoint)
        defer { afterLogout.close() }
        try await assertUnauthenticated(afterLogout)
        let finalHeaders = try await fixture.headers(afterLogout)
        XCTAssertTrue(finalHeaders.cookies.isEmpty)
        XCTAssertNil(finalHeaders.authorization)
    }

    func testSessionResponseWithoutSetCookieCannotBeSavedOrAuthenticate() async throws {
        let fixture = try await NativeSessionFixture.start()
        defer { fixture.stop() }
        let vault = try NativeSessionKeychainProbe(unoccupied: fixture.endpoint)
        defer { vault.removeOwnedItem() }
        let client = APIClient(endpoint: fixture.endpoint)
        defer { client.close() }
        let response = try await fixture.login(client, omitCookie: true)
        XCTAssertEqual(response.sessionId, fixture.sessionID)
        XCTAssertThrowsError(try client.saveSession()) {
            XCTAssertEqual($0 as? ClientError, .authenticationRequired)
        }
        XCTAssertNil(try vault.readCookie())
        let headers = try await fixture.headers(client)
        XCTAssertTrue(headers.cookies.isEmpty)
        XCTAssertNil(headers.authorization)
        try await assertUnauthenticated(client)
    }

    func testPersistedCredentialsAndDeletionStayScopedToTheExactOrigin() async throws {
        let first = try await NativeSessionFixture.start()
        defer { first.stop() }
        let second = try await NativeSessionFixture.start()
        defer { second.stop() }
        XCTAssertNotEqual(first.endpoint, second.endpoint)
        let firstVault = try NativeSessionKeychainProbe(unoccupied: first.endpoint)
        defer { firstVault.removeOwnedItem() }
        let secondVault = try NativeSessionKeychainProbe(unoccupied: second.endpoint)
        defer { secondVault.removeOwnedItem() }
        let firstClient = APIClient(endpoint: first.endpoint)
        defer { firstClient.close() }
        _ = try await first.login(firstClient)
        try firstClient.saveSession()

        // Both origins use the same host; only the port and exact vault account differ.
        let secondClient = APIClient(endpoint: second.endpoint)
        defer { secondClient.close() }
        let isolated = try await second.headers(secondClient)
        XCTAssertTrue(isolated.cookies.isEmpty)
        try await assertUnauthenticated(secondClient)
        _ = try await second.login(secondClient)
        try secondClient.saveSession()
        XCTAssertEqual(try secondVault.readCookie()?.value, second.firstCookie)

        firstClient.clearSession()
        XCTAssertNil(try firstVault.readCookie())
        XCTAssertEqual(try secondVault.readCookie()?.value, second.firstCookie)
        let restoredSecond = APIClient(endpoint: second.endpoint)
        defer { restoredSecond.close() }
        let session: SessionResponse = try await restoredSecond.get("/api/session")
        XCTAssertEqual(session.sessionId, second.sessionID)
    }

    func testRestoreRejectsExpiredForeignDomainAndWrongNameCookies() async throws {
        let fixture = try await NativeSessionFixture.start()
        defer { fixture.stop() }
        let vault = try NativeSessionKeychainProbe(unoccupied: fixture.endpoint)
        defer { vault.removeOwnedItem() }
        let cases: [(name: String, domain: String, expiration: Date)] = [
            ("everplain_session", "127.0.0.1", Date(timeIntervalSinceNow: -3_600)),
            ("everplain_session", "synthetic-unrelated.invalid", Date(timeIntervalSinceNow: 3_600)),
            ("synthetic_wrong_cookie", "127.0.0.1", Date(timeIntervalSinceNow: 3_600))
        ]
        for item in cases {
            let cookie = try XCTUnwrap(HTTPCookie(properties: [
                .name: item.name, .value: fixture.firstCookie, .domain: item.domain,
                .path: "/", .expires: item.expiration, HTTPCookiePropertyKey("HttpOnly"): "TRUE"
            ]))
            try vault.seedSyntheticCookie(cookie)
            let client = APIClient(endpoint: fixture.endpoint)
            defer { client.close() }
            let headers = try await fixture.headers(client)
            XCTAssertTrue(headers.cookies.isEmpty, "An invalid persisted cookie entered the private jar")
            XCTAssertNil(headers.authorization)
            XCTAssertThrowsError(try client.saveSession()) {
                XCTAssertEqual($0 as? ClientError, .authenticationRequired)
            }
            client.clearSession()
            XCTAssertNil(try vault.readCookie())
        }
    }

    private func assertUnauthenticated(_ client: APIClient, file: StaticString = #filePath, line: UInt = #line) async throws {
        do {
            let _: SessionResponse = try await client.get("/api/session")
            XCTFail("A request without the real cookie unexpectedly authenticated", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ClientError, .authenticationRequired, file: file, line: line)
        }
    }
}

private struct NativeSessionHeaders: Decodable {
    let cookies: [String: String]
    let authorization: String?
}

/// Restricts all Security calls to the one absent account at our actively bound port.
/// An existing item or unavailable/locked Keychain fails before APIClient is constructed.
/// We never read, update, or delete an existing runner credential or change Keychain settings.
private struct NativeSessionKeychainProbe {
    private let origin: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.everplain.native.session",
         kSecAttrAccount as String: origin,
         kSecAttrSynchronizable as String: false,
         kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
    }

    init(unoccupied endpoint: Endpoint) throws {
        guard endpoint.origin.scheme == "http", endpoint.origin.host == "127.0.0.1",
              let port = endpoint.origin.port, port > 0 else {
            throw NativeSessionFixture.failure("Refusing a non-fixture Keychain origin")
        }
        origin = endpoint.origin.absoluteString
        // Status only: do not request attributes or data from a possible existing item.
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        guard status == errSecItemNotFound else {
            throw NativeSessionFixture.failure("Fixture origin is not proven unused in Keychain (status \(status)); no credentials were accessed")
        }
    }

    func readCookie() throws -> HTTPCookie? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NativeSessionFixture.failure("Unable to read synthetic Keychain item (status \(status))")
        }
        let values = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        return try XCTUnwrap(HTTPCookie(properties: Dictionary(uniqueKeysWithValues: values.map { (HTTPCookiePropertyKey($0.key), $0.value) })))
    }

    func seedSyntheticCookie(_ cookie: HTTPCookie) throws {
        let properties = try XCTUnwrap(cookie.properties)
        let values = Dictionary(uniqueKeysWithValues: properties.map { ($0.key.rawValue, $0.value) })
        var add = query
        add.removeValue(forKey: kSecUseAuthenticationUI as String)
        add[kSecValueData as String] = try PropertyListSerialization.data(fromPropertyList: values, format: .binary, options: 0)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NativeSessionFixture.failure("Unable to seed synthetic Keychain item (status \(status))")
        }
    }

    func removeOwnedItem() {
        let status = SecItemDelete(query as CFDictionary)
        XCTAssertTrue(status == errSecSuccess || status == errSecItemNotFound,
                      "Synthetic Keychain cleanup failed (status \(status))")
    }
}

/// The Python standard library owns a loopback-only ephemeral port until stop().
/// Its only files are a temporary readiness marker; request bodies are never logged.
private final class NativeSessionFixture {
    let endpoint: Endpoint
    let sessionID: String
    let firstCookie: String
    let secondCookie: String
    private let process: Process
    private let directory: URL

    private init(endpoint: Endpoint, nonce: String, process: Process, directory: URL) {
        self.endpoint = endpoint
        sessionID = "display-only-\(nonce)"
        firstCookie = "cookie-one-\(nonce)"
        secondCookie = "cookie-two-\(nonce)"
        self.process = process
        self.directory = directory
    }

    static func start() async throws -> NativeSessionFixture {
        guard Endpoint.debugLoopbackAllowed else {
            throw XCTSkip("The offline HTTP fixture uses the supported debug-only loopback exception")
        }
        let nonce = UUID().uuidString.lowercased()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("everplain-session-test-\(nonce)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let marker = directory.appendingPathComponent("ready-port")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", "-u", "-c", serverSource, marker.path, nonce]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        // Keep startup errors visible, but the fixture never logs requests or credentials.
        process.standardError = FileHandle.standardError
        do {
            try process.run()
            for _ in 0..<200 {
                if let text = try? String(contentsOf: marker, encoding: .utf8), let port = Int(text), port > 0 {
                    let endpoint = try Endpoint("http://127.0.0.1:\(port)")
                    return NativeSessionFixture(endpoint: endpoint, nonce: nonce, process: process, directory: directory)
                }
                guard process.isRunning else { throw failure("Loopback fixture exited during startup") }
                try await Task.sleep(nanoseconds: 25_000_000)
            }
            throw failure("Loopback fixture did not become ready within five seconds")
        } catch {
            if process.isRunning { process.terminate(); process.waitUntilExit() }
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    func login(_ client: APIClient, omitCookie: Bool = false) async throws -> SessionResponse {
        try await client.mutate("/api/session/login",
                                body: LoginSessionRequest(email: "offline@example.invalid", password: "synthetic-password"),
                                query: omitCookie ? ["mode": "missing-cookie"] : [:])
    }

    func headers(_ client: APIClient) async throws -> NativeSessionHeaders {
        try await client.get("/api/native-test/headers")
    }

    func stop() {
        if process.isRunning { process.terminate(); process.waitUntilExit() }
        try? FileManager.default.removeItem(at: directory)
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "NativeSessionRuntimeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static let serverSource = #"""
import json
import pathlib
import sys
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

marker, nonce = sys.argv[1:]
session_id = "display-only-" + nonce
tokens = ["cookie-one-" + nonce, "cookie-two-" + nonce]

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def cookies(self):
        parsed = SimpleCookie()
        parsed.load(self.headers.get("Cookie", ""))
        return {key: value.value for key, value in parsed.items()}

    def reply(self, code, value, cookies=()):
        data = json.dumps(value).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def active(self):
        return self.server.token is not None and self.cookies().get("everplain_session") == self.server.token

    def session(self):
        return {"allowed_actions": [], "expires_at": "2099-01-01T00:00:00Z",
                "session_id": session_id, "status": "active", "version": 1,
                "user": {"display_name": "Offline fixture", "email": "offline@example.invalid",
                         "user_id": "synthetic-owner-" + nonce}}

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/native-test/headers":
            self.reply(200, {"cookies": self.cookies(), "authorization": self.headers.get("Authorization")})
        elif path == "/api/session" and self.active() and self.headers.get("Authorization") is None:
            self.reply(200, self.session())
        else:
            self.reply(401, {"error": {"code": "unauthenticated", "message": "Synthetic authentication required"}})

    def do_POST(self):
        target = urlsplit(self.path)
        if self.headers.get("Authorization") is not None:
            self.reply(400, {"error": {"code": "unexpected_bearer", "message": "Session IDs are display-only"}})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 4096:
            self.reply(400, {})
            return
        body = self.rfile.read(length)
        if target.path == "/api/session/login":
            if json.loads(body) != {"email": "offline@example.invalid", "password": "synthetic-password"}:
                self.reply(400, {})
                return
            if parse_qs(target.query).get("mode") == ["missing-cookie"]:
                self.reply(200, self.session())
                return
            self.server.token = tokens[min(self.server.logins, 1)]
            self.server.logins += 1
            self.reply(200, self.session(), [
                "everplain_session=" + self.server.token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
                "fixture_auxiliary=synthetic-only; Path=/; Max-Age=3600"])
        elif target.path == "/api/session/logout" and self.active():
            self.server.token = None
            self.reply(200, {"allowed_actions": [], "session_id": session_id, "status": "revoked", "version": 2},
                       ["everplain_session=; Path=/; HttpOnly; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"])
        else:
            self.reply(401, {"error": {"code": "unauthenticated", "message": "Synthetic authentication required"}})

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
server.token = None
server.logins = 0
pathlib.Path(marker).write_text(str(server.server_port), encoding="utf-8")
try:
    server.serve_forever()
finally:
    server.server_close()
"""#
}
#endif
