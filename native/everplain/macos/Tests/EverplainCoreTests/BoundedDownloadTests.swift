import XCTest
@testable import EverplainCore

final class BoundedDownloadTests: XCTestCase {
    func testUnknownLengthAndUnderreportedLengthCannotExceedMemoryLimit() throws {
        for length in [Int64(-1), 1] {
            var reader = try BoundedDownloadBuffer(maximumBytes: 4, expectedLength: length)
            for byte: UInt8 in [0, 13, 10, 255] { try reader.append(byte) }
            XCTAssertEqual(reader.data, Data([0, 13, 10, 255]))
            XCTAssertThrowsError(try reader.append(42))
            XCTAssertEqual(reader.data.count, 4)
        }
    }
    func testOversizedDeclaredLengthRejectsBeforeAllocation() {
        XCTAssertThrowsError(try BoundedDownloadBuffer(maximumBytes: 1024, expectedLength: Int64.max))
        XCTAssertThrowsError(try BoundedDownloadBuffer(maximumBytes: 0))
    }
}
