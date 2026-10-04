#if os(macOS)
import AppKit
import SwiftUI

struct NativeModelPopover: View {
    @Binding var isPresented: Bool
    let store: AppStore
    let disabled: Bool
    let dark: Bool
    let reducedMotion: Bool
    var onEscape: () -> Void = {}
    var body: some View {
        NativeAnchoredPopover(isPresented: $isPresented, content: AnyView(ModelSelectionPanel(disabled: disabled).environmentObject(store)),
                              dark: dark, reducedMotion: reducedMotion, onEscape: onEscape)
    }
}

/// A borderless, anchored native panel. No NSMenu/NSPopover chrome or nested submenus.
struct NativeAnchoredPopover: NSViewRepresentable {
    @Binding var isPresented: Bool
    let content: AnyView
    var width: CGFloat = 300
    var maxHeight: CGFloat = 400
    var label = "选择模型与思考强度"
    let dark: Bool
    let reducedMotion: Bool
    var onEscape: () -> Void = {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }
    func updateNSView(_ anchor: NSView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.anchor = anchor
        if isPresented { context.coordinator.show() } else { context.coordinator.close(animated: true) }
    }
    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) { coordinator.close(animated: false) }
    @MainActor final class Coordinator: NSObject {
        var parent: NativeAnchoredPopover
        weak var anchor: NSView?
        weak var previousResponder: NSResponder?
        var panel: ModelPanel?
        var host: NSHostingView<AnyView>?
        var clickMonitor: Any?
        var keyMonitor: Any?
        var observers: [NSObjectProtocol] = []
        var presence = PopoverPresence()
        var closing = false
        var generation = UUID()
        init(_ parent: NativeAnchoredPopover) { self.parent = parent }
        func show() {
            guard let anchor, let window = anchor.window else { return }
            if closing { close(animated: false) }
            let content = AnyView(PopoverMotionContent(content: parent.content, presence: presence, reduced: parent.reducedMotion)
                .environment(\.colorScheme, parent.dark ? .dark : .light))
            if let host { host.rootView = content; position(); return }
            let panel = ModelPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.isFloatingPanel = true; panel.hidesOnDeactivate = true
            panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
            panel.isReleasedWhenClosed = false; panel.level = .popUpMenu
            panel.setAccessibilityLabel(parent.label)
            let host = NSHostingView(rootView: content)
            panel.contentView = host
            self.panel = panel; self.host = host
            previousResponder = window.firstResponder
            window.addChildWindow(panel, ordered: .above)
            position()
            panel.makeKeyAndOrderFront(nil)
            DispatchQueue.main.async { [weak self] in guard let self, !self.closing else { return }; self.presence.visible = true }
            clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
                guard let self, let panel = self.panel else { return event }
                if event.window !== panel {
                    // The trigger's Button owns toggling its panel; don't close then reopen it.
                    if let anchor = self.anchor, event.window === anchor.window,
                       anchor.bounds.contains(anchor.convert(event.locationInWindow, from: nil)) { return event }
                    self.dismiss(restoreFocus: false)
                }
                return event
            }
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, event.window === self.panel else { return event }
                if event.keyCode == 53 { self.dismiss(restoreFocus: true); return nil }
                return event
            }
            let center = NotificationCenter.default
            for name in [NSWindow.didResizeNotification, NSWindow.didMoveNotification] {
                observers.append(center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in self?.position() })
            }
            observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.dismiss(restoreFocus: false) })
        }
        func position() {
            guard let anchor, let window = anchor.window, let panel, let host else { return }
            let frame = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
            let boundary = window.convertToScreen(window.contentView?.bounds ?? window.frame).insetBy(dx: 12, dy: 12)
            let width = min(parent.width, max(120, boundary.width))
            host.frame.size.width = width
            let above = max(0, boundary.maxY - frame.maxY - 8), below = max(0, frame.minY - boundary.minY - 8)
            let upwards = above > below
            let height = min(parent.maxHeight, max(64, upwards ? above : below), host.fittingSize.height)
            let x = min(max(boundary.minX, frame.maxX - width), boundary.maxX - width)
            let y = upwards ? frame.maxY + 8 : frame.minY - 8 - height
            panel.setFrame(CGRect(x: x, y: max(boundary.minY, y), width: width, height: height), display: true)
        }
        func dismiss(restoreFocus: Bool) {
            if restoreFocus, let window = anchor?.window { window.makeKey(); window.makeFirstResponder(previousResponder) }
            parent.isPresented = false
            close(animated: true)
            if restoreFocus { DispatchQueue.main.async { [weak self] in self?.parent.onEscape() } }
        }
        func close(animated: Bool) {
            if animated && closing { return }
            if let clickMonitor { NSEvent.removeMonitor(clickMonitor); self.clickMonitor = nil }
            if let keyMonitor { NSEvent.removeMonitor(keyMonitor); self.keyMonitor = nil }
            for observer in observers { NotificationCenter.default.removeObserver(observer) }
            observers.removeAll()
            if animated && !parent.reducedMotion && panel != nil {
                closing = true; presence.visible = false; panel?.ignoresMouseEvents = true
                generation = UUID(); let token = generation
                DispatchQueue.main.asyncAfter(deadline: .now() + T.motionFast / 1000) { [weak self] in
                    guard let self, self.generation == token else { return }; self.close(animated: false)
                }
                return
            }
            generation = UUID(); closing = false
            if let panel { panel.parent?.removeChildWindow(panel); panel.orderOut(nil) }
            panel = nil; host = nil; presence = PopoverPresence()
        }
    }
}
final class PopoverPresence: ObservableObject { @Published var visible = false }
private struct PopoverMotionContent: View {
    let content: AnyView
    @ObservedObject var presence: PopoverPresence
    let reduced: Bool
    var body: some View {
        content.opacity(reduced || presence.visible ? 1 : 0)
            .scaleEffect(reduced || presence.visible ? 1 : 0.99)
            .offset(y: reduced || presence.visible ? 0 : 4)
            .animation(reduced ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: (presence.visible ? T.motionBase : T.motionFast) / 1000), value: presence.visible)
    }
}
final class ModelPanel: NSPanel { override var canBecomeKey: Bool { true } }

