#if os(macOS)
import AppKit
import SwiftUI
import EverplainCore

/// The product illustration stays mounted above route content during its 450 ms exit.
@MainActor struct HomeCompanion: View {
    let active: Bool
    let reducedMotionOverride: Bool?
    @Environment(\.accessibilityReduceMotion) private var systemReduced
    @Environment(\.colorScheme) private var scheme
    @StateObject private var state: HomeCompanionState
    private let artwork = CompanionArtwork.shared
    private var reduced: Bool { reducedMotionOverride ?? systemReduced }
    init(active: Bool, state: HomeCompanionState? = nil, reducedMotionOverride: Bool? = nil) {
        self.active = active; self.reducedMotionOverride = reducedMotionOverride
        _state = StateObject(wrappedValue: state ?? HomeCompanionState())
    }
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if state.frame.present, let artwork {
                let width: CGFloat = state.viewportWidth <= 640 ? 93 : 150
                let height = width * 224 / 220
                Button { state.smile() } label: {
                    Canvas { context, size in
                        context.scaleBy(x: size.width / 220, y: size.width / 220)
                        context.translateBy(x: 0, y: 10)
                        artwork.draw(context: context, frame: state.frame, reduced: reduced)
                    }.frame(width: width, height: height).contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .background(CompanionPointerAnchor(state: state).allowsHitTesting(false))
                    .shadow(color: Palette(dark: scheme == .dark).ink.opacity(0.1), radius: 14, y: 6)
                    .offset(y: height * CGFloat(state.frame.slide) + 14)
                    .padding(.trailing, state.viewportWidth <= 640 ? T.space2 : T.space6)
                    .allowsHitTesting(active).accessibilityHidden(!active)
                    .accessibilityLabel(epLocalized("Everplain 的小平"))
            }
        }.onAppear { state.configure(active: active, reduced: reduced) }
            .onChange(of: active) { state.configure(active: $0, reduced: reduced) }
            .onChange(of: reduced) { state.configure(active: active, reduced: $0) }
            .onDisappear { state.stop() }
    }
}

struct CompanionFrame: Equatable {
    var present = false, elapsed = 0.0, bobElapsed = 0.0
    var happyAge: Double?
    var turn = 0.2, nod = 0.0, blush = 0.85, slide = 0.7
}

