#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

/// Web PageShell/AccountMenu's bottom raised capsule and its two distinct panels.
struct SidebarAccountView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var panel: Panel?
    @State private var settingsWereOpen = false
    @State private var notificationFilter = "all"
    @FocusState private var trigger: Panel?
    @State private var anchorView: NSView?
    enum Panel: Hashable { case account, notifications }
    var collapsed = false
    var split = false
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        (collapsed ? AnyLayout(VStackLayout(spacing: T.space1)) : AnyLayout(HStackLayout(spacing: T.space1))) {
            if split { notificationButton }
            Button { toggle(.account) } label: {
                HStack(spacing: T.space2) {
                    AgentAvatar(id: store.profile?.avatarId ?? "cheng", color: store.profile?.color ?? AgentAvatar.presets[0].color, size: 32)
                    if !collapsed {
                        Text(store.agentName).font(TypeStyle.ui(T.textControl)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                        NavigationIcon(kind: .chevron)
                    }
                }.padding(.horizontal, T.space1).frame(minHeight: T.actionHeight)
            }.buttonStyle(WebRowStyle(radius: T.radiusItem)).focused($trigger, equals: .account)
                .accessibilityLabel("账户 \(store.displayName.isEmpty ? "我的账户" : store.displayName)")
            if !split { notificationButton }
        }.padding(T.space1).background(p.raised, in: RoundedRectangle(cornerRadius: T.radiusCard))
            .background(NativeInteractionAnchor { anchorView = $0 })
            .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(p.ring, lineWidth: 1))
            .shadow(color: T.shadowComposer(dark: scheme == .dark).last!.color.color, radius: 8, y: 3)
            .overlay(alignment: .bottomLeading) {
                if let panel {
                    Group {
                        if panel == .account { accountMenu }
                        else { notifications }
                    }.padding(T.space4).background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusPanel))
                        .overlay(RoundedRectangle(cornerRadius: T.radiusPanel).stroke(p.rule, lineWidth: 1))
                        .shadow(color: T.shadowPanel(dark: scheme == .dark).last!.color.color, radius: 24, y: 12)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(width: panel == .account ? 260 : 360)
                        .background(OutsideClickObserver(anchor: anchorView) { close() })
                        .padding(.bottom, T.actionHeight + T.space2 + T.space2 + (collapsed ? T.iconControlSize + T.space1 : 0))
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 4)).combined(with: .scale(scale: 0.99, anchor: .bottomLeading)))
                        .onExitCommand { close() }
                }
            }.zIndex(panel == nil ? 0 : 100)
            .onChange(of: store.route) { route in
                let settingsOpen = route == .account || route == .agent
                if settingsWereOpen && !settingsOpen { trigger = .account } else { close() }
                settingsWereOpen = settingsOpen
            }
            .onChange(of: store.companionTab) { value in if value == nil { trigger = .account } }
            .onChange(of: store.session?.user.userId) { _ in panel = nil }
    }
    private var notificationButton: some View {
        Button { toggle(.notifications) } label: { NavigationIcon(kind: .bell) }
            .buttonStyle(EPIconButtonStyle()).focused($trigger, equals: .notifications).accessibilityLabel(epLocalized("通知"))
    }
    private var accountMenu: some View {
        let p = Palette(dark: scheme == .dark)
        return VStack(alignment: .leading, spacing: T.space1) {
            HStack(spacing: T.space3) {
                AgentAvatar(id: store.profile?.avatarId ?? "cheng", color: store.profile?.color ?? AgentAvatar.presets[0].color, size: 32)
                VStack(alignment: .leading, spacing: T.space1) {
                    Text(store.displayName.isEmpty ? "我的账户" : store.displayName).fontWeight(.semibold).lineLimit(1)
                    Text(store.subscriptionSummary).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                }
            }.padding(.vertical, T.space2).padding(.bottom, T.space1)
            VStack(spacing: T.space3) {
                if let credits = store.credits, !credits.isUnlimited, !AccountAllowance.from(credits).isEmpty {
                    ForEach(AccountAllowance.from(credits)) { bucket in
                        VStack(spacing: T.space2) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(bucket.label); Spacer()
                                Text(bucket.remainingPercent.map { "剩余 \(String(format: "%g", $0))%" } ?? "暂不可用")
                                    .font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                            }
                            if let value = bucket.remainingPercent {
                                GeometryReader { geometry in
                                    Capsule().fill(p.strong).overlay(alignment: .leading) { Capsule().fill(p.ink).frame(width: geometry.size.width * value / 100) }
                                }.frame(height: T.space2).accessibilityLabel(bucket.label).accessibilityValue("剩余 \(value)%")
                            }
                        }
                    }
                } else {
                    HStack { EPText("使用额度"); Spacer(); Text(store.credits?.isUnlimited == true ? "不限量" : store.accountError != nil ? "额度信息暂不可用" : store.credits == nil ? "正在读取…" : "额度信息暂不可用").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted) }
                }
            }.padding(.top, T.space1).padding(.bottom, T.space3)
            item("Soul · 人格", icon: .user) { store.openCompanion("identity") }
            item("Memory · 记忆", icon: .library) { store.openCompanion("memory") }
            item("使用情况", icon: .graph) { Task { await store.openUsage() } }
            item("升级套餐 ↗", icon: .card) { if let origin = store.client?.endpoint.origin, let url = URL(string: "/subscription", relativeTo: origin) { NSWorkspace.shared.open(url.absoluteURL) } }
            item("设置", icon: .settings) { Task { await store.navigate(.account) } }
        }.font(TypeStyle.ui(T.textControl))
    }
    private var notifications: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack { EPText("通知").font(TypeStyle.ui(T.textHeading, weight: .semibold)); Spacer(); Button { close() } label: { NavigationIcon(kind: .close) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel("关闭通知") }
            HStack(spacing: T.space1) {
                ForEach([("all", "全部"), ("updates", "更新日志"), ("messages", "消息")], id: \.0) { value in
                    Button(value.1) { notificationFilter = value.0 }.buttonStyle(WebSegmentStyle(selected: notificationFilter == value.0))
                }
            }.padding(T.space1).background(Palette(dark: scheme == .dark).mutedSurface, in: Capsule())
            if notificationFilter != "messages" {
                VStack(alignment: .leading, spacing: T.space2) {
                    EPText("深度研究现已上线").fontWeight(.semibold)
                    EPText("选择深度研究，自动让 Agent 规划任务，检索你的知识库并阅读网页。你可以查看来源，在文稿中继续编辑结果。")
                        .font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                }
            }
            if notificationFilter != "updates" { EPText("暂无新消息").fontWeight(.semibold) }
        }.font(TypeStyle.ui(T.textControl))
    }
    private func item(_ title: String, icon: NavigationIcon.Kind, action: @escaping () -> Void) -> some View {
        Button { close(); action() } label: {
            HStack(spacing: T.space2) { NavigationIcon(kind: icon); EPText(title); Spacer() }
                .padding(.horizontal, T.space2).frame(minHeight: T.space10)
        }.buttonStyle(WebRowStyle())
    }
    private func toggle(_ target: Panel) {
        withAnimation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.24)) { panel = panel == target ? nil : target }
        if panel == .account { Task { await store.refreshAccountMenu() } }
    }
    private func close() { let old = panel; withAnimation(reduceMotion ? nil : .easeOut(duration: 0.14)) { panel = nil }; trigger = old }
}

