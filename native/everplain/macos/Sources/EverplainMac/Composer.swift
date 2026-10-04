#if os(macOS)
import AppKit
import SwiftUI
import EverplainCore

/// One native editor is owned by HomeConversationSurface for both Home and Chat.
struct Composer: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @StateObject private var editor = ComposerEditorHandle()
    @State private var editorHeight: CGFloat = 36
    @State private var width: CGFloat = 700
    @State private var viewportWidth: CGFloat = 1200
    @State private var modelOpen = false
    @State private var toolsOpen = false
    @FocusState private var modelFocused: Bool
    var home = false
    private var busy: Bool { !home && (store.running || store.isCurrentStopPending) }
    private var research: Bool { !home && store.composerMode == "deep_research" }
    private var hasExtras: Bool { !home && (!store.attachedMaterials.isEmpty || store.materialUploading || store.materialPickerOpen) }
    private var displayEditorHeight: CGFloat { research ? max(52, editorHeight) : editorHeight }
    private var multiline: Bool { store.composer.contains("\n") || store.composer.utf16.count > 40 || (width < 480 && !store.composer.isEmpty) }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        VStack(alignment: .leading, spacing: T.space2) {
            VStack(alignment: .leading, spacing: 12) {
            if hasExtras { ComposerAttachments(busy: busy) }
            ComposerRowLayout(viewportWidth: viewportWidth, multiline: multiline, research: research, editorHeight: displayEditorHeight) {
                toolsButton
                NativeComposer(text: $store.composer, height: $editorHeight, viewportWidth: $viewportWidth, focusToken: store.focusComposer,
                               handle: editor, dark: scheme == .dark,
                               placeholder: home ? "问\(store.agentName)，或者丢一个链接进来" : "问一个问题",
                               textVerticalInset: research ? 0 : 5, canSubmit: store.canSend && !busy, onSubmit: submit)
                    .frame(height: displayEditorHeight).accessibilityLabel(home ? "问\(store.agentName)" : "消息")
                modelButton
                sendButton
            }
            }
            .padding(.leading, T.space3).padding(.trailing, research ? 12 : 10).padding(.top, research ? 16 : 10).padding(.bottom, research ? 12 : 10)
            .background(p.surface, in: RoundedRectangle(cornerRadius: multiline || viewportWidth <= 480 || research || hasExtras ? T.radiusPanel : T.radiusPill))
            .overlay(RoundedRectangle(cornerRadius: multiline || viewportWidth <= 480 || research || hasExtras ? T.radiusPanel : T.radiusPill).stroke(p.ring, lineWidth: 1))
            .shadow(color: T.shadowComposer(dark: scheme == .dark).last!.color.color, radius: 16, y: 8)
            .animation(reducedMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.320), value: editorHeight)
            .animation(reducedMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: T.motionBase / 1000), value: multiline)
            .background(GeometryReader { geometry in Color.clear.onAppear { width = geometry.size.width }.onChange(of: geometry.size.width) { width = $0 } })
        }
        .onDisappear { modelOpen = false; toolsOpen = false; SendFlightHandoff.cancel() }
    }
    private var toolsButton: some View {
        Button { modelOpen = false; toolsOpen.toggle() } label: {
            WebIcon(name: .plus)
        }.buttonStyle(EPIconButtonStyle()).disabled(store.materialUploading).accessibilityLabel("添加附件")
            .background(NativeAnchoredPopover(isPresented: $toolsOpen, content: AnyView(ComposerTools(home: home, busy: busy, close: { toolsOpen = false }).environmentObject(store)),
                                              width: 240, maxHeight: 420, label: "添加附件", dark: scheme == .dark, reducedMotion: reducedMotion))
    }
    private var modelButton: some View {
        let original = busy ? store.pending?.request : nil
        let selected = original == nil ? store.selectedModel : store.catalog?.items.first(where: { $0.modelId == original?.modelId })
        let effort = original?.reasoningEffort ?? store.effort
        let p = Palette(dark: scheme == .dark)
        return Button { toolsOpen = false; modelFocused = false; modelOpen.toggle() } label: {
            HStack(spacing: 6) {
                Text(selected?.label ?? (original == nil ? (store.modelCatalogStatus == "loading" ? "正在读取模型" : store.modelCatalogStatus == "error" ? "模型暂不可用 · 服务端默认" : "模型未启用 · 服务端默认") : "本轮沿用原设置")).lineLimit(1)
                if selected != nil { Text(Self.effortName(effort)).foregroundStyle(p.muted).fixedSize() }
                WebIcon(name: .caretDown, size: 12).foregroundStyle(p.faint).fixedSize()
            }
            .font(TypeStyle.ui(T.textControl)).foregroundStyle(p.ink)
            .padding(.horizontal, width < 640 ? T.space2 : T.space3)
            .frame(height: T.iconControlSize)
            .background(modelOpen ? p.strong : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain).focused($modelFocused)
        .background(NativeModelPopover(isPresented: $modelOpen, store: store, disabled: busy,
                                       dark: scheme == .dark, reducedMotion: reducedMotion, onEscape: { modelFocused = true }))
        .accessibilityLabel("模型与思考强度：\(selected?.label ?? "模型暂不可用") · \(Self.effortName(effort))")
        .accessibilityValue(modelOpen ? "已展开" : "已收起")
    }
    private var sendButton: some View {
        Button {
            if busy { Task { await store.stop() } } else { submit() }
        } label: {
            if !home && store.isCurrentStopPending && store.stopping { ProgressView().controlSize(.small) }
            else { WebIcon(name: busy ? .stopFill : .arrowUpBold, size: 16.1) }
        }
        .buttonStyle(EPIconButtonStyle(primary: true))
        .disabled((!home && store.isCurrentStopPending) || (!busy && !store.canSend))
        .help(busy ? "停止生成" : "发送给 Everplain（Return）")
        .accessibilityLabel(busy ? "停止生成" : "发送给 Everplain")
    }
    private func submit() {
        guard store.canSend, !busy, !editor.isComposing else { return }
        modelOpen = false; toolsOpen = false
        if !reducedMotion, let origin = editor.textOrigin { SendFlightHandoff.mark(text: store.composer, origin: origin) }
        store.send()
        // The editor remains editable, mounted and first responder during network work.
        editor.focus()
    }
    static func effortName(_ value: String) -> String {
        ["none":"无", "low":"低", "medium":"中", "high":"高", "xhigh":"很高", "max":"最高"][value] ?? value
    }
}

