#if os(macOS)
import AppKit
import SwiftUI
import EverplainCore

/// Markdown stays native/selectable. Reveal ages follow UTF-16 source offsets, not view lifetime,
/// so closing emphasis/link delimiters cannot restart the color of already displayed characters.
struct NativeMarkdown: View {
    let content: String
    var revealedAt: [Double] = []
    var now = 0.0
    var agentColor = "#e55f6f"
    var citations: [AgentCitationResponse] = []
    var onSelectCitation: (AgentCitationResponse) -> Void = { _ in }
    @Environment(\.colorScheme) private var scheme
    private typealias Block = NativeMarkdownBlock
    @State private var parsed: [Block] = []
    private func sourceOffset(_ block: Block, _ local: Int) -> Int {
        block.sourceOffsets.indices.contains(local) ? block.sourceOffsets[local] : block.offset + local
    }
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            ForEach(parsed) { block in
                HStack(alignment: .top, spacing: T.space2) {
                    if block.quoteDepth > 0 { Rectangle().fill(Palette(dark: scheme == .dark).rule).frame(width: 3) }
                    if let marker = block.marker { Text(marker).font(TypeStyle.reading(T.textReading)).frame(minWidth: T.space5, alignment: .trailing) }
                    blockBody(block)
                }.padding(.leading, Double(block.indent + max(0, block.quoteDepth - 1)) * T.space6)
            }
        }
        .onAppear { parsed = NativeMarkdownLayout.parse(content) }
        .onChange(of: content) { parsed = NativeMarkdownLayout.parse($0) }
        .environment(\.openURL, OpenURLAction { url in
            guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.user == nil, url.password == nil else { return .discarded }
            return .systemAction
        })
    }
    @ViewBuilder private func blockBody(_ block: Block) -> some View {
        let p = Palette(dark: scheme == .dark)
        switch block.kind {
        case "code":
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(block.language ?? "").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                    Spacer()
                    Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(block.text, forType: .string) } label: { WebIcon(name: .copy, size: 16) }
                        .buttonStyle(EPIconButtonStyle()).accessibilityLabel(epLocalized("复制"))
                }.padding(.horizontal, T.space3)
                ScrollView(.horizontal) {
                    Text(attributed(block, markdown: false)).font(.system(size: T.textReading * 0.85, design: .monospaced))
                        .textSelection(.enabled).padding(T.space4)
                }
            }.background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
        case "rule": Rectangle().fill(p.rule).frame(height: 1).padding(.vertical, T.space2)
        case "table":
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(Array(block.rows.enumerated()), id: \.offset) { row in
                        GridRow(alignment: .top) {
                            ForEach(Array(row.element.enumerated()), id: \.offset) { entry in
                                let cell = tableCell(entry.element, header: row.offset == 0)
                                NativeCitationParagraph(text: richAttributed(cell), onCitation: selectCitation)
                                    .frame(width: 220).padding(T.space3)
                                    .background(row.offset == 0 ? p.mutedSurface : .clear)
                                    .overlay(alignment: .bottom) { Rectangle().fill(p.rule).frame(height: 1) }
                            }
                        }
                    }
                }
            }
        case "image":
            if let source = block.imageSource, let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil {
                VStack(alignment: .leading, spacing: T.space2) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFit() }
                        else { Text(block.text).foregroundStyle(p.muted) }
                    }.frame(maxWidth: .infinity, maxHeight: 480, alignment: .leading)
                    if !block.text.isEmpty { Text(block.text).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
                }
            } else { Text(block.text).foregroundStyle(p.muted) }
        default: NativeCitationParagraph(text: richAttributed(block), onCitation: selectCitation)
        }
    }
    private func selectCitation(_ index: Int) { if citations.indices.contains(index) { onSelectCitation(citations[index]) } }
    private func tableCell(_ cell: NativeMarkdownCell, header: Bool) -> Block {
        var result = Block(id: 0, kind: header ? "heading" : "body", text: cell.text, sourceOffsets: cell.sourceOffsets)
        result.heading = header ? 3 : 0; result.alignment = cell.alignment
        return result
    }
    private func attributed(_ block: Block, markdown: Bool) -> AttributedString {
        let prepared = markdown ? ConversationCitations.prepare(block.text, citations: citations) : ConversationCitations.Prepared(text: block.text, sourceOffsets: Array(0..<block.text.utf16.count), citationAtOffset: [:])
        var text = markdown ? ((try? AttributedString(markdown: prepared.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(prepared.text)) : AttributedString(prepared.text)
        let raw = prepared.text as NSString
        var sourceCursor = 0
        var index = text.startIndex
        let ink = T.colorInk(dark: scheme == .dark)
        let base = OklabColorMix.rgb(hex: agentColor)
        let light = scheme == .dark ? OklabColorMix.mix(base, [1, 1, 1], amount: 0.28) : base
        while index < text.endIndex {
            let next = text.characters.index(after: index)
            let glyph = String(text.characters[index..<next])
            let range = raw.range(of: glyph, options: .literal, range: NSRange(location: min(sourceCursor, raw.length), length: max(0, raw.length - sourceCursor)))
            if range.location != NSNotFound {
                let sourceOffset = prepared.sourceOffsets.indices.contains(range.location) ? prepared.sourceOffsets[range.location] : range.location
                let offset = self.sourceOffset(block, sourceOffset)
                sourceCursor = range.location + range.length
                if let citationIndex = prepared.citationAtOffset[range.location] {
                    text[index..<next].link = URL(string: "everplain-source://\(citationIndex)")
                }
                if offset >= 0 && offset < revealedAt.count {
                    let age = max(0, now - revealedAt[offset])
                    if age < ConversationMotion.lightSeconds {
                        let phase = ConversationMotion.ease(age / ConversationMotion.lightSeconds, [0.25, 0.6, 0.25, 1])
                        let amount = phase < 0.08 ? 0 : phase < 0.45 ? (phase - 0.08) / 0.37 * 0.55 : 0.55 + (phase - 0.45) / 0.55 * 0.45
                        let rgb = OklabColorMix.mix(light, [ink.red, ink.green, ink.blue], amount: amount)
                        text[index..<next].foregroundColor = Color(.sRGB, red: rgb[0], green: rgb[1], blue: rgb[2], opacity: min(1, phase / 0.08))
                    }
                }
            }
            index = next
        }
        return text
    }
    private func richAttributed(_ block: Block) -> NSAttributedString {
        let styled = attributed(block, markdown: true)
        let native = NSMutableAttributedString(attributedString: NSAttributedString(styled))
        let size = block.heading == 1 ? T.textSection : block.heading == 2 ? T.textTitle : T.textReading
        var base = NSFont(descriptor: NSFont.systemFont(ofSize: size).fontDescriptor.withDesign(.serif) ?? NSFont.systemFont(ofSize: size).fontDescriptor, size: size) ?? NSFont.systemFont(ofSize: size)
        for family in T.fontReading {
            if let font = NSFont(name: family, size: size) ?? NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: size) { base = font; break }
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = size * (block.kind == "heading" ? T.textTitleLineHeight : T.textReadingLineHeight)
        paragraph.maximumLineHeight = paragraph.minimumLineHeight
        paragraph.alignment = block.alignment == "right" ? .right : block.alignment == "center" ? .center : .left
        native.addAttributes([.font: base, .paragraphStyle: paragraph, .foregroundColor: T.colorInk(dark: scheme == .dark).nsColor], range: NSRange(location: 0, length: native.length))
        for run in styled.runs {
            let start = String(styled.characters[..<run.range.lowerBound]).utf16.count
            let count = String(styled.characters[run.range]).utf16.count
            let range = NSRange(location: start, length: count)
            var font = base
            if block.kind == "heading" || run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
            if run.inlinePresentationIntent?.contains(.emphasized) == true { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
            if run.inlinePresentationIntent?.contains(.code) == true { font = .monospacedSystemFont(ofSize: size * 0.85, weight: .regular) }
            native.addAttribute(.font, value: font, range: range)
            if run.inlinePresentationIntent?.contains(.strikethrough) == true { native.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: range) }
            if let color = run.foregroundColor { native.addAttribute(.foregroundColor, value: NSColor(color), range: range) }
        }
        let prepared = ConversationCitations.prepare(block.text, citations: citations)
        let ordered = prepared.citationAtOffset.sorted { $0.key < $1.key }
        var ordinal = 0
        let raw = native.string as NSString
        for offset in 0..<raw.length where raw.character(at: offset) == 0xFFFC {
            guard ordinal < ordered.count else { break }
            let entry = ordered[ordinal]; ordinal += 1
            let sourceOffset = sourceOffset(block, prepared.sourceOffsets[entry.key])
            let age = sourceOffset >= 0 && sourceOffset < revealedAt.count ? max(0, now - revealedAt[sourceOffset]) : 1.1
            let attachment = NSTextAttachment()
            attachment.image = citationImage(number: entry.value + 1, age: age)
            attachment.bounds = CGRect(x: 0, y: T.textMeta * 0.1, width: 24, height: T.textMeta * 1.4)
            let chip = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
            chip.addAttributes([.link: URL(string: "everplain-source://\(entry.value)")!, .toolTip: "查看来源 \(entry.value + 1)：\(citations[entry.value].label)"], range: NSRange(location: 0, length: 1))
            native.replaceCharacters(in: NSRange(location: offset, length: 1), with: chip)
        }
        return native
    }
    private func citationImage(number: Int, age: Double) -> NSImage {
        let fresh = age < 1.1
        let phase = min(1, max(0, age / 0.560))
        let spring = ConversationMotion.ease(phase, [0.34, 1.56, 0.64, 1])
        let scale = 0.2 + 0.8 * spring
        let base = OklabColorMix.rgb(hex: agentColor)
        let light = scheme == .dark ? OklabColorMix.mix(base, [1, 1, 1], amount: 0.28) : base
        let accent = fresh ? T.colorAccent(dark: scheme == .dark) : T.colorSurfaceStrong(dark: scheme == .dark)
        let rgb = OklabColorMix.mix(light, [accent.red, accent.green, accent.blue], amount: phase <= 0.5 ? 0 : (phase - 0.5) * 2)
        let fill = NSColor(srgbRed: rgb[0], green: rgb[1], blue: rgb[2], alpha: min(1, phase * 2))
        return NSImage(size: NSSize(width: 24, height: T.textMeta * 1.4), flipped: false) { rect in
            let badge = NSRect(x: rect.midX - rect.width * scale / 2, y: rect.midY - rect.height * scale / 2, width: rect.width * scale, height: rect.height * scale)
            fill.setFill(); NSBezierPath(roundedRect: badge, xRadius: badge.height / 2, yRadius: badge.height / 2).fill()
            let font = TypeStyle.nativeUI(T.textMeta * scale)
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: T.colorInkSoft(dark: scheme == .dark).nsColor.withAlphaComponent(min(1, phase * 2))]
            let string = String(number) as NSString
            let size = string.size(withAttributes: attributes)
            string.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2), withAttributes: attributes)
            return true
        }
    }
}