struct WebRowStyle: ButtonStyle {
    var radius: Double = T.radiusTag
    @Environment(\.colorScheme) private var scheme
    @State private var hovered = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle())
            .background(hovered || configuration.isPressed ? Palette(dark: scheme == .dark).strong : .clear, in: RoundedRectangle(cornerRadius: radius))
            .onHover { hovered = $0 }
    }
}
struct WebSegmentStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl)).frame(maxWidth: .infinity).frame(minHeight: T.controlHeight)
            .foregroundStyle(selected ? p.ink : p.muted).background(selected ? p.raised : .clear, in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Dismisses an anchored in-app surface on a genuine click outside its window
/// region. Returning the event keeps normal navigation/input behavior intact.
struct OutsideClickObserver: NSViewRepresentable {
    let anchor: NSView?
    let dismiss: () -> Void
    func makeNSView(context: Context) -> NSView { let view = NSView(); context.coordinator.view = view; return view }
    func updateNSView(_ view: NSView, context: Context) { context.coordinator.dismiss = dismiss; context.coordinator.anchor = anchor; context.coordinator.setActive(true) }
    func makeCoordinator() -> Coordinator { Coordinator() }
    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) { coordinator.setActive(false) }
    final class Coordinator {
        weak var view: NSView?
        weak var anchor: NSView?
        var monitor: Any?
        var dismiss: (() -> Void)?
        func setActive(_ active: Bool) {
            if !active { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil; return }
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
                guard let self, let view = self.view else { return event }
                let insidePanel = event.window === view.window && view.bounds.contains(view.convert(event.locationInWindow, from: nil))
                let insideAnchor = self.anchor.map { anchor in event.window === anchor.window && anchor.bounds.contains(anchor.convert(event.locationInWindow, from: nil)) } ?? false
                if !insidePanel && !insideAnchor { self.dismiss?() }
                return event
            }
        }
        deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
    }
}
struct NativeInteractionAnchor: NSViewRepresentable {
    let capture: (NSView) -> Void
    func makeNSView(context: Context) -> NSView { let view = NSView(); DispatchQueue.main.async { capture(view) }; return view }
    func updateNSView(_ view: NSView, context: Context) {}
}
#endif