/// Single-line controls share the exact 36pt center. Only real multiline rows bottom-align.
private struct ComposerRowLayout: Layout {
    let viewportWidth: CGFloat
    let multiline: Bool
    let research: Bool
    let editorHeight: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        CGSize(width: proposal.width ?? 680, height:ComposerGeometry.rowHeight(editorHeight:Double(editorHeight),viewportWidth:Double(viewportWidth),research:research))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 4 else { return }
        let positions = ComposerGeometry.make(width:Double(bounds.width),originX:Double(bounds.minX),originY:Double(bounds.minY),editorHeight:Double(editorHeight),idealModelWidth:Double(subviews[2].sizeThatFits(.unspecified).width),viewportWidth:Double(viewportWidth),research:research,multiline:multiline)
        for (index,box) in [positions.tools,positions.input,positions.model,positions.send].enumerated() {
            subviews[index].place(at:CGPoint(x:box.x,y:box.y),anchor:.topLeading,proposal:ProposedViewSize(width:box.width,height:box.height))
        }
    }
}

private final class ComposerEditorHandle: ObservableObject {
    weak var editor: ComposerTextView?
    var isComposing: Bool { editor?.hasMarkedText() == true || editor?.keyBeganInComposition == true }
    var textOrigin: CGPoint? {
        guard let editor, let window = editor.window else { return nil }
        return window.convertPoint(toScreen: editor.convert(CGPoint(x: 0, y: editor.textContainerInset.height), to: nil))
    }
    func focus() {
        guard let editor else { return }
        editor.window?.makeFirstResponder(editor)
    }
}

