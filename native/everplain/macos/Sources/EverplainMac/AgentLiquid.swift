#if os(macOS)
import SwiftUI
import EverplainCore

/// The seven original bodies flow through cached, source-derived 120-radius contours.
/// Matches live AgentLiquid.tsx: .6s hold, 2/3s flow, 1.5x spring/ripple speed.
struct AgentLiquid: View {
    var lead: String?
    var color: String?
    var size: Double = 76
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var started = Date()
    private var first: String { AgentLiquidContours.order.contains(lead ?? "") ? lead! : "cheng" }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reducedMotion)) { timeline in
            Canvas { context, canvasSize in
                let elapsed = reducedMotion ? 0 : max(0, timeline.date.timeIntervalSince(started))
                let order = [first] + AgentLiquidContours.order.filter { $0 != first }
                let period = 0.6 + 1 / 1.5, step = Int(floor(elapsed / period))
                let local = elapsed - Double(step) * period
                let aId = order[step % order.count], bId = order[(step + 1) % order.count]
                guard let a = AgentAvatar.presets.first(where: { $0.id == aId }), let b = AgentAvatar.presets.first(where: { $0.id == bId }),
                      let ra = AgentLiquidContours.radii[aId], let rb = AgentLiquidContours.radii[bId] else { return }
                let phase = local > 0.6 ? ConversationMotion.spring((local - 0.6) * 1.5) : 0
                let weight = min(1, max(0, phase)), waveTime = elapsed * 1.5
                let amplitude = 0.5 + 2.6 * sin(Double.pi * min(1, (local - 0.6) / (1 / 1.5))) * (local > 0.6 ? 1 : 0)
                let points = ra.indices.map { index -> CGPoint in
                    let angle = -Double.pi / 2 + Double(index) * 2 * Double.pi / 120
                    let radius = ra[index] + (rb[index] - ra[index]) * phase + amplitude * (0.6 * sin(3 * angle + waveTime * 2.1) + 0.4 * sin(5 * angle - waveTime * 1.7))
                    return CGPoint(x: 60 + cos(angle) * radius, y: 62 + sin(angle) * radius)
                }
                let path = Self.closedSmoothPath(points)
                let rgb = OklabColorMix.mix(OklabColorMix.rgb(hex: lead == aId ? color ?? a.color : a.color),
                                           OklabColorMix.rgb(hex: lead == bId ? color ?? b.color : b.color), amount: weight)
                let body = OklabColorMix.color(rgb)
                let inner = OklabColorMix.color(OklabColorMix.mix(rgb, OklabColorMix.rgb(hex: "#1b1a24"), amount: 0.22))
                let ink = Color(hex: "#16141f")
                let pose = AgentAvatar.pose(.idle, elapsed: elapsed, reduced: reducedMotion)
                context.scaleBy(x: canvasSize.width / 120, y: canvasSize.height / 120)
                var bounds = path.boundingRect
                for preset in AgentAvatar.presets { for decoration in preset.behind { bounds = bounds.union(decoration.path.boundingRect) } }
                let pivot = CGPoint(x: bounds.midX, y: bounds.minY + bounds.height * 0.9)
                context.translateBy(x: pivot.x, y: pivot.y - pose.lift)
                context.rotate(by: .degrees(pose.tilt))
                context.concatenate(CGAffineTransform(a: 1, b: 0, c: tan(pose.turn * 2.5 * .pi / 180), d: 1, tx: 0, ty: 0))
                context.scaleBy(x: 1 + pose.squash * 0.07, y: 1 - pose.squash * 0.07)
                context.translateBy(x: -pivot.x, y: -pivot.y)
                for (preset, visibility) in [(a, 1 - weight), (b, weight)] where visibility > 0 {
                    var decor = context
                    decor.translateBy(x: pose.turn * 2.5 + 60, y: pose.nod * -1.5 + 62)
                    decor.scaleBy(x: 0.55 + 0.45 * visibility, y: 0.55 + 0.45 * visibility)
                    decor.translateBy(x: -60, y: -62)
                    for decoration in preset.behind {
                        let fill = (decoration.fill == "ink" ? ink : decoration.fill == "inner" ? inner : body).opacity(decoration.opacity * visibility)
                        if decoration.strokeWidth > 0 { decor.stroke(decoration.path, with: .color(fill), style: StrokeStyle(lineWidth: decoration.strokeWidth, lineCap: .round)) }
                        else { decor.fill(decoration.path, with: .color(fill)) }
                    }
                }
                context.fill(path, with: .color(body))
                let look = CGPoint(x: a.look.x + (b.look.x - a.look.x) * phase, y: a.look.y + (b.look.y - a.look.y) * phase)
                context.translateBy(x: look.x + pose.turn * 20, y: look.y + 2.2 + pose.nod * 8)
                context.rotate(by: .degrees(-14 - pose.turn * 28))
                context.translateBy(x: 0, y: -2.2)
                for offset in [-6.6, 6.6] {
                    var eye = context; eye.translateBy(x: offset, y: 0); eye.scaleBy(x: 1, y: pose.lid)
                    eye.fill(Path(roundedRect: CGRect(x: -3.6, y: -8, width: 7.2, height: 16), cornerRadius: 3.6), with: .color(ink.opacity(0.86)))
                }
                let nose = ((a.nose ? 1 - weight : 0) + (b.nose ? weight : 0)) * 0.86
                context.fill(Path(ellipseIn: CGRect(x: -2.6, y: 8.6, width: 5.2, height: 3.8)), with: .color(ink.opacity(nose)))
            }
        }.frame(width: size, height: size).accessibilityHidden(true)
            .onChange(of: first) { _ in started = Date() }
            .onChange(of: reducedMotion) { _ in started = Date() }
    }
    private static func closedSmoothPath(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first, points.count > 2 else { return path }
        path.move(to: first)
        let count = points.count
        for index in points.indices {
            let a = points[(index - 1 + count) % count], b = points[index], c = points[(index + 1) % count], d = points[(index + 2) % count]
            path.addCurve(to: c, control1: CGPoint(x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6),
                          control2: CGPoint(x: c.x - (d.x - b.x) / 6, y: c.y - (d.y - b.y) / 6))
        }
        path.closeSubpath(); return path
    }
}
#endif
