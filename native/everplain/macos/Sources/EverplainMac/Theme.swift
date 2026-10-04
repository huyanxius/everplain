#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

typealias T = EverplainTokens
extension EverplainColor {
    var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
    var nsColor: NSColor { NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha) }
}
struct Palette {
    let dark: Bool
    var canvas: Color { T.colorCanvas(dark: dark).color }
    var surface: Color { T.colorSurface(dark: dark).color }
    var mutedSurface: Color { T.colorSurfaceMuted(dark: dark).color }
    var raised: Color { T.colorSurfaceRaised(dark: dark).color }
    var strong: Color { T.colorSurfaceStrong(dark: dark).color }
    var faint: Color { T.colorFaint(dark: dark).color }
    var ring: Color { T.shadowRing(dark: dark).first!.color.color }
    var ink: Color { T.colorInk(dark: dark).color }
    var muted: Color { T.colorMuted(dark: dark).color }
    var rule: Color { T.colorRule(dark: dark).color }
    var danger: Color { T.colorDanger(dark: dark).color }
    var accent: Color { T.colorAccent(dark: dark).color }
    var onAccent: Color { T.colorOnAccent(dark: dark).color }
}
enum TypeStyle {
    static func reading(_ size: Double) -> Font {
        for name in T.fontReading {
            if let font = NSFont(name: name, size: size) ?? NSFontManager.shared.font(withFamily: name, traits: [], weight: 5, size: size) { return Font(font) }
        }
        return .system(size: size, design: .serif)
    }
    static func nativeUI(_ size: Double) -> NSFont {
        for name in T.fontUi {
            if ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "sans-serif"].contains(name) { return .systemFont(ofSize: size) }
            if let font = NSFont(name: name, size: size) { return font }
        }
        return .systemFont(ofSize: size)
    }
    static func ui(_ size: Double, weight: Font.Weight = .regular) -> Font {
        Font(nativeUI(size)).weight(weight)
    }
}
struct EPButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium))
            .padding(.horizontal, T.space4).frame(minHeight: T.controlHeight)
            .foregroundStyle(primary ? p.onAccent : p.ink)
            .background(primary ? p.accent : p.surface, in: Capsule())
            .overlay(Capsule().stroke(primary ? Color.clear : p.ring, lineWidth: 1))
            .opacity(!enabled ? 0.42 : configuration.isPressed ? 0.72 : 1)
            .contentShape(Capsule())
    }
}
struct Card<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(T.space6).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(Palette(dark: scheme == .dark).rule, lineWidth: 1))
    }
}
struct InlineMessage: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    var isError = false
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Label(text, systemImage: isError ? "exclamationmark.circle" : "info.circle")
            .font(TypeStyle.ui(T.textMeta)).foregroundStyle(isError ? p.danger : p.muted)
            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            .padding(T.space3)
            .background(isError ? T.colorDangerSoft(dark: scheme == .dark).color : p.mutedSurface,
                        in: RoundedRectangle(cornerRadius: T.radiusItem))
    }
}
extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, opacity: 1)
    }
}
struct EPIconButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.frame(width: T.iconControlSize, height: T.iconControlSize)
            .foregroundStyle(primary ? p.onAccent : p.ink)
            .background(primary ? p.accent : Color.clear, in: Circle())
            .contentShape(Circle()).opacity(!enabled ? (primary ? 0.25 : 0.45) : configuration.isPressed ? 0.7 : 1)
    }
}
struct EPFieldStyle: TextFieldStyle {
    @Environment(\.colorScheme) private var scheme
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.textFieldStyle(.plain).font(TypeStyle.ui(T.textBody))
            .padding(.horizontal, T.space5).frame(minHeight: T.actionHeight)
            .background(Palette(dark: scheme == .dark).strong, in: Capsule())
    }
}
struct EPGhostButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium))
            .padding(.horizontal, T.space4).frame(minHeight: T.controlHeight)
            .foregroundStyle(Palette(dark: scheme == .dark).ink)
            .background(configuration.isPressed ? Palette(dark: scheme == .dark).strong : Color.clear, in: Capsule())
            .contentShape(Capsule()).opacity(enabled ? 1 : 0.45)
    }
}
#endif
