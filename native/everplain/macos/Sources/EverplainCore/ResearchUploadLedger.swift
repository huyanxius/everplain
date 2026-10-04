import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// The semantic multipart body, including a digest of the bytes actually read.
/// Paths and modification dates are deliberately not used as content identity.
public struct ResearchUploadFileIdentity: Equatable, Sendable {
    public let filename: String
    public let mimeType: String
    public let byteCount: UInt64
    public let sha256: String
    public let materialKind: String
    public let deferProcessing: Bool

    public init(filename: String, mimeType: String, byteCount: UInt64, sha256: String,
                materialKind: String = "other", deferProcessing: Bool = true) {
        self.filename = filename; self.mimeType = mimeType; self.byteCount = byteCount
        self.sha256 = sha256; self.materialKind = materialKind; self.deferProcessing = deferProcessing
    }
}

public enum ResearchUploadLedgerError: Error { case missingOwner, emptyBatch }

/// Process-local retry journal. It retains keys and successful responses, never file bytes.
/// Failed/uncertain batches survive unrelated batches and API-client replacement for the same owner.
public struct ResearchUploadLedger<Value: Sendable> {
    public struct File: Sendable {
        public let identity: ResearchUploadFileIdentity
        public let key: String
        public let boundary: String
        public fileprivate(set) var value: Value?
    }
    public struct Batch: Sendable {
        public let id: UUID
        public let ownerGeneration: UUID
        public let scope: String
        public let requestedTaskId: String?
        public let projectKey: String
        public fileprivate(set) var destinationTaskId: String?
        public fileprivate(set) var files: [File]
        public var pendingIndices: [Int] { files.indices.filter { files[$0].value == nil } }
    }
    private var owner: String?
    private var ownerGeneration = UUID()
    private var batches: [UUID: Batch] = [:]
    private var operationKeys: [String: String] = [:]
    public init() {}

    /// A nil owner resets even if already signed out; old handles cannot acknowledge new work.
    public mutating func configure(owner: String?) {
        guard owner == nil || self.owner != owner else { return }
        self.owner = owner; ownerGeneration = UUID(); batches.removeAll(); operationKeys.removeAll()
    }

    public mutating func begin(scope: String, taskId: String?, files: [ResearchUploadFileIdentity],
                               allowResolvedDestination: Bool = false) throws -> Batch {
        guard owner != nil else { throw ResearchUploadLedgerError.missingOwner }
        guard !files.isEmpty else { throw ResearchUploadLedgerError.emptyBatch }
        if let batch = batches.values.first(where: {
            $0.scope == scope && $0.files.map(\.identity) == files &&
            ($0.requestedTaskId == taskId || (allowResolvedDestination && taskId != nil && $0.destinationTaskId == taskId))
        }) { return batch }
        let batch = Batch(id: UUID(), ownerGeneration: ownerGeneration, scope: scope, requestedTaskId: taskId,
                          projectKey: "material-entry:" + UUID().uuidString, destinationTaskId: taskId,
                          files: files.map { identity in
            let token = UUID().uuidString
            return File(identity: identity, key: "material-upload:" + token, boundary: "----everplain-" + token)
        })
        batches[batch.id] = batch
        return batch
    }

    public func snapshot(_ batch: Batch) -> Batch? {
        guard batch.ownerGeneration == ownerGeneration else { return nil }
        return batches[batch.id]
    }

    @discardableResult public mutating func setDestination(_ taskId: String, for batch: Batch) -> Bool {
        guard var current = snapshot(batch), !taskId.isEmpty,
              current.destinationTaskId == nil || current.destinationTaskId == taskId else { return false }
        current.destinationTaskId = taskId; batches[batch.id] = current; return true
    }

    @discardableResult public mutating func succeed(_ value: Value, at index: Int, in batch: Batch) -> Bool {
        guard var current = snapshot(batch), current.files.indices.contains(index) else { return false }
        current.files[index].value = value; batches[batch.id] = current; return true
    }

    /// Clear only the exact batch after every file has a confirmed successful response.
    public mutating func finish(_ batch: Batch) -> [Value]? {
        guard let current = snapshot(batch), current.pendingIndices.isEmpty else { return nil }
        batches.removeValue(forKey: batch.id)
        return current.files.compactMap(\.value)
    }