private struct NativeComposer: NSViewRepresentable {
    @Binding var text: String
    @Binding var height: CGFloat
    @Binding var viewportWidth: CGFloat
    let focusToken: UUID
    let handle: ComposerEditorHandle
    let dark: Bool
    let placeholder: String
    let textVerticalInset: CGFloat
    let canSubmit: Bool
    let onSubmit: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let editor = ComposerTextView(frame: CGRect(x: 0, y: 0, width: 100, height: 36))
        editor.isRichText = false; editor.importsGraphics = false
        editor.drawsBackground = false; editor.isVerticallyResizable = true; editor.isHorizontallyResizable = false
        editor.minSize = NSSize(width: 0, height: 36)
        editor.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        editor.autoresizingMask = [.width]
        editor.textContainer?.widthTracksTextView = true
        editor.textContainer?.containerSize = NSSize(width: 100, height: CGFloat.greatestFiniteMagnitude)
        editor.textContainer?.lineFragmentPadding = 0
        editor.textContainerInset = NSSize(width: 0, height: 5)
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.delegate = context.coordinator
        editor.setAccessibilityLabel("消息输入框")
        scroll.documentView = editor; scroll.drawsBackground = false; scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay; scroll.autohidesScrollers = true; scroll.borderType = .noBorder
        scroll.contentInsets = .init(top: 0, left: 0, bottom: 0, right: 0)
        scroll.automaticallyAdjustsContentInsets = false
        editor.onWidthChange = { [weak coordinator = context.coordinator] in coordinator?.measure() }
        context.coordinator.editor = editor; handle.editor = editor
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? ComposerTextView else { return }
        context.coordinator.parent = self
        handle.editor = editor
        let paragraph = NSMutableParagraphStyle(); paragraph.minimumLineHeight = 26; paragraph.maximumLineHeight = 26
        editor.font = TypeStyle.nativeUI(T.textBody)
        editor.defaultParagraphStyle = paragraph
        editor.typingAttributes = [.font: TypeStyle.nativeUI(T.textBody), .paragraphStyle: paragraph, .foregroundColor: T.colorInk(dark: dark).nsColor]
        editor.textColor = T.colorInk(dark: dark).nsColor
        editor.insertionPointColor = T.colorInk(dark: dark).nsColor
        editor.placeholder = placeholder
        editor.placeholderColor = T.colorFaint(dark: dark).nsColor
        editor.textContainerInset = NSSize(width: 0, height: textVerticalInset)
        editor.minSize = NSSize(width:0,height:height)
        if editor.string != text && !editor.hasMarkedText() {
            let selection = editor.selectedRange()
            editor.string = text
            editor.setSelectedRange(NSRange(location: min(selection.location, text.utf16.count), length: 0))
        }
        editor.needsDisplay = true
        editor.sizeToFit()
        context.coordinator.measure()
        if context.coordinator.lastFocus != focusToken {
            context.coordinator.lastFocus = focusToken
            DispatchQueue.main.async { [weak editor, weak coordinator = context.coordinator] in
                guard let editor, coordinator?.lastFocus == focusToken, editor.window != nil else { return }
                editor.window?.makeFirstResponder(editor)
            }
        }
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeComposer
        var lastFocus: UUID?
        private var measurement = 0
        weak var editor: ComposerTextView?
        init(_ parent: NativeComposer) { self.parent = parent }
        func measure() {
            guard let editor, editor.bounds.width > 0, let container = editor.textContainer, let manager = editor.layoutManager else { return }
            if let viewport = editor.window?.contentView?.bounds.width, abs(parent.viewportWidth - viewport) > 0.5 {
                DispatchQueue.main.async { [weak self, weak editor] in
                    guard let self, let viewport = editor?.window?.contentView?.bounds.width else { return }
                    if abs(self.parent.viewportWidth - viewport) > 0.5 { self.parent.viewportWidth = viewport }
                }
            }
            manager.ensureLayout(for: container)
            let used = max(manager.usedRect(for: container).maxY, manager.extraLineFragmentRect.maxY)
            let contentHeight: CGFloat
            if editor.string.isEmpty {
                let attributes: [NSAttributedString.Key:Any] = [.font:editor.font ?? TypeStyle.nativeUI(T.textBody),.paragraphStyle:editor.defaultParagraphStyle ?? NSParagraphStyle.default]
                contentHeight = (parent.placeholder as NSString).boundingRect(with:NSSize(width:editor.bounds.width,height:CGFloat.greatestFiniteMagnitude),options:[.usesLineFragmentOrigin,.usesFontLeading],attributes:attributes).height
            } else { contentHeight = used }
            let measured = min(240,max(36,ceil(contentHeight) + parent.textVerticalInset * 2))
            measurement += 1
            let revision = measurement
            guard abs(parent.height - measured) > 0.5 else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.measurement == revision else { return }
                self.parent.height = measured
            }
        }
        func textDidChange(_ notification: Notification) {
            if let editor = notification.object as? ComposerTextView { parent.text = editor.string; editor.needsDisplay = true; measure() }
        }
        func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
            guard let replacementString else { return true }
            let proposed = (textView.string as NSString).replacingCharacters(in: affectedCharRange, with: replacementString)
            return proposed.utf16.count <= 12_000 || textView.hasMarkedText()
        }
        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            guard commandSelector == #selector(NSResponder.insertNewline(_:)) else { return false }
            // Capture composition before interpretKeyEvents commits it; hasMarkedText alone is too late.
            guard !textView.hasMarkedText(), (textView as? ComposerTextView)?.keyBeganInComposition != true else { return false }
            if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { return false }
            if parent.canSubmit && NSApp.currentEvent?.isARepeat != true { parent.onSubmit() }
            return true
        }
    }
}

private final class ComposerTextView: NSTextView {
    var placeholder = ""
    var placeholderColor = NSColor.placeholderTextColor
    var keyBeganInComposition = false
    var onWidthChange: (() -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); onWidthChange?() }
    override func keyDown(with event: NSEvent) {
        keyBeganInComposition = hasMarkedText()
        defer { keyBeganInComposition = false }
        super.keyDown(with: event)
    }
    override func setFrameSize(_ newSize: NSSize) {
        let changed = abs(frame.width - newSize.width) > 0.5
        super.setFrameSize(newSize)
        if changed { onWidthChange?() }
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if string.isEmpty {
            let attrs: [NSAttributedString.Key: Any] = [.font: font ?? TypeStyle.nativeUI(T.textBody), .foregroundColor: placeholderColor,
                                                       .paragraphStyle: defaultParagraphStyle ?? NSParagraphStyle.default]
            (placeholder as NSString).draw(in: CGRect(x: textContainerInset.width, y: textContainerInset.height,
                                                     width: max(0, bounds.width - textContainerInset.width * 2), height: max(26,bounds.height - textContainerInset.height * 2)), withAttributes: attrs)
        }
    }
}
#endif
