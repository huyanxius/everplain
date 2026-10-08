import Foundation

/// Display-only values copied from the live Web useStreamPacer/sendFlight choreography.
/// The authoritative answer is never modified by pacing.
public enum ConversationMotion {
    public static let batchSeconds = 0.048
    public static let lightSeconds = 1.1
    public static let flightSeconds = 0.940
    public static let thinkingCollapseSeconds = 0.420

    public static func spring(_ seconds: Double) -> Double {
        let damping = 0.7, frequency = 2 * Double.pi / 0.7
        let damped = frequency * sqrt(1 - damping * damping)
        return 1 - exp(-damping * frequency * seconds) *
            (cos(damped * seconds) + damping * frequency / damped * sin(damped * seconds))
    }

    public static func ease(_ x: Double, _ curve: [Double] = [0.16, 1, 0.3, 1]) -> Double {
        func coordinate(_ t: Double, _ a: Double, _ b: Double) -> Double {
            3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
        }
        let x = min(1, max(0, x))
        var lower = 0.0, upper = 1.0
        for _ in 0..<18 {
            let mid = (lower + upper) / 2
            if coordinate(mid, curve[0], curve[2]) < x { lower = mid } else { upper = mid }
        }
        return coordinate((lower + upper) / 2, curve[1], curve[3])
    }

    /// Stretch comes from the same sampled spring velocity as the horizontal flight.
    public static func flightStretch(_ progress: Double) -> (x: Double, y: Double) {
        let samples = (0...56).map { $0 == 56 ? 1 : spring(Double($0) / 56 * flightSeconds) }
        let velocities = samples.indices.map { samples[min(56, $0 + 1)] - samples[max(0, $0 - 1)] }
        let step = min(56, max(0, progress * 56)), lower = Int(step), upper = min(56, lower + 1)
        let velocity = velocities[lower] + (velocities[upper] - velocities[lower]) * (step - Double(lower))
        let normalized = velocity / (velocities.max() ?? 1)
        let pinch = 0.035 * exp(-pow((progress - 0.06) / 0.05, 2))
        return (1 + 0.055 * normalized - pinch, 1 - 0.04 * normalized - pinch)
    }
}

public struct ConversationStreamPacer: Equatable, Sendable {
    public private(set) var answer = ""
    public private(set) var visible = ""
    /// UTF-16 source offsets, matching Markdown source positions and the Web implementation.
    public private(set) var revealedAt: [Double] = []
    public private(set) var streaming = false
    private var animated = false
    private var reduced = false
    private var lastReveal = 0.0
    private var lightActive = false

    public init() {}

    public mutating func update(answer next: String, streaming: Bool, reducedMotion: Bool) {
        let replaces = !next.utf16.starts(with: answer.utf16)
        answer = next
        self.streaming = streaming
        reduced = reducedMotion
        if reducedMotion || replaces || (!animated && !streaming) {
            visible = next
            revealedAt = []
            lightActive = false
            animated = streaming && !reducedMotion
        } else if streaming { animated = true }
        if !streaming && visible == next && !lightActive { revealedAt = []; animated = false }
    }

    /// Returns whether a display update is needed. UTF-16 pairs are never split.
    @discardableResult public mutating func tick(now: Double) -> Bool {
        guard !reduced else { return false }
        let units = Array(answer.utf16), start = visible.utf16.count
        let backlog = units.count - start
        if backlog > 0 {
            let count = max(1, Int(ceil(min(420, 36 + Double(backlog) * 2.4) * ConversationMotion.batchSeconds)))
            var end = min(units.count, start + count)
            if end < units.count && (0xDC00...0xDFFF).contains(units[end]) { end += 1 }
            let batch = String(decoding: units[start..<end], as: UTF16.self)
            let scalars = Array(batch.unicodeScalars)
            var offset = start
            if revealedAt.count < end { revealedAt += Array(repeating: 0, count: end - revealedAt.count) }
            for (index, scalar) in scalars.enumerated() {
                let at = now - ConversationMotion.batchSeconds + Double(index) * ConversationMotion.batchSeconds / Double(scalars.count)
                for _ in 0..<scalar.utf16.count { revealedAt[offset] = at; offset += 1 }
            }
            visible = String(decoding: units.prefix(end), as: UTF16.self)
            lastReveal = now
            lightActive = true
            return true
        }
        if lightActive && now - lastReveal >= ConversationMotion.lightSeconds {
            lightActive = false
            if !streaming { revealedAt = []; animated = false }
            return true
        }
        return false
    }

    public var needsTicks: Bool { !reduced && (visible != answer || lightActive) }
}