    public mutating func operationKey(for action: String) throws -> String {
        guard owner != nil else { throw ResearchUploadLedgerError.missingOwner }
        if let key = operationKeys[action] { return key }
        let key = UUID().uuidString; operationKeys[action] = key; return key
    }
    public mutating func finishOperation(_ action: String) { operationKeys.removeValue(forKey: action) }
}

/// Streaming SHA-256 used only to identify upload bodies. Portable so retry behavior is testable
/// without an Apple SDK. The hasher keeps at most one unfinished 64-byte block.
public struct ResearchUploadDigest {
#if canImport(CryptoKit)
    private var native = SHA256()
#else
    private var state: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    private var tail: [UInt8] = []
#endif
    public private(set) var byteCount: UInt64 = 0
    public init() {}
    public mutating func update(_ data: Data) {
        byteCount &+= UInt64(data.count)
#if canImport(CryptoKit)
        native.update(data: data)
#else
        data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            var offset = 0
            if !tail.isEmpty {
                let count = min(64 - tail.count, bytes.count)
                tail.append(contentsOf: bytes.prefix(count)); offset += count
                if tail.count == 64 { compress(tail); tail.removeAll(keepingCapacity: true) }
            }
            while offset + 64 <= bytes.count {
                compress(bytes[offset..<(offset + 64)]); offset += 64
            }
            if offset < bytes.count { tail.append(contentsOf: bytes[offset...]) }
        }
#endif
    }
    public func finalized() -> String {
#if canImport(CryptoKit)
        return native.finalize().map { String(format: "%02x", $0) }.joined()
#else
        var value = self
        value.tail.append(0x80)
        while value.tail.count % 64 != 56 { value.tail.append(0) }
        let bits = byteCount &* 8
        for shift in stride(from: 56, through: 0, by: -8) { value.tail.append(UInt8(truncatingIfNeeded: bits >> shift)) }
        for offset in stride(from: 0, to: value.tail.count, by: 64) {
            value.compress(Array(value.tail[offset..<(offset + 64)]))
        }
        return value.state.map { String(format: "%08x", $0) }.joined()
#endif
    }
    public static func hash(_ bytes: Data) -> String {
        var digest = Self(); digest.update(bytes); return digest.finalized()
    }
#if !canImport(CryptoKit)
    private mutating func compress<Bytes: Collection>(_ block: Bytes) where Bytes.Element == UInt8 {
        let b = Array(block)
        var w = [UInt32](repeating: 0, count: 64)
        for i in 0..<16 { let p = i * 4; w[i] = UInt32(b[p]) << 24 | UInt32(b[p+1]) << 16 | UInt32(b[p+2]) << 8 | UInt32(b[p+3]) }
        for i in 16..<64 {
            let x = w[i-15], y = w[i-2]
            let s0 = Self.rotate(x, 7) ^ Self.rotate(x, 18) ^ (x >> 3)
            let s1 = Self.rotate(y, 17) ^ Self.rotate(y, 19) ^ (y >> 10)
            w[i] = w[i-16] &+ s0 &+ w[i-7] &+ s1
        }
        var a = state[0], b0 = state[1], c = state[2], d = state[3]
        var e = state[4], f = state[5], g = state[6], h = state[7]
        for i in 0..<64 {
            let s1 = Self.rotate(e, 6) ^ Self.rotate(e, 11) ^ Self.rotate(e, 25)
            let choice = (e & f) ^ (~e & g)
            let t1 = h &+ s1 &+ choice &+ Self.constants[i] &+ w[i]
            let s0 = Self.rotate(a, 2) ^ Self.rotate(a, 13) ^ Self.rotate(a, 22)
            let majority = (a & b0) ^ (a & c) ^ (b0 & c)
            let t2 = s0 &+ majority
            h = g; g = f; f = e; e = d &+ t1; d = c; c = b0; b0 = a; a = t1 &+ t2
        }
        let result = [a, b0, c, d, e, f, g, h]
        for i in 0..<8 { state[i] &+= result[i] }
    }
    private static func rotate(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
    private static let constants: [UInt32] = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ]
#endif
}
