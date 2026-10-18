#if os(macOS)
import SwiftUI
import AppKit

@main
struct EverplainApp: App {
    @StateObject private var store = AppStore()
    var body: some Scene {
        WindowGroup("Everplain") {
            RootView().environmentObject(store).preferredColorScheme(store.appearance == "light" ? .light : store.appearance == "dark" ? .dark : nil).frame(minWidth: 850, minHeight: 620)
                .task { await store.restore() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                    Task { await store.revalidateSession() }
                }
        }
        .defaultSize(width: 1180, height: 820)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button(store.interfaceLocale == "en-US" ? "About Everplain" : "关于 Everplain") { AppAcknowledgements.show() }
            }
            CommandGroup(replacing: .newItem) {
                Button("新对话") { Task { await store.navigate(.chat, newChat: true) } }
                    .keyboardShortcut("n").disabled(store.session == nil)
            }
            CommandMenu("Everplain") {
                Button("首页") { Task { await store.navigate(.home) } }.keyboardShortcut("1")
                Button("账户") { Task { await store.navigate(.account) } }.keyboardShortcut(",")
                Button("Agent 设置") { Task { await store.navigate(.agent) } }.keyboardShortcut("3")
                Divider()
                Button("刷新") { Task { await store.refreshAll() } }.keyboardShortcut("r").disabled(store.session == nil || store.refreshing)
                Button("停止回答") { Task { await store.stop() } }.keyboardShortcut(".").disabled(!store.running)
            }
        }
    }
}
#else
import Foundation
@main enum UnsupportedPlatform {
    static func main() {
        print("Everplain is a native macOS app. Build the app on macOS 13+ with Xcode. Core tests can run separately on Linux.")
    }
}
#endif