@MainActor final class HomeCompanionState: ObservableObject {
    @Published private(set) var frame = CompanionFrame()
    @Published private(set) var viewportWidth: CGFloat = 1000
    private var clock: Task<Void, Never>?
    private let origin = ProcessInfo.processInfo.systemUptime
    private var mountedAt = 0.0, changedAt = 0.0, bobStartedAt = 0.0
    private var happySince: Double?, blushSince = 0.0, blushFrom = 0.85, blushTarget = 0.85
    private var active = false, reduced = false, windowVisible = true
    private var gaze = CompanionGaze()
    private var now: Double { ProcessInfo.processInfo.systemUptime - origin }
    func configure(active: Bool, reduced: Bool) {
        let time = now
        if active != self.active {
            changedAt = time
            if active && !frame.present {
                mountedAt = time; bobStartedAt = time; happySince = nil; gaze = CompanionGaze()
                blushFrom = 0.85; blushTarget = 0.85; blushSince = time
            }
        }
        self.active = active; self.reduced = reduced
        if active { frame.present = true }
        if reduced && !active { frame.present = false }
        restartClock()
    }
    func observe(point: CGPoint, center: CGPoint, viewport: CGSize) {
        guard active, !reduced else { return }
        // AppKit has an upward Y axis, whereas the Web's clientY grows downward.
        gaze.observe(x: Double(point.x - center.x), y: Double(center.y - point.y), width: Double(viewport.width), height: Double(viewport.height), now: now)
    }
    func viewport(_ size: CGSize) { if viewportWidth != size.width { viewportWidth = size.width } }
    func visibility(_ visible: Bool) { windowVisible = visible }
    func smile() {
        guard active, happySince == nil else { return }
        happySince = now; setBlush(0.95, at: now); restartClock()
    }
    func stop() { clock?.cancel(); clock = nil }
    private func setBlush(_ value: Double, at time: Double) {
        blushFrom = blush(at: time); blushTarget = value; blushSince = time
    }
    private func blush(at time: Double) -> Double {
        let progress = ConversationMotion.ease((time - blushSince) / 0.3, [0.25, 0.1, 0.25, 1])
        return blushFrom + (blushTarget - blushFrom) * progress
    }
    private func restartClock() {
        stop()
        tick()
        guard frame.present else { return }
        clock = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let delay = self.nextDelay()
                do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
                guard !Task.isCancelled else { return }
                // Mood/departure deadlines must settle even when the app loses focus.
                self.tick()
                if !self.frame.present { return }
            }
        }
    }
    private func nextDelay() -> Double {
        if !windowVisible { return 0.2 }
        if !reduced || now - blushSince < 0.3 { return 1 / 60 }
        if let happySince { return max(0.001, min(1, happySince + CompanionMotion.happyDuration - now)) }
        return 1
    }
    private func tick() {
        let time = now
        if let happySince, time - happySince >= CompanionMotion.happyDuration {
            self.happySince = nil; bobStartedAt = time; setBlush(0.85, at: time)
        }
        let present = active || (!reduced && frame.present && time - changedAt < CompanionMotion.leaveDuration)
        if windowVisible || reduced { gaze.tick(now: time, reduced: reduced) }
        let elapsed = reduced ? 0 : windowVisible ? time - mountedAt : frame.elapsed
        let bobElapsed = reduced ? 0 : windowVisible ? time - bobStartedAt : frame.bobElapsed
        let next = CompanionFrame(present: present, elapsed: elapsed,
                                  bobElapsed: bobElapsed,
                                  happyAge: happySince.map { time - $0 },
                                  turn: (gaze.turn * 1000).rounded() / 1000, nod: (gaze.nod * 1000).rounded() / 1000,
                                  blush: blush(at: time), slide: CompanionMotion.entrance(age: time - changedAt, active: active, reduced: reduced))
        if frame != next { frame = next }
    }
}

/// Passive app-window events; no global event tap, permissions, or event consumption.
private struct CompanionPointerAnchor: NSViewRepresentable {
    let state: HomeCompanionState
    func makeNSView(context: Context) -> Anchor { let view = Anchor(); view.state = state; return view }
    func updateNSView(_ view: Anchor, context: Context) { view.state = state; view.reportViewport() }
    static func dismantleNSView(_ view: Anchor, coordinator: ()) { view.removeMonitor() }
    @MainActor final class Anchor: NSView {
        weak var state: HomeCompanionState?
        private var monitor: Any?
        private var observers: [NSObjectProtocol] = []
        private weak var trackedWindow: NSWindow?
        private var previousMouseEvents = false
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow(); removeMonitor()
            guard let window else { return }
            trackedWindow = window; previousMouseEvents = window.acceptsMouseMovedEvents; window.acceptsMouseMovedEvents = true
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]) { [weak self] event in
                let point = event.locationInWindow, number = event.windowNumber
                Task { @MainActor [weak self] in self?.observe(point, windowNumber: number) }
                return event
            }
            for name in [NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification, NSWindow.didChangeOcclusionStateNotification] {
                observers.append(NotificationCenter.default.addObserver(forName:name,object:window,queue:.main) { [weak self] _ in
                    Task { @MainActor [weak self] in self?.reportViewport() }
                })
            }
            reportViewport()
        }
        override func layout() { super.layout(); reportViewport() }
        func reportViewport() {
            // Avoid publishing while SwiftUI is updating this representable.
            Task { @MainActor [weak self] in
                guard let self, let window = self.window, let size = window.contentView?.bounds.size else { return }
                self.state?.viewport(size)
                self.state?.visibility(window.isVisible && !window.isMiniaturized)
            }
        }
        private func observe(_ point: CGPoint, windowNumber: Int) {
            guard let window, window.windowNumber == windowNumber, let content = window.contentView else { return }
            let center = convert(CGPoint(x: bounds.midX, y: bounds.midY), to: nil)
            state?.observe(point: point, center: center, viewport: content.bounds.size)
        }
        func removeMonitor() {
            if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
            observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll()
            trackedWindow?.acceptsMouseMovedEvents = previousMouseEvents; trackedWindow = nil
            state?.visibility(false)
        }
    }
}

