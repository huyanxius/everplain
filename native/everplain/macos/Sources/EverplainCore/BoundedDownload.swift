import Foundation

/// Enforces the same bound with or without a trustworthy Content-Length header.
public struct BoundedDownloadBuffer: Sendable {
    public private(set) var data = Data()
    private let maximumBytes: Int
    public init(maximumBytes: Int, expectedLength: Int64 = -1) throws {
        guard maximumBytes > 0, expectedLength < 0 || expectedLength <= Int64(maximumBytes) else { throw Self.tooLarge }
        self.maximumBytes = maximumBytes
        if expectedLength > 0 { data.reserveCapacity(Int(expectedLength)) }
    }
    public mutating func append(_ byte: UInt8) throws {
        guard data.count < maximumBytes else { throw Self.tooLarge }
        data.append(byte)
    }
    private static var tooLarge: ClientError { .server(status: 413, code: "download_too_large", message: "这份资源超过当前导出允许的大小，已停止读取。") }
}
