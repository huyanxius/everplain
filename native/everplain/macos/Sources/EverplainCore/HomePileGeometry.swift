import Foundation

/// Pile.tsx / personal-home.css, with distances in the Web's CSS-pixel baseline.
public enum HomePileKind: String, Sendable { case hand, deck }
public struct HomePileGeometry: Sendable, Equatable {
    public let width: Double
    public let height: Double
    public let x: Double
    public let y: Double
    public let rotation: Double
    public let opacity: Double
    public let delay: Double
    public static func containerHeight(kind: HomePileKind, count: Int, expanded: Bool) -> Double {
        expanded ? max(0, Double(count) * (kind == .hand ? 208 : 124) - 12) : (kind == .hand ? 236 : 152)
    }
    public static func card(kind: HomePileKind, index: Int, hasCover: Bool, width: Double, expanded: Bool) -> Self {
        let depth = min(index + (hasCover ? 1 : 0), 2)
        let hiddenDepth = index + (hasCover ? 1 : 0) >= 3
        return Self(width: max(0, width - (expanded ? 0 : 44)),
                    height: expanded ? (kind == .hand ? 196 : 112) : (kind == .hand ? 212 : 138),
                    x: expanded ? 0 : Double(depth) * (kind == .hand ? 22 : 6),
                    y: expanded ? Double(index) * (kind == .hand ? 208 : 124) : Double(depth) * (kind == .hand ? 10 : 6),
                    rotation: expanded || kind == .deck ? 0 : Double(depth) * 2.5,
                    opacity: !expanded && hiddenDepth ? 0 : 1, delay: Double(index) * 0.055)
    }
}
