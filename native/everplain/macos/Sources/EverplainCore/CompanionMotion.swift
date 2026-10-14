import Foundation

/// Authored Xiaoping illustration data, distinct from the user's geometric Agent avatars.
public struct CompanionAsset: Decodable, Sendable {
    public let sourceSha256: String
    public let cssSha256: String
    public let viewBox: [Double]
    public let palette: [String: String]
    public let defs: [CompanionNode]
    public let root: CompanionNode
}

public struct CompanionNode: Decodable, Sendable {
    public let type: String
    public let attributes: [String: String]
    public let bounds: [Double]?
    public let children: [CompanionNode]
    public var classes: Set<String> { Set((attributes["class"] ?? "").split(separator: " ").map(String.init)) }
}

public enum CompanionPathCommand: Equatable, Sendable {
    case move(Double, Double), line(Double, Double)
    case cubic(Double, Double, Double, Double, Double, Double)
    case quad(Double, Double, Double, Double), close
}

public enum CompanionVectorPath {
    public enum ParseError: Error { case invalidPath }
    /// The original illustration uses only M/L/C/Q/Z, including relative star segments.
    public static func parse(_ source: String) throws -> [CompanionPathCommand] {
        let regex = try NSRegularExpression(pattern: "[a-zA-Z]|[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?")
        let raw = source as NSString
        let tokens = regex.matches(in: source, range: NSRange(location: 0, length: raw.length)).map { raw.substring(with: $0.range) }
        var result: [CompanionPathCommand] = []
        var index = 0, command = "", x = 0.0, y = 0.0, startX = 0.0, startY = 0.0
        while index < tokens.count {
            if tokens[index].count == 1, tokens[index].first!.isLetter { command = tokens[index]; index += 1 }
            let operation = command.uppercased()
            if operation == "Z" { result.append(.close); x = startX; y = startY; command = ""; continue }
            guard let count = ["M": 2, "L": 2, "C": 6, "Q": 4][operation], index + count <= tokens.count else { throw ParseError.invalidPath }
            var values: [Double] = []
            for offset in 0..<count {
                guard let number = Double(tokens[index + offset]), number.isFinite else { throw ParseError.invalidPath }
                let relative = command == command.lowercased() ? (offset.isMultiple(of: 2) ? x : y) : 0
                values.append(number + relative)
            }
            index += count
            switch operation {
            case "M":
                result.append(.move(values[0], values[1])); startX = values[0]; startY = values[1]
                command = command == "m" ? "l" : "L"
            case "L": result.append(.line(values[0], values[1]))
            case "C": result.append(.cubic(values[0], values[1], values[2], values[3], values[4], values[5]))
            case "Q": result.append(.quad(values[0], values[1], values[2], values[3]))
            default: throw ParseError.invalidPath
            }
            x = values[count - 2]; y = values[count - 1]
        }
        return result
    }
}

public struct CompanionPose: Equatable, Sendable {
    public var y = 0.0, scaleX = 1.0, scaleY = 1.0, rotation = 0.0
    public var anchorX = 0.5, anchorY = 0.0
    public init() {}
}

public struct CompanionGaze: Equatable, Sendable {
    public private(set) var turn = 0.2
    public private(set) var nod = 0.0
    private var targetTurn = 0.2, targetNod = 0.0, movedAt = 0.0
    public init() {}
    public mutating func observe(x: Double, y: Double, width: Double, height: Double, now: Double) {
        guard width > 0, height > 0 else { return }
        targetTurn = min(1, max(-1, x / (width * 0.45)))
        targetNod = min(1, max(-1, y / (height * 0.6)))
        movedAt = now
    }
    public mutating func tick(now: Double, reduced: Bool) {
        if reduced { turn = 0.25; nod = 0; return }
        if now - movedAt > 4 {
            targetTurn = sin(now / 2.3) * 0.7 + sin(now / 0.9) * 0.12
            targetNod = sin(now / 3.1) * 0.35
        }
        turn += (targetTurn - turn) * 0.08
        nod += (targetNod - nod) * 0.08
    }
}

