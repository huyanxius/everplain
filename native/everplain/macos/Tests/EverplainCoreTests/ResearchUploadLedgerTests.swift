import XCTest
@testable import EverplainCore

final class ResearchUploadLedgerTests: XCTestCase {
    private func file(_ text: String, name: String = "材料.txt", mimeType: String = "text/plain",
                      kind: String = "other", deferred: Bool = true) -> ResearchUploadFileIdentity {
        let data = Data(text.utf8)
        return ResearchUploadFileIdentity(filename: name, mimeType: mimeType, byteCount: UInt64(data.count),
                                          sha256: ResearchUploadDigest.hash(data), materialKind: kind, deferProcessing: deferred)
    }
    private func ledger() -> ResearchUploadLedger<String> {
        var ledger = ResearchUploadLedger<String>(); ledger.configure(owner: "https://example.test|owner-a"); return ledger
    }

    func testUncertainProjectAndFileResponsesReplayTheirOriginalKeys() throws {
        var journal = ledger()
        let files = [file("first"), file("second", name: "二.txt")]
        let initial = try journal.begin(scope: "library", taskId: nil, files: files)
        // The server creates the project, but the client loses its response.
        let serverProjectByKey = [initial.projectKey: "project-created-once"]
        XCTAssertNil(initial.destinationTaskId)
        let retry = try journal.begin(scope: "library", taskId: nil, files: files)
        XCTAssertEqual(retry.id, initial.id)
        let project = try XCTUnwrap(serverProjectByKey[retry.projectKey])
        XCTAssertTrue(journal.setDestination(project, for: retry))
        // The first material succeeds; the second is created but its acknowledgement is lost.
        XCTAssertTrue(journal.succeed("material-first", at: 0, in: retry))
        let serverSecondByKey = [retry.files[1].key: "material-second-created-once"]
        let secondRetry = try journal.begin(scope: "library", taskId: nil, files: files)
        XCTAssertEqual(secondRetry.destinationTaskId, project)
        XCTAssertEqual(secondRetry.pendingIndices, [1])
        XCTAssertEqual(secondRetry.files[1].boundary, initial.files[1].boundary)
        let second = try XCTUnwrap(serverSecondByKey[secondRetry.files[1].key])
        XCTAssertTrue(journal.succeed(second, at: 1, in: secondRetry))
        XCTAssertEqual(journal.finish(secondRetry), ["material-first", "material-second-created-once"])
        XCTAssertNil(journal.snapshot(initial))
        // After explicit success, another identical import is a new intent.
        XCTAssertNotEqual(try journal.begin(scope: "library", taskId: nil, files: files).projectKey, initial.projectKey)
    }

    func testPartialBatchRetainsDestinationAndSkipsSuccessAfterSelectionChanges() throws {
        var journal = ledger()
        let files = [file("a"), file("b", name: "b.txt")]
        let original = try journal.begin(scope: "library", taskId: nil, files: files)
        XCTAssertTrue(journal.setDestination("resolved-project", for: original))
        XCTAssertTrue(journal.succeed("saved-id", at: 0, in: original))
        XCTAssertNil(journal.finish(original))
        // UI now passes the confirmed destination instead of nil.
        let resumed = try journal.begin(scope: "library", taskId: "resolved-project", files: files, allowResolvedDestination: true)
        XCTAssertEqual(resumed.id, original.id)
        XCTAssertEqual(resumed.pendingIndices, [1])
        XCTAssertEqual(resumed.files[0].value, "saved-id")
        // Destination identity is exact for composer contexts.
        let otherDestination = try journal.begin(scope: "library", taskId: "different-project", files: files, allowResolvedDestination: true)
        XCTAssertNotEqual(otherDestination.id, original.id)
        XCTAssertFalse(journal.setDestination("different-project", for: original))
    }

    func testChangedRealBytesOrBodyFieldsNeverReuseWireKey() throws {
        var journal = ledger()
        let body = file("abc")
        let initial = try journal.begin(scope: "composer-context", taskId: "task", files: [body])
        // Same path, filename and length; different actual bytes.
        for changed in [file("abd"), file("abc", name: "renamed.txt"), file("abc", mimeType: "text/markdown"),
                        file("abc", kind: "document"), file("abc", deferred: false)] {
            let next = try journal.begin(scope: "composer-context", taskId: "task", files: [changed])
            XCTAssertNotEqual(next.files[0].key, initial.files[0].key)
            XCTAssertNotEqual(next.files[0].boundary, initial.files[0].boundary)
        }
        XCTAssertEqual(try journal.begin(scope: "composer-context", taskId: "task", files: [body]).files[0].key, initial.files[0].key)
        XCTAssertNotEqual(try journal.begin(scope: "other-context", taskId: "task", files: [body]).files[0].key, initial.files[0].key)
    }

