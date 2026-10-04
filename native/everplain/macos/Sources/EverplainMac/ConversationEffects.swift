#if os(macOS)
import AppKit
import SwiftUI
import EverplainCore

/// Source-exact, single-use launch handoff: actual sends only, matching text, expires after 2s.
@MainActor enum SendFlightHandoff {
    struct Launch { let text: String; let origin: CGPoint; let at: Date }
    private static var launch: Launch?
    static func mark(text: String, origin: CGPoint) {
        launch = Launch(text: text.trimmingCharacters(in: .whitespacesAndNewlines), origin: origin, at: Date())
    }
    static func take(text: String) -> CGPoint? {
        defer { launch = nil }
        guard let launch, launch.text == text.trimmingCharacters(in: .whitespacesAndNewlines), Date().timeIntervalSince(launch.at) <= 2 else { return nil }
        return launch.origin
    }
    static func cancel() { launch = nil }
}

struct SendFlightBubble: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var flying = false
    let text: String
    let eligible: Bool
    var body: some View {
        UserMessageBubble(text: text)
            .opacity(flying ? 0 : 1)
            .background(BubbleFlightAnchor(text: text, eligible: eligible, dark: scheme == .dark,
                                           reduced: reducedMotion, flying: $flying))
            .accessibilityHidden(false)
    }
}
private struct UserMessageBubble: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    var backgroundOpacity = 1.0
    var body: some View {
        let lineGap = max(0, CGFloat(T.textBody * T.textBodyLineHeight) - NSLayoutManager().defaultLineHeight(for: TypeStyle.nativeUI(T.textBody)))
        Text(text).font(TypeStyle.ui(T.textBody)).lineSpacing(lineGap).padding(.vertical, lineGap / 2).textSelection(.enabled)
            .padding(.horizontal, T.space5).padding(.vertical, T.space3)
            .background(Palette(dark: scheme == .dark).strong.opacity(backgroundOpacity), in: RoundedRectangle(cornerRadius: T.radiusField))
    }
}
private struct FlightGhost: View {
    let text: String
    let progress: Double
    let dark: Bool
    let size: CGSize
    var body: some View {
        let stretch = ConversationMotion.flightStretch(progress)
        UserMessageBubble(text: text, backgroundOpacity: ConversationMotion.ease(min(1, progress / 0.4), [0.4, 0, 0.2, 1]))
            .frame(width: size.width, height: size.height)
            .scaleEffect(x: stretch.x, y: stretch.y)
            .padding(12).environment(\.colorScheme, dark ? .dark : .light).accessibilityHidden(true)
    }
}
private struct BubbleFlightAnchor: NSViewRepresentable {
    let text: String
    let eligible: Bool
    let dark: Bool
    let reduced: Bool
    @Binding var flying: Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSView {
        let view = FlightAnchorView()
        view.onReady = { [weak coordinator = context.coordinator, weak view] in
            if let view { coordinator?.attempt(view) }
        }
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.parent = self
        if reduced { context.coordinator.cancel(); return }
        context.coordinator.attempt(view)
    }
    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) { coordinator.cancel() }
    @MainActor final class Coordinator {
        var parent: BubbleFlightAnchor
        var attempted = false
        var timer: Timer?
        var panel: NSPanel?
        var observer: NSObjectProtocol?
        init(_ parent: BubbleFlightAnchor) { self.parent = parent }
        func attempt(_ view: NSView) {
        guard !attempted, view.window != nil else { return }
        attempted = true
        guard parent.eligible else { return }
        DispatchQueue.main.async { [weak view, weak coordinator = self] in
            guard let view, let window = view.window, let coordinator,
                  let origin = SendFlightHandoff.take(text: coordinator.parent.text), !coordinator.parent.reduced else { return }
            coordinator.start(window: window, target: window.convertToScreen(view.convert(view.bounds, to: nil)), from: origin)
        }
        }
        func start(window: NSWindow, target: CGRect, from: CGPoint) {
            guard target.width > 0, target.height > 0 else { return }
            let panel = NSPanel(contentRect: target.insetBy(dx: -12, dy: -12), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.backgroundColor = .clear; panel.isOpaque = false; panel.hasShadow = false; panel.ignoresMouseEvents = true
            panel.isReleasedWhenClosed = false; panel.setAccessibilityElement(false)
            let host = NSHostingView(rootView: FlightGhost(text: parent.text, progress: 0, dark: parent.dark, size: target.size))
            panel.contentView = host
            self.panel = panel
            window.addChildWindow(panel, ordered: .above)
            let dx = from.x - (target.minX + T.space5)
            let dy = from.y - (target.maxY - T.space3)
            let started = Date()
            parent.flying = true
            func frame(_ t: Double) {
                let progress = min(1, max(0, t / ConversationMotion.flightSeconds))
                let horizontal = progress >= 1 ? 1 : ConversationMotion.spring(t)
                let vertical = ConversationMotion.ease(min(1, progress / 0.62), [0.22, 1, 0.36, 1])
                panel.setFrameOrigin(CGPoint(x: target.minX - 12 + dx * (1 - horizontal), y: target.minY - 12 + dy * (1 - vertical)))
                host.rootView = FlightGhost(text: self.parent.text, progress: progress, dark: self.parent.dark, size: target.size)
            }
            frame(0); panel.orderFront(nil)
            timer = Timer.scheduledTimer(withTimeInterval: 1 / 60, repeats: true) { [weak self] _ in
                guard let self else { return }
                let elapsed = Date().timeIntervalSince(started)
                if elapsed >= ConversationMotion.flightSeconds || self.parent.reduced { self.cancel() } else { frame(elapsed) }
            }
            observer = NotificationCenter.default.addObserver(forName: NSWindow.didResizeNotification, object: window, queue: .main) { [weak self] _ in self?.cancel() }
        }
        func cancel() {
            timer?.invalidate(); timer = nil
            if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
            if let panel { panel.parent?.removeChildWindow(panel); panel.orderOut(nil); self.panel = nil }
            if parent.flying { DispatchQueue.main.async { [weak self] in self?.parent.flying = false } }
        }
    }
}
private final class FlightAnchorView: NSView {
    var onReady: (() -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); if window != nil { onReady?() } }
}