private struct NativeCitationParagraph: NSViewRepresentable {
    let text: NSAttributedString
    let onCitation: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSTextView {
        let view = NSTextView()
        view.isEditable = false; view.isSelectable = true; view.isRichText = true; view.drawsBackground = false
        view.textContainerInset = .zero; view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isHorizontallyResizable = false; view.isVerticallyResizable = true
        view.delegate = context.coordinator; view.linkTextAttributes = [:]
        return view
    }
    func updateNSView(_ nsView: NSTextView, context: Context) {
        context.coordinator.parent = self
        let selection = nsView.selectedRange()
        nsView.textStorage?.setAttributedString(text)
        if selection.location + selection.length <= text.length { nsView.setSelectedRange(selection) }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 600
        nsView.textContainer?.containerSize = CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        guard let container = nsView.textContainer, let manager = nsView.layoutManager else { return nil }
        manager.ensureLayout(for: container)
        return CGSize(width: width, height: ceil(manager.usedRect(for: container).height))
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeCitationParagraph
        init(_ parent: NativeCitationParagraph) { self.parent = parent }
        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            let url = link as? URL ?? (link as? String).flatMap(URL.init(string:))
            guard let url else { return true }
            if url.scheme == "everplain-source", let value = url.host, let index = Int(value) { parent.onCitation(index); return true }
            guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.user == nil, url.password == nil else { return true }
            NSWorkspace.shared.open(url); return true
        }
    }
}

