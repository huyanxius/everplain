#if os(macOS)
import AppKit
import SwiftUI
import XCTest
import EverplainCore
@testable import EverplainMac

/// Opt-in CI only. These render production native views with explicitly synthetic,
/// offline state; they are not screenshots of a signed-in production account.
final class NativeHomeVisualTests: XCTestCase {
    @MainActor private func enabled() throws {
        guard ProcessInfo.processInfo.environment["EVERPLAIN_RUN_NATIVE_UI_TESTS"] == "1" else {
            throw XCTSkip("Set EVERPLAIN_RUN_NATIVE_UI_TESTS=1 on an interactive macOS runner.")
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular); app.activate(ignoringOtherApps: true)
    }
    @MainActor private func window<V: View>(_ content: V, size: CGSize) -> (NSWindow, NSHostingView<V>) {
        let window = NSWindow(contentRect: CGRect(origin:.zero,size:size),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        window.title = "Everplain native UI test · Synthetic offline fixture"
        window.isReleasedWhenClosed = false; window.acceptsMouseMovedEvents = false
        let host = NSHostingView(rootView:content); host.frame = CGRect(origin:.zero,size:size)
        window.contentView = host; window.center(); window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded(); window.displayIfNeeded()
        return (window,host)
    }
    @MainActor private func settle(_ seconds: Double) async throws { try await Task.sleep(nanoseconds:UInt64(seconds*1_000_000_000)) }
    @MainActor @discardableResult private func capture(_ host: NSView, name: String) throws -> Data {
        host.layoutSubtreeIfNeeded(); host.window?.displayIfNeeded()
        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in:host.bounds))
        host.cacheDisplay(in:host.bounds,to:bitmap)
        let bytes = try XCTUnwrap(bitmap.representation(using:.png,properties:[:]))
        XCTAssertGreaterThan(bytes.count, 4000, "Native render appears empty")
        let root = ProcessInfo.processInfo.environment["EVERPLAIN_UI_SNAPSHOT_DIR"] ?? FileManager.default.temporaryDirectory.appendingPathComponent("Everplain-native-ui-tests").path
        let directory = URL(fileURLWithPath:root,isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        try bytes.write(to:directory.appendingPathComponent(name+".png"))
        return bytes
    }

    @MainActor func testCompanionNativeRenderingAndInterruptedDeparture() async throws {
        try enabled()
        let controller = CompanionVisualController(), model = HomeCompanionState()
        let (window,host) = window(CompanionVisualHost(controller:controller,model:model),size:CGSize(width:800,height:400))
        defer { model.stop(); window.close() }
        try await settle(1.5)
        XCTAssertTrue(model.frame.present); XCTAssertTrue(window.acceptsMouseMovedEvents)
        let idle = try capture(host,name:"companion-native-idle")
        model.smile(); try await settle(0.25)
        XCTAssertNotNil(model.frame.happyAge)
        let happy = try capture(host,name:"companion-native-happy")
        XCTAssertNotEqual(idle,happy,"Click behavior did not change the native render")
        try await settle(1.5); XCTAssertNil(model.frame.happyAge)
        controller.active = false; try await settle(0.15); XCTAssertTrue(model.frame.present)
        controller.active = true; try await settle(0.6); XCTAssertTrue(model.frame.present,"A stale departure removed the returning companion")
        controller.reduced = true; try await settle(0.1)
        XCTAssertEqual(model.frame.turn,0.25); XCTAssertEqual(model.frame.nod,0)
        let reduced = try capture(host,name:"companion-native-reduced-motion")
        try await settle(0.2)
        XCTAssertEqual(reduced,try capture(host,name:"companion-native-reduced-motion-repeat"),"Reduced motion still animates")
        controller.active = false; try await settle(0.1)
        XCTAssertFalse(model.frame.present); XCTAssertFalse(window.acceptsMouseMovedEvents,"The removed companion left its pointer monitor active")
    }

    @MainActor func testActualHomeViewRendersOfflineAndKeepsComposerAcrossRoutes() async throws {
        try enabled()
        // This process-only endpoint override prevents any production-origin use.
        let old = ProcessInfo.processInfo.environment["EVERPLAIN_API_URL"]
        setenv("EVERPLAIN_API_URL","http://127.0.0.1:9",1)
        defer { if let old { setenv("EVERPLAIN_API_URL",old,1) } else { unsetenv("EVERPLAIN_API_URL") } }
        let store = AppStore(); store.booting = false; store.splitSidebar = false
        store.session = SessionResponse(allowedActions:[],expiresAt:"2099-01-01T00:00:00Z",sessionId:"synthetic-ui-session",status:"active",user:SessionUserResponse(displayName:"离线测试",email:"fixture@example.invalid",userId:"synthetic-ui-owner"),version:1)
        store.profile = AgentProfileResponse(avatarId:"cheng",color:"#5d8fe6",greeting:"",name:"示例伙伴",questionnaire:Questionnaire(),setupCompleted:true,setupStep:4,speakingStyle:"clear",version:1)
        store.catalog = AgentModelCatalogResponse(items:[AgentModelChoiceResponse(defaultReasoningEffort:"none",label:"GPT 6 Luna",modelId:"synthetic-model",reasoningEfforts:["none","low","medium","high"])],runtimeMode:"mock")
        store.modelId = "synthetic-model"; store.effort = "none"; store.modelCatalogStatus = "ready"
        let content = RootView().environmentObject(store).environment(\.colorScheme,.light)
        let (window,host) = window(content,size:CGSize(width:1340,height:840))
        defer { window.close(); store.client?.close() }
        try await settle(1.6)
        _ = try capture(host,name:"home-native-synthetic-loading")
        await store.navigate(.chat,newChat:true,composerDraft:"Offline visual test draft")
        try await settle(0.6)
        XCTAssertEqual(store.composer,"Offline visual test draft"); XCTAssertNil(store.pending); XCTAssertFalse(store.running)
        _ = try capture(host,name:"chat-native-synthetic-unsent")
        await store.navigate(.home); try await settle(1.4)
        XCTAssertEqual(store.route,.home)
        _ = try capture(host,name:"home-native-synthetic-return")
    }
}

@MainActor private final class CompanionVisualController: ObservableObject {
    @Published var active = true
    @Published var reduced = false
}
@MainActor private struct CompanionVisualHost: View {
    @ObservedObject var controller: CompanionVisualController
    let model: HomeCompanionState
    var body: some View {
        Color(red:0.96,green:0.96,blue:0.96)
            .overlay(alignment:.bottomTrailing) { HomeCompanion(active:controller.active,state:model,reducedMotionOverride:controller.reduced) }
            .environment(\.colorScheme,.light)
    }
}
#endif
