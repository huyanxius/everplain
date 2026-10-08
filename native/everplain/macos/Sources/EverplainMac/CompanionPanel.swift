#if os(macOS)
import SwiftUI

struct CompanionPanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var tab: String
    @State private var memoryVisited = false
    @FocusState private var focusedTab: String?
    init(initialTab: String) { _tab = State(initialValue: initialTab) }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        let profile = store.agentDraftPreview ?? store.profile
        let draftName = profile?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let displayName = draftName.isEmpty ? store.profile?.name ?? epLocalized("我的 AI 伙伴") : draftName
        VStack(spacing: 0) {
            HStack { EPText("我的 AI 伙伴").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted); Spacer(); Button { store.companionTab = nil } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel(epLocalized("关闭角色面板")) }
                .padding(.horizontal, T.space5).padding(.vertical, T.space3)
            HStack(spacing: T.space3) {
                AgentAvatar(id: profile?.avatarId ?? "cheng", color: profile?.color ?? AgentAvatar.presets[0].color, size: 56, state: .greet)
                    .frame(width: 64, height: 64).background(p.mutedSurface, in: Circle())
                VStack(alignment: .leading, spacing: T.space1) {
                    Text(displayName).font(TypeStyle.ui(T.textBody, weight: .semibold))
                    EPText(store.displayName.isEmpty ? "为你整理知识，一起探索想法" : "\(store.displayName) 的 AI 伙伴").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.padding(.horizontal, T.space5).padding(.bottom, T.space3)
            HStack(spacing: T.space1) {
                Button { tab = "identity" } label: { Label { EPText("Soul · 人格") } icon: { WebIcon(name: .fingerprint) } }.buttonStyle(WebSegmentStyle(selected: tab == "identity")).focused($focusedTab, equals: "identity")
                Button { tab = "memory"; memoryVisited = true } label: { Label { EPText("Memory · 记忆") } icon: { WebIcon(name: .brain) } }.buttonStyle(WebSegmentStyle(selected: tab == "memory")).focused($focusedTab, equals: "memory")
            }.padding(T.space1).background(p.mutedSurface, in: Capsule()).padding(.horizontal, T.space5).padding(.bottom, T.space3)
            ZStack(alignment: .top) {
                AgentSettingsPanel(active: tab == "identity", companion: true).id(store.session?.user.userId)
                    .frame(height: tab == "identity" ? nil : 0).clipped().opacity(tab == "identity" ? 1 : 0).allowsHitTesting(tab == "identity").accessibilityHidden(tab != "identity")
                if memoryVisited {
                    ScrollView { ResearchMemoryView(store: store.memory).padding(.horizontal, T.space5).padding(.bottom, T.space5) }
                        .frame(height: tab == "memory" ? nil : 0).clipped().opacity(tab == "memory" ? 1 : 0).allowsHitTesting(tab == "memory").accessibilityHidden(tab != "memory")
                }
            }.frame(maxHeight: .infinity)
        }.frame(width: 440).frame(maxHeight: .infinity).background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusPanel))
            .overlay(RoundedRectangle(cornerRadius: T.radiusPanel).stroke(p.rule, lineWidth: 1))
            .shadow(color: T.shadowCard(dark: scheme == .dark).last!.color.color, radius: 16, y: 8)
            .onAppear { memoryVisited = tab == "memory" }
            .onChange(of: store.companionTab) { value in if let value { tab = value; if value == "memory" { memoryVisited = true } } }
            .onMoveCommand { direction in if focusedTab != nil, direction == .left || direction == .right { tab = tab == "identity" ? "memory" : "identity"; if tab == "memory" { memoryVisited = true }; focusedTab = tab } }
            .onExitCommand { store.companionTab = nil }
    }
}
#endif
