#if os(macOS)
import SwiftUI
import AppKit

struct WebSelect: View {
    let label: String
    @Binding var selection: String
    let options: [(String, String)]
    var disabledOptions: Set<String> = []
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var expanded = false
    @State private var width: CGFloat = 180
    @FocusState private var triggerFocused: Bool
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Button { expanded.toggle() } label: {
            HStack(spacing: T.space2) { Text(options.first(where: { $0.0 == selection })?.1 ?? selection).lineLimit(1); Spacer(minLength: T.space2); WebIcon(name: .caretDown, size: 14) }
                .padding(.horizontal, T.space4).frame(minHeight: T.controlHeight)
        }.buttonStyle(WebRowStyle()).background(p.strong, in: Capsule()).accessibilityLabel(epLocalized(label)).focused($triggerFocused)
            .background(GeometryReader { proxy in Color.clear.onAppear { width = proxy.size.width }.onChange(of: proxy.size.width) { width = $0 } })
            .background(NativeAnchoredPopover(isPresented: $expanded,
                content: AnyView(WebSelectOptions(selection: $selection, options: options, disabledOptions: disabledOptions, close: { expanded = false; triggerFocused = true })),
                width: max(150, width), maxHeight: min(336, CGFloat(max(1, options.count)) * (T.controlHeight + 2) + T.space4),
                label: epLocalized(label), dark: scheme == .dark, reducedMotion: reducedMotion, onEscape: { triggerFocused = true }))
    }
}
private struct WebSelectOptions: View {
    @Binding var selection: String
    let options: [(String, String)]
    let disabledOptions: Set<String>
    let close: () -> Void
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focusedOption: String?
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        ScrollView {
            VStack(spacing: 2) {
                ForEach(options, id: \.0) { option in
                    Button { selection = option.0; close() } label: {
                        HStack { Text(option.1); Spacer(); if option.0 == selection { WebIcon(name: .check, size: 16) } }
                            .padding(.horizontal, T.space3).frame(minHeight: T.controlHeight)
                    }.buttonStyle(WebRowStyle()).focused($focusedOption, equals: option.0).disabled(disabledOptions.contains(option.0))
                }
            }
        }.frame(height: min(320, CGFloat(max(1, options.count)) * (T.controlHeight + 2)))
            .padding(T.space2).font(TypeStyle.ui(T.textControl))
            .background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusPanel))
            .overlay(RoundedRectangle(cornerRadius: T.radiusPanel).stroke(p.rule, lineWidth: 1))
            .onAppear { focusedOption = options.contains(where: { $0.0 == selection }) ? selection : options.first?.0 }
            .onExitCommand { close() }
            .onMoveCommand { direction in
                guard let index = options.firstIndex(where: { $0.0 == focusedOption }), !options.isEmpty else { return }
                let increment = direction == .down ? 1 : direction == .up ? -1 : 0
                guard increment != 0 else { return }
                for distance in 1...options.count {
                    let next = options[(index + increment * distance + options.count) % options.count].0
                    if !disabledOptions.contains(next) { focusedOption = next; break }
                }
            }
    }
}
struct WebSegments: View {
    let label: String
    @Binding var selection: String
    let options: [(String, String)]
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        HStack(spacing: T.space1) {
            ForEach(options, id: \.0) { option in
                Button { selection = option.0 } label: { EPText(option.1) }.buttonStyle(WebSegmentStyle(selected: selection == option.0))
            }
        }.padding(T.space1).background(Palette(dark: scheme == .dark).mutedSurface, in: Capsule()).accessibilityLabel(epLocalized(label))
    }
}
struct WebToggle: View {
    let label: String
    let value: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Button(action: action) {
            HStack { if value { Spacer(minLength: 0) }; Circle().fill(value ? p.onAccent : p.muted).frame(width: 20, height: 20); if !value { Spacer(minLength: 0) } }
                .padding(4).frame(width: 44, height: T.controlHeight).background(value ? p.accent : p.strong, in: Capsule())
        }.buttonStyle(.plain).accessibilityLabel(label).accessibilityValue(value ? "开启" : "关闭")
    }
}
#endif
