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
    @MainActor private func composerEditor(in view: NSView) -> NSTextView? {
        if let text = view as? NSTextView { return text }
        for child in view.subviews { if let text = composerEditor(in:child) { return text } }
        return nil
    }
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
        let (window,host) = window(content,size:CGSize(width:1180,height:757))
        defer { window.close(); store.client?.close() }
        try await settle(1.6)
        let originalEditor = try XCTUnwrap(composerEditor(in:host))
        let editorIdentity = ObjectIdentifier(originalEditor)
        let viewport = try XCTUnwrap(originalEditor.enclosingScrollView)
        XCTAssertEqual(originalEditor.bounds.width,viewport.contentSize.width,accuracy:1,"Native text extends behind the model control")
        XCTAssertGreaterThan(viewport.contentSize.height,36,"The wrapped Home placeholder was clipped to one line")
        let readingFont = try XCTUnwrap(TypeStyle.nativeReading(36))
        let cascade = readingFont.fontDescriptor.object(forKey:.cascadeList) as? [NSFontDescriptor]
        XCTAssertFalse(cascade?.isEmpty ?? true,"The Web reading fallback stack was discarded")
        print("Native reading font: \(readingFont.fontName); cascade: \(cascade?.map(\.postscriptName) ?? [])")
        _ = try capture(host,name:"home-native-synthetic-loading")
        await store.navigate(.chat,newChat:true,composerDraft:"Offline visual test draft")
        try await settle(0.6)
        XCTAssertEqual(store.composer,"Offline visual test draft"); XCTAssertNil(store.pending); XCTAssertFalse(store.running)
        let chatEditor = try XCTUnwrap(composerEditor(in:host))
        XCTAssertEqual(ObjectIdentifier(chatEditor),editorIdentity,"Home→Chat recreated the native editor")
        XCTAssertEqual(chatEditor.string,"Offline visual test draft")
        XCTAssertTrue(window.firstResponder === chatEditor,"The persistent editor lost its input session after navigation")
        _ = try capture(host,name:"chat-native-synthetic-unsent")
        await store.navigate(.home); try await settle(1.4)
        XCTAssertEqual(store.route,.home)
        XCTAssertEqual(composerEditor(in:host).map(ObjectIdentifier.init),editorIdentity,"Returning Home recreated the native editor")
        _ = try capture(host,name:"home-native-synthetic-return")
    }

    @MainActor func testHomePileNativeRenderingKeepsCardsAcrossInterruptedToggles() async throws {
        try enabled()
        let model = HomePileVisualController()
        let (window,host) = window(HomePileVisualHost(model:model),size:CGSize(width:460,height:460))
        defer { window.close() }
        try await settle(0.2)
        XCTAssertEqual(model.appearances,[0:1,1:1,2:1])
        let closed = try capture(host,name:"home-material-pile-native-closed")
        model.expanded = true; try await settle(0.15)
        model.expanded = false; try await settle(0.1)
        model.expanded = true; try await settle(1)
        XCTAssertEqual(model.appearances,[0:1,1:1,2:1],"Pile expansion replaced its source cards")
        XCTAssertEqual(model.navigations,0,"Opening the pile navigated into a document")
        let opened = try capture(host,name:"home-material-pile-native-expanded")
        XCTAssertNotEqual(opened,closed)
        model.expanded = false; try await settle(0.9)
        XCTAssertEqual(model.appearances,[0:1,1:1,2:1])
        _ = try capture(host,name:"home-material-pile-native-return")
    }

    @MainActor func testNativeModelPanelRendersAndRapidlyReopensWithoutStaleClose() async throws {
        try enabled()
        let old = ProcessInfo.processInfo.environment["EVERPLAIN_API_URL"]
        setenv("EVERPLAIN_API_URL","http://127.0.0.1:9",1)
        defer { if let old { setenv("EVERPLAIN_API_URL",old,1) } else { unsetenv("EVERPLAIN_API_URL") } }
        let store = AppStore(); store.booting = false
        store.catalog = AgentModelCatalogResponse(items:[AgentModelChoiceResponse(defaultReasoningEffort:"none",label:"GPT 6 Luna",modelId:"synthetic-model",reasoningEfforts:["none","low","medium","high","xhigh","max"])],runtimeMode:"mock")
        store.modelId = "synthetic-model"; store.effort = "none"; store.modelCatalogStatus = "ready"
        let controller = ModelPopoverVisualController()
        let (window,_) = window(ModelPopoverVisualHost(controller:controller,store:store),size:CGSize(width:800,height:500))
        defer { controller.presented = false; window.close(); store.client?.close() }
        try await settle(0.2)
        controller.presented = true; try await settle(0.4)
        let panel = try XCTUnwrap(window.childWindows?.compactMap { $0 as? ModelPanel }.first)
        XCTAssertEqual(panel.frame.width,300,accuracy:0.5)
        XCTAssertGreaterThan(panel.frame.height,170,"The model and six effort controls were clipped")
        _ = try capture(try XCTUnwrap(panel.contentView),name:"model-settings-native-synthetic")
        controller.presented = false; try await settle(0.04)
        controller.presented = true; try await settle(0.5)
        let reopened = window.childWindows?.compactMap { $0 as? ModelPanel } ?? []
        XCTAssertEqual(reopened.count,1,"Interrupted dismissal removed or duplicated the reopened panel")
        XCTAssertTrue(reopened.first?.isVisible ?? false)
        controller.presented = false; try await settle(0.25)
        XCTAssertEqual(window.childWindows?.compactMap { $0 as? ModelPanel }.count ?? 0,0)
    }

    @MainActor func testNativeLoginAccountAndAgentSurfacesRenderOffline() async throws {
        try enabled()
        let old = ProcessInfo.processInfo.environment["EVERPLAIN_API_URL"]
        setenv("EVERPLAIN_API_URL","http://127.0.0.1:9",1)
        defer { if let old { setenv("EVERPLAIN_API_URL",old,1) } else { unsetenv("EVERPLAIN_API_URL") } }
        let store = AppStore(); store.booting = false; store.splitSidebar = false
        let (window,host) = window(RootView().environmentObject(store).environment(\.colorScheme,.light),size:CGSize(width:1180,height:757))
        defer { window.close(); store.client?.close() }
        try await settle(0.4)
        _ = try capture(host,name:"login-native-email-step")
        let owner = "synthetic-settings-owner"
        store.session = SessionResponse(allowedActions:[],expiresAt:"2099-01-01T00:00:00Z",sessionId:"synthetic-settings-session",status:"active",user:SessionUserResponse(displayName:"离线测试",email:"fixture@example.invalid",userId:owner),version:1)
        store.profile = AgentProfileResponse(avatarId:"cheng",color:"#5d8fe6",greeting:"",name:"示例伙伴",questionnaire:Questionnaire(),setupCompleted:true,setupStep:4,speakingStyle:"clear",version:1)
        store.account = AccountResponse(createdAt:"2026-01-01T00:00:00Z",displayName:"离线测试",email:"fixture@example.invalid",isProtectedAdmin:false,preferences:AccountPreferencesResponse(consentPolicyVersion:"synthetic",locale:"zh-CN",modelImprovementAllowed:false,researchUpdatesEnabled:false,timezone:"UTC",version:1),role:"user",status:"active",updatedAt:"2026-01-01T00:00:00Z",userId:owner,version:1)
        store.settingsSection = .profile; store.route = .account
        try await settle(0.5)
        _ = try capture(host,name:"account-native-synthetic-profile")
        store.settingsSection = .agent
        try await settle(0.5)
        _ = try capture(host,name:"agent-native-synthetic-settings")
        XCTAssertEqual(store.profile?.name,"示例伙伴")
        XCTAssertFalse(store.saving); XCTAssertFalse(store.authenticating)
    }
}