private struct ModelSelectionPanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let disabled: Bool
    @FocusState private var focusedModel: String?
    private var displayedModelId: String { disabled ? store.pending?.request.modelId ?? store.modelId : store.modelId }
    private var displayedEffort: String { disabled ? store.pending?.request.reasoningEffort ?? store.effort : store.effort }
    private var usingServerDefault: Bool { disabled && store.pending != nil && store.pending?.request.modelId == nil }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !usingServerDefault, let model = store.catalog?.items.first(where: { $0.modelId == displayedModelId }), let catalog = store.catalog {
                    EPText("模型").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(.horizontal, 8).padding(.vertical, 4)
                    VStack(spacing: 2) {
                        ForEach(catalog.items, id: \.modelId) { item in
                            ModelOption(label: item.label, selected: displayedModelId == item.modelId) { choose(item.modelId) }
                                .disabled(disabled).focused($focusedModel, equals: item.modelId)
                                .onMoveCommand { direction in move(from: item.modelId, direction: direction) }
                        }
                    }
                    .background(NativeControlKeys(active: focusedModel != nil) { key in
                        guard !disabled, let items = store.catalog?.items, !items.isEmpty else { return false }
                        guard key == 115 || key == 119 else { return false }
                        let id = key == 115 ? items[0].modelId : items[items.count - 1].modelId
                        choose(id); focusedModel = id; return true
                    })
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            EPText("思考强度").foregroundStyle(p.muted)
                            Spacer()
                            Text(Composer.effortName(displayedEffort)).fontWeight(.semibold)
                        }.font(TypeStyle.ui(T.textMeta))
                        ModelEffortSlider(steps: model.reasoningEfforts, selection: Binding(get: { displayedEffort }, set: { if !disabled { store.effort = $0 } }),
                                          disabled: disabled || model.reasoningEfforts.count < 2)
                            .id(model.modelId)
                        EPText("越高想得越久，适合需要推理的问题")
                            .font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.faint).padding(.top, 10)
                    }.padding(.horizontal, 8).padding(.top, 10).padding(.bottom, 4)
                        .overlay(alignment: .top) { Rectangle().fill(p.rule).frame(height: 1) }.padding(.top, 6)
                    if catalog.runtimeMode == "mock" { EPText("当前是隔离测试模型。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(8) }
                    if disabled { EPText("当前回合进行中，结束后可调整。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(8) }
                } else {
                    Text(usingServerDefault ? "本轮沿用服务端默认设置，结束后可调整。" : store.modelCatalogStatus == "loading" ? "正在读取可用模型；本轮仍可使用服务端默认设置。" : store.modelCatalogStatus == "error" ? "模型设置暂时无法读取，本轮使用服务端默认设置。" : disabled ? "恢复中的回合沿用原模型和强度，当前不可修改。" : "模型选择尚未启用，本轮使用服务端默认设置。")
                        .font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(8)
                    if store.modelCatalogStatus == "error" { EPButton("重新读取模型") { Task { await store.refreshModels() } }.buttonStyle(EPGhostButtonStyle()).disabled(disabled) }
                }
            }.padding(8)
        }.frame(width: 300).fixedSize(horizontal: false, vertical: true)
            .background(p.raised, in: RoundedRectangle(cornerRadius: T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(p.ring, lineWidth: 1))
            .onAppear { focusedModel = displayedModelId }
    }
    private func choose(_ id: String) { guard !disabled else { return }; store.modelId = id; store.modelChanged() }
    private func move(from id: String, direction: MoveCommandDirection) {
        guard !disabled, let items = store.catalog?.items, let index = items.firstIndex(where: { $0.modelId == id }), items.count > 1 else { return }
        let delta: Int
        switch direction { case .down, .right: delta = 1; case .up, .left: delta = -1; default: return }
        let next = items[(index + delta + items.count) % items.count].modelId
        choose(next); focusedModel = next
    }
}
private struct ModelOption: View {
    @Environment(\.colorScheme) private var scheme
    @State private var hover = false
    let label: String
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(label).font(TypeStyle.ui(T.textControl, weight: .semibold))
                Spacer(minLength: 12)
                if selected { WebIcon(name: .check, size: 16) }
            }.foregroundStyle(Palette(dark: scheme == .dark).ink).padding(8)
                .background(hover ? Palette(dark: scheme == .dark).strong : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
                .contentShape(RoundedRectangle(cornerRadius: T.radiusItem))
        }.buttonStyle(.plain).onHover { hover = $0 }
            .accessibilityLabel(label).accessibilityValue(selected ? "已选择" : "未选择")
    }
}