/// Real pending text only. Entry follows KineticCopyCycle; first token collapses over 420ms.
struct ConversationThinking: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    let active: Bool
    let text: String
    @State private var displayText = "正在思考"
    @State private var exiting = false
    @State private var exitStarted = Date()
    @State private var entered = Date()
    @State private var visible = false
    var body: some View {
        Group {
            if active || visible {
                TimelineView(.animation(minimumInterval: 1 / 30, paused: reducedMotion || !active)) { timeline in
                    let elapsed = max(0, timeline.date.timeIntervalSince(entered))
                    let message = displayText
                    let scalars = Array(message.unicodeScalars)
                    let enterDuration = 0.620 + min(Double(scalars.count) * 0.024, 0.340)
                    HStack(spacing: 0) {
                        ForEach(Array(scalars.enumerated()), id: \.offset) { part in
                            let delay = 0.1 + min(Double(part.offset) * 0.024, 0.340)
                            let enter = reducedMotion ? 1 : ConversationMotion.ease((elapsed - delay) / 0.520)
                            let exitDelay = min(Double(scalars.count - part.offset - 1) * 0.010, 0.140)
                            let exitTime = max(0, timeline.date.timeIntervalSince(exitStarted))
                            let leave = reducedMotion || !exiting ? 0 : ConversationMotion.ease((exitTime - exitDelay) / 0.300, [0.55, 0, 1, 0.45])
                            Text(String(part.element)).opacity(exiting ? 1 - leave : enter)
                                .offset(y: exiting ? -0.42 * T.textBody * leave : 0.42 * T.textBody * (1 - enter))
                                .blur(radius: reducedMotion ? 0 : 4 * (exiting ? leave : 1 - enter))
                        }
                    }
                    .font(TypeStyle.ui(T.textBody, weight: .medium)).tracking(-0.01 * T.textBody)
                    .foregroundStyle(Palette(dark: scheme == .dark).muted)
                    .overlay {
                        if !reducedMotion && !exiting && elapsed >= enterDuration {
                            GeometryReader { geometry in
                                let phase = (elapsed - enterDuration).truncatingRemainder(dividingBy: 1.333) / 1.333
                                LinearGradient(colors: [.clear, T.colorShine(dark: scheme == .dark).color, .clear], startPoint: .leading, endPoint: .trailing)
                                    .frame(width: geometry.size.width * 0.5)
                                    .offset(x: geometry.size.width * (-0.5 + 1.75 * phase))
                            }.mask(Text(message).font(TypeStyle.ui(T.textBody, weight: .medium)).tracking(-0.01 * T.textBody))
                        }
                    }
                    .padding(.top, 4).frame(height: 32, alignment: .topLeading)
                    .clipped()
                }
                .frame(height: active ? 32 : 0, alignment: .top)
                .opacity(active ? 1 : 0).clipped()
                .padding(.bottom, active ? 0 : -T.space4)
                .animation(reducedMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.420), value: active)
                .accessibilityElement(children: .ignore).accessibilityLabel(active ? text : displayText)
            }
        }
        .onAppear { if active { displayText = text; visible = true; entered = Date() } }
        .onChange(of: reducedMotion) { reduced in if reduced { displayText = text; exiting = false } }
        .task(id: text) {
            guard active, displayText != text else { return }
            if !reducedMotion {
                exiting = true; exitStarted = Date()
                try? await Task.sleep(nanoseconds: 460_000_000)
            }
            guard !Task.isCancelled, active else { return }
            displayText = text; entered = Date(); exiting = false
        }
        .task(id: active) {
            if active { visible = true; displayText = text; exiting = false; entered = Date(); return }
            if !reducedMotion { try? await Task.sleep(nanoseconds: 420_000_000) }
            guard !Task.isCancelled else { return }; visible = false
        }
    }
}
#endif
