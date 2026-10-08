#if os(macOS)
import SwiftUI

/// Original Web vector geometry with native equivalents of idle/think/work/greet keyframes.
struct AgentAvatar: View {
    enum MotionState: Equatable { case idle, think, work, greet }
    let id: String
    let color: String
    var size: Double = 72
    var thinking = false
    var state: MotionState = .idle
    var playing = true
    var offset = 0.0
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var started = Date()
    @State private var blinkStarted = Date()
    @State private var pausedElapsed = 0.0
    @State private var pausedBlinkElapsed = 0.0
    static let presets = AvatarData.presets
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reducedMotion || !playing)) { timeline in
            Canvas { context, canvasSize in
                let preset = Self.presets.first(where: { $0.id == id }) ?? Self.presets[0]
                let motion = thinking ? MotionState.think : state
                let elapsed = reducedMotion ? 0 : !playing ? pausedElapsed : max(0, timeline.date.timeIntervalSince(started))
                let pose = Self.pose(motion, elapsed: elapsed, reduced: reducedMotion, blinkElapsed: playing ? timeline.date.timeIntervalSince(blinkStarted) : pausedBlinkElapsed, offset: offset)
                let body = Color(hex: color), ink = Color(hex: "#16141f"), inner = Self.innerColor(color)
                context.scaleBy(x: canvasSize.width / 120, y: canvasSize.height / 120)
                // transform-box: fill-box; aa-head transform-origin: 50% 90%.
                var bounds = preset.body.boundingRect
                for decoration in preset.behind { bounds = bounds.union(decoration.path.boundingRect) }
                let pivot = CGPoint(x: bounds.midX, y: bounds.minY + bounds.height * 0.9)
                context.translateBy(x: pivot.x, y: pivot.y - pose.lift)
                context.rotate(by: .degrees(pose.tilt))
                context.concatenate(CGAffineTransform(a: 1, b: 0, c: tan(pose.turn * 2.5 * .pi / 180), d: 1, tx: 0, ty: 0))
                context.scaleBy(x: 1 + pose.squash * 0.07, y: 1 - pose.squash * 0.07)
                context.translateBy(x: -pivot.x, y: -pivot.y)
                var behind = context
                behind.translateBy(x: pose.turn * 2.5, y: pose.nod * -1.5)
                for decoration in preset.behind {
                    let fill = (decoration.fill == "ink" ? ink : decoration.fill == "inner" ? inner : body).opacity(decoration.opacity)
                    if decoration.strokeWidth > 0 { behind.stroke(decoration.path, with: .color(fill), style: StrokeStyle(lineWidth: decoration.strokeWidth, lineCap: .round)) }
                    else { behind.fill(decoration.path, with: .color(fill)) }
                }
                context.fill(preset.body, with: .color(body))
                context.translateBy(x: preset.look.x + preset.gazeOrigin.x + pose.turn * 20, y: preset.look.y + preset.gazeOrigin.y + pose.nod * 8)
                context.rotate(by: .degrees(-14 - pose.turn * 28))
                context.translateBy(x: -preset.gazeOrigin.x, y: -preset.gazeOrigin.y)
                for offset in [-6.6, 6.6] {
                    var eye = context
                    eye.translateBy(x: offset, y: 0)
                    eye.scaleBy(x: 1, y: pose.lid)
                    if motion == .greet {
                        var happy = Path(); happy.move(to: CGPoint(x: -4.4, y: 2)); happy.addQuadCurve(to: CGPoint(x: 4.4, y: 2), control: CGPoint(x: 0, y: -5.5))
                        eye.stroke(happy, with: .color(ink.opacity(0.86)), style: StrokeStyle(lineWidth: 3.6, lineCap: .round))
                    } else { eye.fill(Path(roundedRect: CGRect(x: -3.6, y: -8, width: 7.2, height: 16), cornerRadius: 3.6), with: .color(ink.opacity(0.86))) }
                }
                if preset.nose { context.fill(Path(ellipseIn: CGRect(x: -2.6, y: 8.6, width: 5.2, height: 3.8)), with: .color(ink.opacity(0.86))) }
            }
        }.frame(width: size, height: size).accessibilityHidden(true)
            .onChange(of: state) { _ in started = Date(); pausedElapsed = 0 }
            .onChange(of: thinking) { _ in started = Date(); pausedElapsed = 0 }
            .onChange(of: playing) { active in
                if active { started = Date().addingTimeInterval(-pausedElapsed); blinkStarted = Date().addingTimeInterval(-pausedBlinkElapsed) }
                else { pausedElapsed = max(0, Date().timeIntervalSince(started)); pausedBlinkElapsed = max(0, Date().timeIntervalSince(blinkStarted)) }
            }
            .onChange(of: reducedMotion) { _ in started = Date(); blinkStarted = Date(); pausedElapsed = 0; pausedBlinkElapsed = 0 }
    }
    struct Pose {
        var turn = 0.0, nod = 0.0, tilt = 0.0, lift = 0.0, squash = 0.0, lid = 1.0
    }
    /// Piecewise CSS keyframes, with timing curves applied per interval.
    static func pose(_ state: MotionState, elapsed: Double, reduced: Bool, blinkElapsed: Double? = nil, offset: Double = 0) -> Pose {
        if reduced { return Pose(nod: state == .work ? 1 : 0, lid: state == .think ? 0.8 : state == .work ? 0.62 : 1) }
        var p = Pose()
        switch state {
        case .idle:
            p.turn = sample(elapsed + offset, duration: 8, keys: [(0,0),(0.22,0),(0.30,-1),(0.48,-1),(0.56,-0.45),(0.62,-0.45),(0.70,0),(1,0)], curve: [0.5,0,0.3,1])
            p.nod = sample(elapsed + offset, duration: 8, keys: [(0,0),(0.22,0),(0.30,0.25),(0.48,0.25),(0.56,-0.6),(0.62,-0.6),(0.70,0),(1,0)], curve: [0.5,0,0.3,1])
            p.lift = sample(elapsed + offset, duration: 3.4, keys: [(0,0),(0.5,1.5),(1,0)])
            p.squash = sample(elapsed + offset, duration: 3.4, keys: [(0,0),(0.5,-0.25),(1,0)])
        case .think:
            p.turn = sample(elapsed + offset, duration: 5, keys: [(0,-0.2),(0.5,-0.75),(1,-0.2)])
            p.nod = sample(elapsed + offset, duration: 5, keys: [(0,-1),(0.5,-0.75),(1,-1)])
            p.tilt = sample(elapsed + offset, duration: 5, keys: [(0,-5),(0.5,3),(1,-5)])
            p.lid = 0.8
            p.lift = sample(elapsed, duration: 4.4, keys: [(0,0),(0.5,1.5),(1,0)])
            p.squash = sample(elapsed, duration: 4.4, keys: [(0,0),(0.5,-0.25),(1,0)])
        case .work:
            p.turn = sample(elapsed + offset, duration: 1.2, keys: [(0,-1),(0.78,-0.05),(0.86,0),(1,-1)], curve: [0.4,0,0.6,1])
            p.nod = 1; p.lid = 0.62
            p.lift = sample(elapsed, duration: 0.4, keys: [(0,0),(0.5,1.8),(1,0)])
        case .greet:
            p.turn = -0.5
            p.lift = sample(elapsed + offset, duration: 2.2, keys: [(0,0),(0.08,0),(0.22,12),(0.36,0),(0.46,0),(0.56,0),(1,0)], curve: [0.3,0.7,0.3,1])
            p.squash = sample(elapsed + offset, duration: 2.2, keys: [(0,0),(0.08,1),(0.22,-0.8),(0.36,0.8),(0.46,0),(0.56,0),(1,0)], curve: [0.3,0.7,0.3,1])
            p.tilt = sample(elapsed + offset, duration: 2.2, keys: [(0,0),(0.08,0),(0.22,-6),(0.36,5),(0.46,0),(0.56,0),(1,0)], curve: [0.3,0.7,0.3,1])
        }
        p.lid = sample((blinkElapsed ?? elapsed) + offset, duration: 4.6, keys: [(0,p.lid),(0.91,p.lid),(0.935,0.08),(0.96,p.lid),(1,p.lid)], curve: [0.25,0.1,0.25,1])
        return p
    }
    private static func sample(_ elapsed: Double, duration: Double, keys: [(Double,Double)], curve: [Double] = [0.42,0,0.58,1]) -> Double {
        let t = elapsed.truncatingRemainder(dividingBy: duration) / duration
        for i in 1..<keys.count where t <= keys[i].0 {
            let a = keys[i-1], b = keys[i]
            let fraction = (t - a.0) / (b.0 - a.0)
            return a.1 + (b.1 - a.1) * bezier(fraction, curve)
        }
        return keys.last!.1
    }
    private static func bezier(_ x: Double, _ curve: [Double]) -> Double {
        func coordinate(_ t: Double, _ a: Double, _ b: Double) -> Double { 3 * (1-t) * (1-t) * t * a + 3 * (1-t) * t * t * b + t * t * t }
        var lower = 0.0, upper = 1.0
        for _ in 0..<16 { let mid = (lower + upper) / 2; if coordinate(mid, curve[0], curve[2]) < x { lower = mid } else { upper = mid } }
        return coordinate((lower + upper) / 2, curve[1], curve[3])
    }
    /// CSS color-mix(in oklab, body, #1b1a24 22%) including custom body colors.
    static func innerColor(_ hex:String)->Color {
        func rgb(_ text:String)->[Double] { let n=UInt64(text.dropFirst(),radix:16) ?? 0; return [Double((n>>16)&255)/255,Double((n>>8)&255)/255,Double(n&255)/255] }
        func linear(_ x:Double)->Double { x<=0.04045 ? x/12.92 : pow((x+0.055)/1.055,2.4) }
        func lab(_ rgb:[Double])->[Double] {
            let r=linear(rgb[0]),g=linear(rgb[1]),b=linear(rgb[2])
            let l=cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b)
            return [0.2104542553*l+0.793617785*m-0.0040720468*s,1.9779984951*l-2.428592205*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.808675766*s]
        }
        let a=lab(rgb(hex)),b=lab(rgb("#1b1a24")),c=(0..<3).map{a[$0]*0.78+b[$0]*0.22}
        let l=pow(c[0]+0.3963377774*c[1]+0.2158037573*c[2],3),m=pow(c[0]-0.1055613458*c[1]-0.0638541728*c[2],3),s=pow(c[0]-0.0894841775*c[1]-1.291485548*c[2],3)
        func encode(_ x:Double)->Double { min(1,max(0,x<=0.0031308 ? 12.92*x : 1.055*pow(x,1/2.4)-0.055)) }
        return Color(.sRGB,red:encode(4.0767416621*l-3.3077115913*m+0.2309699292*s),green:encode(-1.2684380046*l+2.6097574011*m-0.3413193965*s),blue:encode(-0.0041960863*l-0.7034186147*m+1.707614701*s),opacity:1)
    }
}
#endif
