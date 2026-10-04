#if os(macOS)
import SwiftUI
import AppKit

/// Anchored native surface with Web geometry; its content remains ordinary keyboard buttons.
struct WebActionMenu<Content: View, Trigger: View>: View {
    var width: Double = 220
    @ViewBuilder let content: () -> Content
    @ViewBuilder let label: () -> Trigger
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false
    @State private var anchor: NSView?
    @FocusState private var triggerFocused: Bool
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Button { withAnimation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.24)) { expanded.toggle() } } label: { label() }
            .buttonStyle(.plain).focused($triggerFocused)
            .background(NativeInteractionAnchor { anchor = $0 })
            .overlay(alignment: .topLeading) {
                if expanded {
                    VStack(alignment: .leading, spacing: T.space1) { content() }
                        .buttonStyle(WebMenuItemStyle()).font(TypeStyle.ui(T.textControl))
                        .padding(T.space2).frame(width: width, alignment: .leading)
                        .background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusPanel))
                        .overlay(RoundedRectangle(cornerRadius: T.radiusPanel).stroke(p.rule, lineWidth: 1))
                        .shadow(color: T.shadowPanel(dark: scheme == .dark).last!.color.color, radius: 20, y: 8)
                        .background(OutsideClickObserver(anchor: anchor) { close() })
                        .background(MenuKeyCompletion { close() })
                        .offset(y: T.controlHeight + T.space2)
                        .transition(.opacity.combined(with: .offset(y: 4)).combined(with: .scale(scale: 0.99, anchor: .topLeading)))
                        .simultaneousGesture(TapGesture().onEnded { close() })
                        .onExitCommand { close() }
                }
            }.zIndex(expanded ? 200 : 0)
    }
    private func close() { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.14)) { expanded = false }; triggerFocused = true }
}
private struct WebMenuItemStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, T.space3).frame(minHeight: T.iconControlSize)
            .foregroundStyle(configuration.role == .destructive ? p.danger : p.ink)
            .background(hovered || configuration.isPressed ? p.strong : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
            .opacity(enabled ? 1 : 0.45).contentShape(Rectangle()).onHover { hovered = $0 }
    }
}
private struct MenuKeyCompletion: NSViewRepresentable {
    let close: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(close) }
    func makeNSView(context: Context) -> NSView { let view = NSView(); context.coordinator.view = view; context.coordinator.install(); return view }
    func updateNSView(_ view: NSView, context: Context) { context.coordinator.close = close }
    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) { coordinator.remove() }
    final class Coordinator {
        weak var view: NSView?
        var close: () -> Void
        var monitor: Any?
        init(_ close: @escaping () -> Void) { self.close = close }
        func install() {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                if let self, event.window === self.view?.window, [36, 76].contains(event.keyCode) { DispatchQueue.main.async { [weak self] in self?.close() } }
                return event
            }
        }
        func remove() { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
        deinit { remove() }
    }
}
#endif
