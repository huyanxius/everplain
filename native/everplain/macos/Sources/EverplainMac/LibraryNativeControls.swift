#if os(macOS)
import SwiftUI
import AppKit

/// qx-segmented from components.css; the reader uses the narrower source padding.
struct LibrarySegmentedControl: View {
    let label: String
    @Binding var selection: String
    let options: [(String, String)]
    var horizontalPadding: Double = T.space5
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: String?
    var body: some View {
        HStack(spacing: T.space1) {
            ForEach(options, id: \.0) { option in
                Button { choose(option.0) } label: { EPText(option.1).frame(maxWidth: .infinity).padding(.horizontal, horizontalPadding) }
                    .buttonStyle(LibrarySegmentButtonStyle(selected: selection == option.0))
                    .focused($focused, equals: option.0)
                    .accessibilityAddTraits(selection == option.0 ? .isSelected : [])
            }
        }.padding(T.space1).background(Palette(dark: scheme == .dark).strong, in: Capsule())
            .accessibilityElement(children: .contain).accessibilityLabel(label)
            .onMoveCommand { direction in
                guard let index = options.firstIndex(where: { $0.0 == focused }), !options.isEmpty else { return }
                if direction == .left { focusAndChoose(options[(index + options.count - 1) % options.count].0) }
                if direction == .right { focusAndChoose(options[(index + 1) % options.count].0) }
            }
            .background(LibraryControlKeyObserver { event in
                guard focused != nil, !event.modifierFlags.contains(.command), !event.modifierFlags.contains(.control) else { return false }
                if event.keyCode == 115, let first = options.first { focusAndChoose(first.0); return true }
                if event.keyCode == 119, let last = options.last { focusAndChoose(last.0); return true }
                return false
            })
    }
    private func choose(_ value: String) { if selection != value { selection = value } }
    private func focusAndChoose(_ value: String) { focused = value; choose(value) }
}
private struct LibrarySegmentButtonStyle: ButtonStyle {
    let selected: Bool
    @Environment(\.colorScheme) private var scheme
    @State private var hovered = false
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        let shadow = T.shadowCard(dark: scheme == .dark).last!
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium)).frame(minHeight: T.controlHeight - T.space2)
            .foregroundStyle(selected || hovered ? p.ink : p.muted)
            .background(selected ? p.surface : .clear, in: Capsule())
            .shadow(color: selected ? shadow.color.color : .clear, radius: shadow.blur / 2, x: shadow.x, y: shadow.y)
            .contentShape(Capsule()).opacity(configuration.isPressed ? 0.72 : 1).onHover { hovered = $0 }
    }
}
struct LibraryDownloadSystemButton: View {
    let system: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Button(action: action) {
            HStack(spacing: T.space2) {
                Text(system == "macos" ? "macOS" : "Windows")
                if system == "macos" { EPText("可能适合此设备").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
            }.font(TypeStyle.ui(T.textControl, weight: .medium)).frame(minWidth: 140, maxWidth: .infinity, minHeight: T.controlHeight)
                .padding(.horizontal, T.space4).background(selected ? p.strong : p.surface, in: Capsule())
                .overlay(Capsule().stroke(p.ring, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Multiple mode of the Web Select: clicking toggles evidence without closing;
/// values retain source-option order, with Escape/outside/Tab closing the menu.
struct LibraryEvidenceSelect: View {
    let label: String
    @Binding var selection: [String]
    let options: [(String, String)]
    var onExpansionChange: (Bool) -> Void = { _ in }
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @State private var expanded = false
    @State private var activeId: String?
    @State private var anchor: NSView?
    @State private var typeahead = ""
    @State private var typeaheadAt = Date.distantPast
    @FocusState private var triggerFocused: Bool
    private var selectedLabel: String { options.filter { selection.contains($0.0) }.map(\.1).joined(separator: "、") }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Button { if expanded { close() } else { open() } } label: {
            HStack(spacing: T.space2) { if selectedLabel.isEmpty { EPText("请选择").lineLimit(1) } else { Text(selectedLabel).lineLimit(1) }; Spacer(minLength: T.space2); WebIcon(name: .caretDown, size: 16).foregroundStyle(p.muted) }
                .font(TypeStyle.ui(T.textControl)).padding(.horizontal, T.space4).frame(minHeight: T.controlHeight)
        }.buttonStyle(WebRowStyle()).background(p.strong, in: Capsule()).focused($triggerFocused)
            .accessibilityLabel(label).accessibilityValue(selectedLabel.isEmpty ? epLocalized("请选择") : selectedLabel)
            .background(LibraryEvidenceAnchor { anchor = $0 })
            .overlay(alignment: .topLeading) {
                if expanded && enabled {
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(spacing: T.space1) {
                                ForEach(options, id: \.0) { option in
                                    Button { choose(option.0) } label: {
                                        HStack(spacing: T.space3) { Text(option.1).multilineTextAlignment(.leading); Spacer(minLength: 0); WebIcon(name: .check, size: 16).opacity(selection.contains(option.0) ? 1 : 0) }
                                            .font(TypeStyle.ui(T.textControl, weight: selection.contains(option.0) ? .medium : .regular))
                                            .frame(maxWidth: .infinity, minHeight: T.controlHeight, alignment: .leading)
                                            .padding(.horizontal, T.space3).padding(.vertical, T.space2)
                                            .background(activeId == option.0 ? p.strong : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
                                    }.buttonStyle(.plain).focusable(false).onHover { if $0 { activeId = option.0 } }.id(option.0)
                                        .accessibilityAddTraits(selection.contains(option.0) ? .isSelected : [])
                                }
                            }
                        }.frame(minWidth: 240, maxHeight: min(320, Double(max(1, options.count)) * (T.controlHeight + T.space4)))
                            .onChange(of: activeId) { id in if let id { proxy.scrollTo(id) } }
                    }.padding(T.space2).background(p.raised, in: RoundedRectangle(cornerRadius: T.radiusCard))
                        .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(p.rule, lineWidth: 1))
                        .shadow(color: T.shadowMenu(dark: scheme == .dark).last!.color.color, radius: 16, y: 12)
                        .background(OutsideClickObserver(anchor: anchor) { close(restoreFocus: false) })
                        .offset(y: T.controlHeight + T.space2)
                }
            }.zIndex(expanded ? 100 : 0)
            .background(LibraryControlKeyObserver { handle($0) })
            .onChange(of: enabled) { if !$0 { close(restoreFocus: false) } }
            .onChange(of: triggerFocused) { if !$0 && expanded { close(restoreFocus: false) } }
            .onDisappear { onExpansionChange(false) }
    }
    private func open(last: Bool = false) {
        guard enabled else { return }
        activeId = options.first { selection.contains($0.0) }?.0 ?? (last ? options.last?.0 : options.first?.0)
        expanded = true; triggerFocused = true; onExpansionChange(true)
    }
    private func close(restoreFocus: Bool = true) { expanded = false; typeahead = ""; onExpansionChange(false); if restoreFocus { triggerFocused = true } }
    private func choose(_ id: String) {
        var values = Set(selection)
        if values.contains(id) { values.remove(id) } else { values.insert(id) }
        selection = options.map(\.0).filter { values.contains($0) }
        activeId = id; triggerFocused = true
    }
    private func handle(_ event: NSEvent) -> Bool {
        guard triggerFocused, enabled, !event.modifierFlags.contains(.command), !event.modifierFlags.contains(.control) else { return false }
        if event.keyCode == 48 { close(restoreFocus: false); return false }
        if event.keyCode == 53 && expanded { close(); return true }
        if [125, 126, 115, 119].contains(event.keyCode) {
            if !expanded { open(last: event.keyCode == 126 || event.keyCode == 119) }
            else if let index = options.firstIndex(where: { $0.0 == activeId }), !options.isEmpty {
                if event.keyCode == 125 { activeId = options[(index + 1) % options.count].0 }
                if event.keyCode == 126 { activeId = options[(index + options.count - 1) % options.count].0 }
            }
            if event.keyCode == 115 { activeId = options.first?.0 }
            if event.keyCode == 119 { activeId = options.last?.0 }
            return true
        }
        let recent = Date().timeIntervalSince(typeaheadAt) < 0.7
        if [36, 76].contains(event.keyCode) || (event.keyCode == 49 && (!recent || typeahead.isEmpty)) {
            if expanded, let id = activeId { choose(id) } else { open() }
            return true
        }
        guard !event.modifierFlags.contains(.option), let character = event.charactersIgnoringModifiers, character.count == 1, character.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return false }
        typeahead = (recent ? typeahead : "") + character.lowercased(); typeaheadAt = Date()
        let repeated = Set(typeahead).count == 1
        let needle = repeated ? String(typeahead.prefix(1)) : typeahead
        let start = repeated ? options.firstIndex(where: { $0.0 == activeId }) ?? -1 : -1
        guard !options.isEmpty else { return true }
        for offset in 1...options.count {
            let option = options[(start + offset) % options.count]
            if option.1.lowercased().hasPrefix(needle) { if !expanded { open() }; activeId = option.0; break }
        }
        return true
    }
}
private struct LibraryEvidenceAnchor: NSViewRepresentable {
    let capture: (NSView) -> Void
    func makeNSView(context: Context) -> NSView { let view = NSView(); DispatchQueue.main.async { capture(view) }; return view }
    func updateNSView(_ view: NSView, context: Context) {}
}
private struct LibraryControlKeyObserver: NSViewRepresentable {
    let handle: (NSEvent) -> Bool
    func makeCoordinator() -> Coordinator { Coordinator(handle) }
    func makeNSView(context: Context) -> NSView { let view = NSView(); context.coordinator.view = view; context.coordinator.install(); return view }
    func updateNSView(_ view: NSView, context: Context) { context.coordinator.handle = handle }
    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) { coordinator.remove() }
    final class Coordinator {
        weak var view: NSView?
        var handle: (NSEvent) -> Bool
        var monitor: Any?
        init(_ handle: @escaping (NSEvent) -> Bool) { self.handle = handle }
        func install() { monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in guard let self, event.window === self.view?.window else { return event }; return self.handle(event) ? nil : event } }
        func remove() { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
        deinit { remove() }
    }
}
#endif