/// CSS color-mix(in oklab, ...) parity for stream light, avatar inner colors and liquid loading.
enum OklabColorMix {
    static func rgb(hex: String) -> [Double] {
        let n = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        return [Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255]
    }
    static func mix(_ a: [Double], _ b: [Double], amount: Double) -> [Double] {
        func linear(_ x: Double) -> Double { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        func lab(_ rgb: [Double]) -> [Double] {
            let r = linear(rgb[0]), g = linear(rgb[1]), b = linear(rgb[2])
            let l = cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
            let m = cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
            let s = cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
            return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
                    1.9779984951*l - 2.428592205*m + 0.4505937099*s,
                    0.0259040371*l + 0.7827717662*m - 0.808675766*s]
        }
        let a = lab(a), b = lab(b), t = min(1, max(0, amount))
        let c = (0..<3).map { a[$0] * (1 - t) + b[$0] * t }
        let l = pow(c[0] + 0.3963377774*c[1] + 0.2158037573*c[2], 3)
        let m = pow(c[0] - 0.1055613458*c[1] - 0.0638541728*c[2], 3)
        let s = pow(c[0] - 0.0894841775*c[1] - 1.291485548*c[2], 3)
        func encode(_ x: Double) -> Double { min(1, max(0, x <= 0.0031308 ? 12.92*x : 1.055*pow(x, 1/2.4) - 0.055)) }
        return [encode(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
                encode(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
                encode(-0.0041960863*l - 0.7034186147*m + 1.707614701*s)]
    }
    static func color(_ rgb: [Double]) -> Color { Color(.sRGB, red: rgb[0], green: rgb[1], blue: rgb[2], opacity: 1) }
}
#endif