private struct ModelEffortSlider: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    let steps: [String]
    @Binding var selection: String
    let disabled: Bool
    @State private var dragRatio: Double?
    @State private var hover = false
    @FocusState private var focused: Bool
    private var lastStep: Int { max(0, steps.count - 1) }
    private var index: Int { max(0, steps.firstIndex(of: selection) ?? 0) }
    private var ratio: Double { dragRatio ?? (lastStep > 0 ? Double(index) / Double(lastStep) : 0) }
    private var previewIndex: Int { min(lastStep, max(0, Int((ratio * Double(lastStep)).rounded()))) }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        GeometryReader { geometry in
            let trackWidth = max(1, geometry.size.width - 20)
            VStack(spacing: 6) {
                ZStack(alignment: .leading) {
                    Capsule().fill(p.strong).frame(height: 6)
                    Capsule().fill(p.ink).frame(width: trackWidth * ratio, height: 6)
                    ForEach(Array(steps.enumerated()), id: \.offset) { item in
                        Circle().fill(item.offset <= previewIndex ? p.surface : p.faint).frame(width: 4, height: 4)
                            .offset(x: lastStep > 0 ? trackWidth * Double(item.offset) / Double(lastStep) - 2 : -2)
                    }
                    Circle().fill(p.surface).frame(width: 22, height: 22)
                        .overlay(Circle().stroke(focused ? p.ink : p.rule, lineWidth: 1))
                        .shadow(color: p.ink.opacity(0.14), radius: dragRatio == nil ? 3 : 9, y: 3)
                        .scaleEffect(dragRatio != nil ? 1.22 : hover ? 1.08 : 1)
                        .overlay(alignment: .top) {
                            if (hover || focused || dragRatio != nil) && !disabled && !steps.isEmpty {
                                Text(Composer.effortName(steps[previewIndex])).font(TypeStyle.ui(T.textMeta, weight: .semibold))
                                    .foregroundStyle(p.onAccent).padding(.horizontal, 9).padding(.vertical, 3)
                                    .background(p.ink, in: Capsule()).fixedSize().offset(y: -30)
                            }
                        }.offset(x: trackWidth * ratio - 11)
                }.frame(height: 24).contentShape(Rectangle())
                    .focusable(!disabled).focused($focused)
                    .onHover { hover = $0 }
                    .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                        guard !disabled else { return }; focused = true
                        dragRatio = min(1, max(0, value.location.x / trackWidth))
                    }.onEnded { value in
                        guard !disabled else { dragRatio = nil; return }
                        choose(Int((min(1, max(0, value.location.x / trackWidth)) * Double(lastStep)).rounded())); dragRatio = nil
                    })
                    .onMoveCommand { direction in
                        switch direction { case .left, .down: choose(index - 1); case .right, .up: choose(index + 1); default: break }
                    }
                    .background(NativeControlKeys(active: focused) { key in
                        guard key == 115 || key == 119, !disabled else { return false }
                        choose(key == 115 ? 0 : lastStep); return true
                    })
                    .accessibilityElement(children: .ignore).accessibilityLabel("思考强度")
                    .accessibilityValue(Composer.effortName(selection))
                    .accessibilityAdjustableAction { direction in choose(index + (direction == .increment ? 1 : -1)) }
                ZStack(alignment: .topLeading) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { item in
                        Button(Composer.effortName(item.element)) { choose(item.offset) }
                            .buttonStyle(.plain).font(TypeStyle.ui(T.textMeta, weight: item.offset == previewIndex ? .semibold : .regular))
                            .foregroundStyle(item.offset == previewIndex ? p.ink : p.faint)
                            .frame(width: 40).offset(x: labelOffset(item.offset, width: trackWidth))
                            .disabled(disabled)
                    }
                }.frame(height: 22)
            }.padding(.horizontal, 10).padding(.top, 34)
                .animation(reducedMotion || dragRatio != nil ? nil : .interpolatingSpring(stiffness: 180, damping: 18), value: ratio)
        }.frame(height: 86).opacity(disabled ? 0.5 : 1)
    }
    private func choose(_ index: Int) { guard !disabled, !steps.isEmpty else { return }; selection = steps[min(lastStep, max(0, index))] }
    private func labelOffset(_ index: Int, width: CGFloat) -> CGFloat {
        if index == 0 { return -20 }
        if index == lastStep { return width - 20 }
        return width * Double(index) / Double(lastStep) - 20
    }
}

/// Adds Home/End to SwiftUI's directional and accessibility slider/radio support on macOS 13.
private struct NativeControlKeys: NSViewRepresentable {
    let active: Bool
    let action: (UInt16) -> Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.view = view
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak coordinator = context.coordinator] event in
            guard let coordinator, coordinator.parent.active, event.window === coordinator.view?.window else { return event }
            return coordinator.parent.action(event.keyCode) ? nil : event
        }
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) { context.coordinator.parent = self }
    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) { if let monitor = coordinator.monitor { NSEvent.removeMonitor(monitor) } }
    final class Coordinator {
        var parent: NativeControlKeys
        weak var view: NSView?
        var monitor: Any?
        init(_ parent: NativeControlKeys) { self.parent = parent }
    }
}
#endif