@MainActor private final class ModelPopoverVisualController: ObservableObject {
    @Published var presented = false
}
@MainActor private struct ModelPopoverVisualHost: View {
    @ObservedObject var controller: ModelPopoverVisualController
    let store: AppStore
    var body: some View {
        VStack { Spacer(); Text("离线模型选择测试").frame(width:160,height:36).background(NativeModelPopover(isPresented:$controller.presented,store:store,disabled:false,dark:false,reducedMotion:false)); Spacer().frame(height:40) }.frame(maxWidth:.infinity).background(Color.white)
    }
}

@MainActor private final class HomePileVisualController: ObservableObject {
    @Published var expanded = false
    var appearances: [Int:Int] = [:]
    var navigations = 0
}
@MainActor private struct HomePileVisualHost: View {
    @ObservedObject var model: HomePileVisualController
    var body: some View {
        HomePile(kind:.deck,expanded:$model.expanded,cover:AnyView(VStack(alignment:.leading,spacing:8) {
            Text("3 份合成资料 · 2 个主题")
            Text("离线几何与动画测试").font(.system(size:14))
            Text("1 份待整理").font(.system(size:13)).underline()
        }),items:(0..<3).map { index in
            HomePileItem(id:"synthetic-\(index)",label:"合成资料 \(index+1)",action:{ model.navigations += 1 },content:AnyView(VStack(alignment:.leading,spacing:8) {
                Text("我的笔记").font(.system(size:13))
                Text("合成资料 \(index+1)").font(.system(size:14))
            }.onAppear { model.appearances[index,default:0] += 1 }))
        }).padding(30).frame(maxHeight:.infinity,alignment:.top)
            .background(Color(red:0.96,green:0.96,blue:0.96)).environment(\.colorScheme,.light)
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