public enum CompanionMotion {
    public static let happyDuration = 1.6
    public static let leaveDuration = 0.45
    public static func entrance(age: Double, active: Bool, reduced: Bool) -> Double {
        if reduced { return active ? 0 : 1.05 }
        if !active { return 1.05 * ConversationMotion.ease(age / 0.45, [0.4, 0, 0.7, 0.2]) }
        return 0.7 * (1 - ConversationMotion.ease((age - 0.4) / 0.9, [0.34, 1.4, 0.64, 1]))
    }
    public static func sample(_ time: Double, duration: Double, delay: Double = 0, keys: [(Double, Double)], curve: [Double] = [0.42, 0, 0.58, 1], loop: Bool = true) -> Double {
        let value = max(0, time + delay)
        let phase = loop ? value.truncatingRemainder(dividingBy: duration) / duration : min(1, value / duration)
        for index in 1..<keys.count where phase <= keys[index].0 {
            let a = keys[index - 1], b = keys[index]
            let progress = (phase - a.0) / (b.0 - a.0)
            return a.1 + (b.1 - a.1) * ConversationMotion.ease(progress, curve)
        }
        return keys.last?.1 ?? 0
    }
    public static func pose(classes c: Set<String>, elapsed: Double, bobElapsed: Double, happyAge: Double?, reduced: Bool) -> CompanionPose {
        var p = CompanionPose()
        guard !reduced else { return p }
        func sway(_ duration: Double, delay: Double = 0, wide: Bool = false, x: Double = 0.5, y: Double = 0) -> CompanionPose {
            var result = CompanionPose(); result.anchorX = x; result.anchorY = y
            result.rotation = sample(elapsed, duration: duration, delay: delay, keys: [(0, wide ? -3 : -1.6), (0.5, wide ? 3.4 : 1.8), (1, wide ? -3 : -1.6)])
            return result
        }
        if c.contains("cp-bob") {
            p.anchorY = 0.95 // .companion .cp-bob wins over the less specific 85% rule.
            if let happyAge {
                if happyAge < 0.9 {
                    let curve = [0.33, 0.0, 0.2, 1.0]
                    p.y = sample(happyAge, duration: 0.9, keys: [(0,0),(0.18,1.5),(0.46,-6),(0.72,0),(0.88,-0.8),(1,0)], curve: curve, loop: false)
                    p.scaleX = sample(happyAge, duration: 0.9, keys: [(0,1),(0.18,1.03),(0.46,0.985),(0.72,1.012),(0.88,1),(1,1)], curve: curve, loop: false)
                    p.scaleY = sample(happyAge, duration: 0.9, keys: [(0,1),(0.18,0.97),(0.46,1.02),(0.72,0.988),(0.88,1),(1,1)], curve: curve, loop: false)
                }
            } else {
                p.y = sample(bobElapsed, duration: 3.8, keys: [(0,0),(0.5,-1.5),(1,0)])
                p.scaleX = sample(bobElapsed, duration: 3.8, keys: [(0,1),(0.5,1.006),(1,1)]); p.scaleY = p.scaleX
            }
        } else if c.contains("cp-sway-slow") { p = sway(6, y: 0.1) }
        else if c.contains("cp-strand--b") { p = sway(4.8, delay: 1.2) }
        else if c.contains("cp-strand--c") { p = sway(5.1, delay: 2.4) }
        else if c.contains("cp-strand") { p = sway(4.2) }
        else if c.contains("cp-lock") { p = sway(5.4, delay: c.contains("cp-lock--right") ? 2.7 : 0, wide: true) }
        else if c.contains("cp-ribbon") { p = sway(3.8, delay: 0.8, wide: true, x: 0.2) }
        else if c.contains("cp-ahoge") {
            p.anchorX = 0.3; p.anchorY = 1
            p.rotation = sample(elapsed, duration: 2.6, keys: [(0,-6),(0.4,9),(0.7,-2),(1,-6)], curve: [0.3,1.6,0.5,1])
        } else if c.contains("cp-eyes") {
            p.anchorY = 0.5
            p.scaleY = sample(elapsed, duration: 5.2, keys: [(0,1),(0.91,1),(0.94,0.08),(0.97,1),(1,1)], curve: [0.25,0.1,0.25,1])
        }
        return p
    }
}
