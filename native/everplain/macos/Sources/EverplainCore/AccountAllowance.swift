import Foundation

/// The Web meter is based on settled points, never a temporary frozen balance.
public struct AccountAllowance: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let remainingPercent: Double?
    public var label: String { ["welcome": "赠送额度", "subscription": "套餐额度", "top_up": "额外购买额度"][kind] ?? kind }
    public static func from(_ credits: CreditSummaryResponse, now: Date = Date()) -> [Self] {
        guard credits.quotaStatus != "unavailable", !credits.isUnlimited else { return [] }
        let formatter = ISO8601DateFormatter()
        let all = credits.activeUsageBuckets ?? []
        return all.compactMap { bucket in
            guard ["welcome", "subscription", "top_up"].contains(bucket.kind) else { return nil }
            if let raw = bucket.expiresAt {
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                var expiry = formatter.date(from: raw)
                if expiry == nil { formatter.formatOptions = [.withInternetDateTime]; expiry = formatter.date(from: raw) }
                guard let expiry, expiry > now else { return nil }
            }
            let remaining = bucket.settledRemainingPoints ?? Double(all.count == 1 && bucket.kind == "welcome" ? credits.balance : bucket.availablePoints)
            let limit = Double(bucket.limitPoints)
            let percent = remaining.isFinite && remaining >= 0 && limit > 0 && remaining <= limit
                ? (remaining / limit * 10_000).rounded() / 100 : nil
            return Self(id: bucket.bucketId, kind: bucket.kind, remainingPercent: percent)
        }
    }
}