private final class CompanionArtwork {
    static let shared = try? CompanionArtwork()
    private struct Node {
        let source: CompanionNode
        let path: Path?
        let children: [Node]
    }
    private let asset: CompanionAsset
    private let root: Node
    private let gradients: [String: CompanionNode]
    private init() throws {
        guard let url = Bundle.module.url(forResource: "companion", withExtension: "json", subdirectory: "Companion") else { throw CocoaError(.fileNoSuchFile) }
        asset = try JSONDecoder().decode(CompanionAsset.self, from: Data(contentsOf: url))
        root = try Self.read(asset.root)
        gradients = Dictionary(uniqueKeysWithValues: asset.defs.compactMap { node in node.attributes["id"].map { ($0, node) } })
    }
    private static func read(_ source: CompanionNode) throws -> Node {
        let a = source.attributes
        func number(_ key: String, _ fallback: Double = 0) -> Double { a[key].flatMap(Double.init) ?? fallback }
        var path: Path?
        switch source.type {
        case "path":
            var value = Path()
            for command in try CompanionVectorPath.parse(a["d"] ?? "") {
                switch command {
                case let .move(x,y): value.move(to: CGPoint(x:x,y:y))
                case let .line(x,y): value.addLine(to: CGPoint(x:x,y:y))
                case let .cubic(x1,y1,x2,y2,x,y): value.addCurve(to: CGPoint(x:x,y:y), control1: CGPoint(x:x1,y:y1), control2: CGPoint(x:x2,y:y2))
                case let .quad(x1,y1,x,y): value.addQuadCurve(to: CGPoint(x:x,y:y), control: CGPoint(x:x1,y:y1))
                case .close: value.closeSubpath()
                }
            }
            path = value
        case "ellipse", "circle":
            let rx = number("rx", number("r")), ry = number("ry", number("r"))
            path = Path(ellipseIn: CGRect(x: number("cx")-rx, y: number("cy")-ry, width: 2*rx, height: 2*ry))
        case "rect": path = Path(roundedRect: CGRect(x:number("x"), y:number("y"), width:number("width"), height:number("height")), cornerRadius:number("rx"))
        default: break
        }
        return Node(source: source, path: path, children: try source.children.map(Self.read))
    }
    func draw(context: GraphicsContext, frame: CompanionFrame, reduced: Bool) { draw(root, context: context, frame: frame, reduced: reduced) }
    private func draw(_ node: Node, context original: GraphicsContext, frame: CompanionFrame, reduced: Bool, happyParent: Bool = false) {
        let a = node.source.attributes, c = node.source.classes
        let happy = frame.happyAge != nil
        if c.contains("cp-eyes") && happy || c.contains("cp-happy") && !happy { return }
        var context = original
        if let transform = a["transform"] {
            if transform.hasPrefix("translate(") {
                let values: [Double] = transform.dropFirst(10).dropLast().split(separator: " ").compactMap { Double($0) }
                if let x = values.first { context.translateBy(x: x, y: values.count > 1 ? values[1] : 0) }
            } else if transform.hasPrefix("rotate("), let angle = Double(transform.dropFirst(7).dropLast()) { context.rotate(by: .degrees(angle)) }
        }
        if c.contains("cp-layer") { context.translateBy(x: frame.turn * (a["data-dx"].flatMap(Double.init) ?? 0), y: frame.nod * (a["data-dy"].flatMap(Double.init) ?? 0)) }
        let bounds = node.source.bounds ?? [0,0,0,0]
        let box = CGRect(x:bounds[0], y:bounds[1], width:bounds[2]-bounds[0], height:bounds[3]-bounds[1])
        let pose = CompanionMotion.pose(classes:c, elapsed:frame.elapsed, bobElapsed:frame.bobElapsed, happyAge:frame.happyAge, reduced:reduced)
        let pivot = CGPoint(x:box.minX + box.width * CGFloat(pose.anchorX), y:box.minY + box.height * CGFloat(pose.anchorY))
        context.translateBy(x:pivot.x, y:pivot.y + CGFloat(pose.y)); context.rotate(by:.degrees(pose.rotation)); context.scaleBy(x:pose.scaleX, y:pose.scaleY); context.translateBy(x:-pivot.x, y:-pivot.y)
        let happyPath = happyParent || c.contains("cp-happy")
        if let path = node.path {
            if a["clip-path"] != nil { context.clip(to:Path(ellipseIn:CGRect(x:43,y:75,width:114,height:104))) }
            if c.contains("cp-blush") || c.contains("cp-face-shade") { context.addFilter(.blur(radius:0.8)) }
            if c.contains("cp-chin-shadow") { context.addFilter(.blur(radius:3)) }
            if c.contains("cp-face-shade") || c.contains("cp-chin-shadow") { context.opacity *= 0.3 }
            else if c.contains("cp-fold") { context.opacity *= 0.45 }
            else if c.contains("cp-blush") { context.opacity *= frame.blush }
            if happyPath || !c.isDisjoint(with:["cp-fold","cp-rib","cp-finger"]) {
                let key = happyPath ? "--cp-eye" : c.contains("cp-fold") ? "--cp-fold" : c.contains("cp-rib") ? "--cp-rib" : "--cp-finger"
                let width = happyPath ? 4.0 : c.contains("cp-fold") ? 1.4 : c.contains("cp-rib") ? 1.0 : 1.2
                context.stroke(path, with:.color(color(key)), style:StrokeStyle(lineWidth:width,lineCap:.round))
            } else {
                let fill: String
                if c.contains("cp-sleeve--front") { fill = "url(#companion-sleeve-front)" }
                else if c.contains("cp-sleeve") { fill = "url(#companion-sleeve)" }
                else if c.contains("cp-hand") { fill = "url(#companion-hand)" }
                else if c.contains("cp-ribbon-tail") { fill = "--cp-ribbon" }
                else if c.contains("cp-face-shade") { fill = "--cp-hand-shade" }
                else if c.contains("cp-chin-shadow") { fill = "--cp-fold" }
                else { fill = a["fill"] ?? c.sorted().first(where: { asset.palette["--"+$0] != nil }).map { "--"+$0 } ?? "#000000" }
                if fill.hasPrefix("url(#"), let gradient = gradients[String(fill.dropFirst(5).dropLast())], box.width > 0, box.height > 0 {
                    let stops: [Gradient.Stop] = gradient.children.map { stop in
                        let location = Double((stop.attributes["offset"] ?? "0%").replacingOccurrences(of:"%",with:"")) ?? 0
                        return Gradient.Stop(color:color(stop.attributes["stop-color"] ?? "#000000"), location:location/100)
                    }
                    // SVG objectBoundingBox gradients scale both axes, including the radial face highlight.
                    context.translateBy(x:box.minX,y:box.minY); context.scaleBy(x:box.width,y:box.height)
                    let normalized = path.applying(CGAffineTransform(a:1/box.width,b:0,c:0,d:1/box.height,tx:-box.minX/box.width,ty:-box.minY/box.height))
                    let shading: GraphicsContext.Shading = gradient.type == "radialGradient" ? .radialGradient(Gradient(stops:stops),center:CGPoint(x:0.42,y:0.4),startRadius:0,endRadius:0.7) : .linearGradient(Gradient(stops:stops),startPoint:.zero,endPoint:CGPoint(x:0,y:1))
                    context.fill(normalized,with:shading)
                } else { context.fill(path,with:.color(color(fill))) }
            }
        }
        for child in node.children { draw(child,context:context,frame:frame,reduced:reduced,happyParent:happyPath) }
    }
    private func color(_ value: String) -> Color {
        let key = value.hasPrefix("var(") ? String(value.dropFirst(4).dropLast()) : value
        return Color(hex: asset.palette[key] ?? key)
    }
}
#endif
