#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

/// Original Web brand assets, converted to vector PDF for AppKit; flomo PNG is unchanged.
/// Apple Notes deliberately retains Web's generic Notebook icon, never illustrative brand art.
struct ImportSourceIcon: View {
    let source: KnowledgeImportSource
    var size: Double = 20
    private var asset: String? {
        switch source { case .chrome: return "chrome"; case .obsidian: return "obsidian"; case .enex: return "evernote"; case .notion: return "notion"; case .flomo: return "flomo"; case .keep: return "keep"; case .bilibili: return "bilibili"; default: return nil }
    }
    private var icon: WebIconName {
        switch source { case .file: return .uploadSimple; case .image: return .image; case .chrome: return .fileText; case .obsidian: return .folderOpen; case .bilibili: return .playCircle; case .extensionGuide: return .puzzlePiece; case .records: return .clockCounterClockwise; default: return .notebook }
    }
    var body: some View {
        Group {
            if let asset, let url = Bundle.module.url(forResource: asset, withExtension: asset == "flomo" ? "png" : "pdf", subdirectory: "BrandAssets"), let image = NSImage(contentsOf: url) {
                Image(nsImage: image).resizable().scaledToFit()
            } else { WebIcon(name: icon, size: size) }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}
#endif
