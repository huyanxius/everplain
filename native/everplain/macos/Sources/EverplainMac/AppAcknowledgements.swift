#if os(macOS)
import AppKit
import SwiftUI

struct CitationProcessorAttribution: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("citeproc-js implements the Citation Style Language")
            Link("© Frank Bennett · citationstyles.org", destination: URL(string: "https://citationstyles.org/")!)
        }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).textSelection(.enabled)
    }
}
@MainActor enum AppAcknowledgements {
    static func show() {
        let credits = NSMutableAttributedString(string: "citeproc-js implements the Citation Style Language\n© Frank Bennett\nhttps://citationstyles.org/\n\nSwift Markdown / cmark · Swift project\nCytoscape.js · MIT\nPhosphor Icons · MIT\nCSL styles · CC BY-SA\n\nThe bundled sources retain their original licenses.\n")
        let url = "https://citationstyles.org/"
        credits.addAttribute(.link, value: URL(string: url)!, range: (credits.string as NSString).range(of: url))
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Everplain", .credits: credits])
    }
}
#endif
