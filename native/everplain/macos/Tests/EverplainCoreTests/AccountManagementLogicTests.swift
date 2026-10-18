import XCTest
@testable import EverplainCore

final class AccountManagementLogicTests: XCTestCase {
    private func account(protected: Bool = false) -> AccountResponse {
        AccountResponse(createdAt: "2026-01-01T00:00:00Z", email: "owner@example.invalid", isProtectedAdmin: protected, preferences: .init(consentPolicyVersion: "2026-01", locale: "zh-CN", modelImprovementAllowed: false, researchUpdatesEnabled: true, timezone: "UTC", version: 4), role: protected ? "admin" : "member", status: "active", updatedAt: "2026-01-01T00:00:00Z", userId: "owner", version: 2)
    }
    func testProtectedAdminCannotCloseEvenWithValidConfirmation() {
        XCTAssertFalse(AccountManagementLogic.canDeactivate(account(protected: true), ownerId: "owner", password: "synthetic", reason: "test"))
        XCTAssertFalse(AccountManagementLogic.canDelete(account(protected: true), ownerId: "owner", password: "synthetic", email: "owner@example.invalid"))
    }
    func testClosureRequiresCurrentOwnerAndExplicitFields() {
        let value = account()
        XCTAssertFalse(AccountManagementLogic.canDeactivate(value, ownerId: "different", password: "synthetic", reason: "test"))
        XCTAssertFalse(AccountManagementLogic.canDeactivate(value, ownerId: "owner", password: "synthetic", reason: " \n"))
        XCTAssertTrue(AccountManagementLogic.canDeactivate(value, ownerId: "owner", password: "synthetic", reason: "停用"))
        XCTAssertFalse(AccountManagementLogic.canDelete(value, ownerId: "owner", password: "synthetic", email: "someone@example.invalid"))
        XCTAssertFalse(AccountManagementLogic.canDelete(value, ownerId: "owner", password: "", email: value.email))
        XCTAssertTrue(AccountManagementLogic.canDelete(value, ownerId: "owner", password: "synthetic", email: " OWNER@EXAMPLE.INVALID "))
    }
    func testExportOnlyUsesCurrentOriginExactContractAndUnexpiredReadyCopy() {
        let origin = URL(string: "https://service.example.invalid")!
        var value = DataExportResponse(createdAt: "2026-01-01T00:00:00Z", downloadHref: "/api/account/data-exports/export-1/download", expiresAt: "2026-01-02T00:00:00Z", exportId: "export-1", format: "json", status: "ready")
        let now = ISO8601DateFormatter().date(from: "2026-01-01T12:00:00Z")!
        XCTAssertEqual(AccountManagementLogic.exportPath(value, origin: origin, now: now), value.downloadHref)
        for href in ["https://evil.example.invalid/api/account/data-exports/export-1/download", "//evil.example.invalid/api/account/data-exports/export-1/download", "/api/account/data-exports/other/download", "/api/account/data-exports/export-1/download?token=untrusted", "/api/account/profile", "https://secret@service.example.invalid/api/account/data-exports/export-1/download"] {
            value.downloadHref = href; XCTAssertNil(AccountManagementLogic.exportPath(value, origin: origin, now: now))
        }
        value.downloadHref = "/api/account/data-exports/export-1/download"
        value.status = "pending"; XCTAssertNil(AccountManagementLogic.exportPath(value, origin: origin, now: now))
        value.status = "ready"; value.expiresAt = "2025-12-31T00:00:00Z"; XCTAssertNil(AccountManagementLogic.exportPath(value, origin: origin, now: now))
    }
    func testExpiredBindingCommandCannotBeCopiedBeforeTimerRuns() {
        let grant = ChannelLinkCodeResponse(code: "SYNTHETIC", expiresAt: 100, gatewayId: "test")
        XCTAssertEqual(AccountManagementLogic.bindingCommand(grant, now: Date(timeIntervalSince1970: 99)), "/bind SYNTHETIC")
        XCTAssertNil(AccountManagementLogic.bindingCommand(grant, now: Date(timeIntervalSince1970: 100)))
        XCTAssertNil(AccountManagementLogic.safeBotURL("javascript:alert(1)"))
        XCTAssertNil(AccountManagementLogic.safeBotURL("http://example.invalid"))
        XCTAssertNotNil(AccountManagementLogic.safeBotURL("https://t.me/example"))
    }
    func testUncertainMutationRetainsKeyOnlyForSameIntent() throws {
        var ledger = AccountMutationLedger()
        let first = try ledger.key(for: "profile", body: UpdateProfileRequest(displayName: "One", expectedVersion: 4))
        XCTAssertEqual(first, try ledger.key(for: "profile", body: UpdateProfileRequest(displayName: "One", expectedVersion: 4)))
        let changed = try ledger.key(for: "profile", body: UpdateProfileRequest(displayName: "Two", expectedVersion: 4))
        XCTAssertNotEqual(first, changed)
        ledger.complete("profile")
        XCTAssertNotEqual(changed, try ledger.key(for: "profile", body: UpdateProfileRequest(displayName: "Two", expectedVersion: 4)))
        ledger.reset()
        XCTAssertNotEqual(first, try ledger.key(for: "profile", body: UpdateProfileRequest(displayName: "One", expectedVersion: 4)))
    }
    func testLoginEmailUsesWebUTF16Budget() {
        XCTAssertTrue(AccountManagementLogic.validEmail(" example@example.invalid "))
        XCTAssertFalse(AccountManagementLogic.validEmail("bad value@example.invalid"))
        XCTAssertFalse(AccountManagementLogic.validEmail("a@b"))
        XCTAssertFalse(AccountManagementLogic.validEmail(String(repeating: "😀", count: 155) + "@example.invalid"))
    }
}