    func testOrderedBatchPreservesDuplicateEntriesWithoutSharingFileKeys() throws {
        var journal = ledger()
        let a = file("a"), b = file("b")
        let original = try journal.begin(scope: "same", taskId: "task", files: [a, b, a])
        XCTAssertEqual(Set(original.files.map(\.key)).count, 3)
        let reordered = try journal.begin(scope: "same", taskId: "task", files: [b, a, a])
        XCTAssertNotEqual(original.id, reordered.id)
        XCTAssertTrue(journal.succeed("duplicate-1", at: 0, in: original))
        XCTAssertEqual(journal.snapshot(original)?.pendingIndices, [1, 2])
    }

    func testFinishingAnotherBatchDoesNotEraseAnUncertainIntent() throws {
        var journal = ledger()
        let original = try journal.begin(scope: "context", taskId: "task", files: [file("first")])
        let other = try journal.begin(scope: "context", taskId: "task", files: [file("changed")])
        XCTAssertTrue(journal.succeed("other-material", at: 0, in: other))
        XCTAssertEqual(journal.finish(other), ["other-material"])
        XCTAssertEqual(journal.snapshot(original)?.files[0].key, original.files[0].key)
    }

    func testOwnerResetInvalidatesKeysAndLateAcknowledgements() throws {
        var journal = ledger()
        let files = [file("private")]
        let original = try journal.begin(scope: "context", taskId: "task", files: files)
        let originalDelete = try journal.operationKey(for: "DELETE:material")
        journal.configure(owner: "https://example.test|owner-a")
        XCTAssertEqual(try journal.begin(scope: "context", taskId: "task", files: files).id, original.id)
        journal.configure(owner: "https://example.test|owner-b")
        let replacement = try journal.begin(scope: "context", taskId: "task", files: files)
        XCTAssertNotEqual(replacement.files[0].key, original.files[0].key)
        XCTAssertNotEqual(try journal.operationKey(for: "DELETE:material"), originalDelete)
        XCTAssertFalse(journal.succeed("late-old-owner-response", at: 0, in: original))
        XCTAssertFalse(journal.setDestination("old-owner-project", for: original))
        XCTAssertNil(journal.finish(original))
        XCTAssertEqual(journal.snapshot(replacement)?.pendingIndices, [0])
        journal.configure(owner: nil)
        XCTAssertThrowsError(try journal.begin(scope: "context", taskId: "task", files: files))
        journal.configure(owner: "https://example.test|owner-a")
        XCTAssertNotEqual(try journal.begin(scope: "context", taskId: "task", files: files).projectKey, original.projectKey)
    }

    func testDeleteAndReparseKeysSurviveUncertainResultsUntilConfirmed() throws {
        var journal = ledger()
        let delete = try journal.operationKey(for: "DELETE:/material")
        let reparse = try journal.operationKey(for: "POST:/material/reparse")
        XCTAssertNotEqual(delete, reparse)
        XCTAssertEqual(try journal.operationKey(for: "DELETE:/material"), delete)
        XCTAssertEqual(try journal.operationKey(for: "POST:/material/reparse"), reparse)
        journal.finishOperation("POST:/material/reparse")
        XCTAssertNotEqual(try journal.operationKey(for: "POST:/material/reparse"), reparse)
        XCTAssertEqual(try journal.operationKey(for: "DELETE:/material"), delete)
    }

    func testDigestMatchesSHA256VectorsAcrossReadChunkBoundaries() {
        XCTAssertEqual(ResearchUploadDigest.hash(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(ResearchUploadDigest.hash(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        let input = Data("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)
        let expected = "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        XCTAssertEqual(ResearchUploadDigest.hash(input), expected)
        for width in [1, 3, 7, 31, 55, 63, 64, 65] {
            var digest = ResearchUploadDigest()
            for offset in stride(from: 0, to: input.count, by: width) { digest.update(input.subdata(in: offset..<min(input.count, offset + width))) }
            XCTAssertEqual(digest.finalized(), expected)
            XCTAssertEqual(digest.byteCount, UInt64(input.count))
        }
        let repeated = Data(repeating: 97, count: 1_000_000)
        XCTAssertEqual(ResearchUploadDigest.hash(repeated), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
    }
}
