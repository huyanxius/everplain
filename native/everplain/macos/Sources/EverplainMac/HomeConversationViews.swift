#if os(macOS)
import AppKit
import SwiftUI
import EverplainCore

/// Route content supplies a destination rectangle; the live NSTextView lives outside it.
/// Never put an .id(isHome), conditional Composer, or read-only edit lock on this surface.
struct HomeConversationSurface: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var composerHeight: CGFloat = 56
    @State private var homeScrollOffset: CGFloat = 0
    let isHome: Bool
    private var empty: Bool { store.conversation == nil && store.unfinishedTurns.isEmpty && !store.loadingConversation }
    var body: some View {
        GeometryReader { geometry in
            Group {
                if isHome { homeContent(geometry) }
                else {
                    VStack(spacing: 0) {
                        ConversationHeader(empty: empty).padding(.leading, store.splitSidebar && store.route != .library && store.route != .workspace ? T.space12 : 0)
                        if !empty && !store.loadingConversation { CompanionStatusBar() }
                        VStack(spacing: 0) {
                            if empty { Spacer(minLength: 0) }
                            if store.loadingConversation {
                                VStack(spacing: T.space4) {
                                    AgentLiquid(lead: store.profile?.avatarId, color: store.profile?.color)
                                    EPText("正在读取对话…").font(TypeStyle.ui(T.textBody)).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                            } else if empty {
                                VStack(spacing: T.space5) {
                                    AgentAvatar(id: store.profile?.avatarId ?? "shi", color: store.profile?.color ?? "#e55f6f", size: 96, state: .greet)
                                    ConversationGreetingText().multilineTextAlignment(.center)
                                }.padding(.horizontal, T.space4).padding(.top, T.space4).padding(.bottom, T.space6)
                            } else { ConversationThreadView() }
                            composerDestination
                                .padding(.horizontal, T.space6).padding(.top, T.space3).padding(.bottom, T.space4)
                                .frame(maxWidth: empty ? 768 : 780)
                            if empty { Spacer(minLength: T.space16) }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
            .overlayPreferenceValue(ComposerDestination.self) { anchor in
                GeometryReader { proxy in
                    let rect = anchor.map { proxy[$0] } ?? CGRect(x: 24, y: max(0, proxy.size.height - 72), width: max(0, proxy.size.width - 48), height: composerHeight)
                    Composer(home: isHome)
                        .background(GeometryReader { composer in Color.clear.preference(key: ComposerHeight.self, value: composer.size.height) })
                        .frame(width: rect.width)
                        .position(x: rect.midX, y: rect.minY + composerHeight / 2)
                        .animation(reducedMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.42), value: rect.origin)
                        .animation(reducedMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.42), value: rect.width)
                }
            }
            .onPreferenceChange(ComposerHeight.self) { if $0 > 0 && abs(composerHeight - $0) > 0.5 { composerHeight = $0 } }
        }
    }
    private var composerDestination: some View {
        Color.clear.frame(height: composerHeight).anchorPreference(key: ComposerDestination.self, value: .bounds) { $0 }
    }
    private func homeContent(_ geometry: GeometryProxy) -> some View {
        let viewport = NSApp.keyWindow?.frame.width ?? geometry.size.width + T.outlineWidth
        let contentWidth = max(0, min(1120, geometry.size.width) - T.space10 * 2)
        let columnWidth = viewport > 1100 ? max(0, (contentWidth - T.space16) / 2) : contentWidth
        return ScrollView {
            HStack(alignment: .top, spacing: T.space16) {
                VStack(alignment: .leading, spacing: T.space4) {
                    if let profile = store.profile {
                        AgentAvatar(id: profile.avatarId, color: profile.color, size: 72, state: .greet)
                            .accessibilityLabel(profile.name).accessibilityHidden(false)
                    }
                    ConversationGreetingText().padding(.top, T.space2)
                    Group {
                        if let profileError = store.profileError {
                            InlineMessage(text: profileError, isError: true)
                            EPButton("重新读取伙伴设置") { Task { await store.refreshProfile() } }.buttonStyle(EPGhostButtonStyle())
                        } else {
                            HomeStatusSummary()
                        }
                    }.padding(.bottom, T.space4)
                    composerDestination
                    HStack(spacing: T.space2) {
                        homePrompt("找回以前收藏过的资料", prompt: "帮我找回以前收藏过的资料")
                        homePrompt("把资料串起来", prompt: "帮我把资料之间的联系整理一下")
                    }
                    if viewport <= 1100 { HomeOverview().padding(.top, T.space8) }
                }.frame(width: columnWidth, alignment: .leading).offset(y: viewport > 1100 ? max(0, -homeScrollOffset) : 0)
                if viewport > 1100 { HomeOverview().frame(width: columnWidth, alignment: .leading) }
            }
            .padding(.horizontal, T.space10).padding(.top, max(T.space10, geometry.size.height * 0.14)).padding(.bottom, T.space6)
            .frame(maxWidth: 1120).frame(maxWidth: .infinity, alignment: .center)
            .background(GeometryReader { content in Color.clear.preference(key: HomeScrollOffset.self, value: content.frame(in: .named("home-scroll")).minY) })
        }.coordinateSpace(name: "home-scroll").onPreferenceChange(HomeScrollOffset.self) { homeScrollOffset = $0 }
    }
    private func homePrompt(_ title: String, prompt: String) -> some View {
        Button { store.composer = prompt; store.focusComposer = UUID() } label: {
            Text(title).font(TypeStyle.ui(T.textMeta)).padding(.horizontal, T.space4).frame(minHeight: 32)
                .overlay(Capsule().stroke(Palette(dark: scheme == .dark).rule, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}
private struct ComposerDestination: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) { value = nextValue() ?? value }
}
private struct HomeScrollOffset: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct ComposerHeight: PreferenceKey {
    static var defaultValue: CGFloat = 56
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
// Legacy entry points are kept for previews; RootView mounts HomeConversationSurface directly.
struct HomeView: View { var body: some View { HomeConversationSurface(isHome: true) } }
struct ConversationView: View { var body: some View { HomeConversationSurface(isHome: false) } }

/// Exact daypart greeting choices and calendar-index selection from researchPrompts.ts.
/// A late history response does not replace a greeting already selected for this owner/daypart.
private struct ConversationGreetingText: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text(ConversationGreeting.text(date: context.date, locale: store.account?.preferences.locale ?? "zh-CN",
                                           hasHistory: store.conversations.contains { $0.turnCount > 0 }, owner: store.session?.user.userId ?? ""))
                .font(TypeStyle.reading(T.textDisplay).weight(.medium)).tracking(T.textDisplay * T.textDisplayLetterSpacingEm)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
private enum ConversationGreeting {
    private static var historyByPeriod: [String: Bool] = [:]
    static func text(date: Date, locale: String, hasHistory: Bool, owner: String) -> String {
        let calendar = Calendar.current
        let hour = calendar.component(.hour, from: date)
        let daypart = hour >= 6 && hour < 11 ? "morning" : hour >= 11 && hour < 14 ? "noon" : hour >= 14 && hour < 18 ? "afternoon" : hour >= 18 && hour < 23 ? "evening" : "night"
        let hello = ("来啦。", "Oh, hello."), chance = ("这么巧，你也在。", "Fancy meeting you here."), waiting = ("恭候多时。", "At your service.")
        let pools = ["morning": [("太阳已到岗。", "The sun has clocked in."), hello, chance, waiting],
                     "noon": [("偷得浮生半日闲。", "A little pause in a busy day."), hello, chance, waiting],
                     "afternoon": [hello, chance, waiting],
                     "evening": [("今晚我值班。", "I am on duty tonight."), hello, chance, waiting],
                     "night": [("月亮值班中。", "The moon is on duty."), ("夜猫子，集合。", "Night owls, assemble."), ("今晚我值班。", "I am on duty tonight."), waiting]]
        let day = calendar.component(.year, from: date) * 372 + (calendar.component(.month, from: date) - 1) * 31 + calendar.component(.day, from: date)
        let key = "\(owner):\(day):\(daypart)"
        let history = historyByPeriod[key] ?? hasHistory
        historyByPeriod[key] = history
        var choices = pools[daypart]!
        if history { choices += [("你回来啦。", "There you are again."), ("别来无恙。", "Good to see you again.")] }
        let selected = choices[day % choices.count]
        return locale == "en-US" ? selected.1 : selected.0
    }
}

private struct ConversationHeader: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var moreOpen = false
    @FocusState private var moreFocused: Bool
    @FocusState private var modeFocused: String?
    let empty: Bool
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        ConversationHeaderLayout {
            Text(empty ? "" : store.conversation?.title ?? "新对话")
                .font(TypeStyle.reading(T.textHeading).weight(.medium)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                Button { store.setComposerMode("standard") } label: {
                    AgentAvatar(id: store.profile?.avatarId ?? "shi", color: store.profile?.color ?? "#e55f6f", size: 32, state: store.running ? .work : .idle)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(store.composerMode == "standard" ? p.surface : .clear, in: Capsule())
                }.buttonStyle(.plain).accessibilityLabel("Chat").focused($modeFocused, equals: "standard")
                    .onMoveCommand { direction in if direction == .right && !store.running { store.setComposerMode("deep_research"); modeFocused = "deep_research" } }
                Button { store.setComposerMode("deep_research") } label: {
                    EPText("研究").font(TypeStyle.ui(T.textControl)).padding(.horizontal, 12).frame(height: 40)
                        .background(store.composerMode == "deep_research" ? p.surface : .clear, in: Capsule())
                }.buttonStyle(.plain).accessibilityLabel("Research").focused($modeFocused, equals: "deep_research")
                    .onMoveCommand { direction in if direction == .left && !store.running { store.setComposerMode("standard"); modeFocused = "standard" } }
            }.padding(4).background(p.strong, in: Capsule()).disabled(store.running)
            Button { moreFocused = false; moreOpen.toggle() } label: { WebIcon(name: .dotsThree) }
                .buttonStyle(EPIconButtonStyle()).focused($moreFocused).accessibilityLabel("更多对话操作")
                .background(NativeAnchoredPopover(isPresented: $moreOpen, content: AnyView(ConversationMoreMenu(close: { moreOpen = false }).environmentObject(store)),
                                                 width: 240, label: "更多对话操作", dark: scheme == .dark, reducedMotion: reducedMotion, onEscape: { moreFocused = true }))
        }.padding(.horizontal, T.space6).frame(height: 72)
    }
}
private struct ConversationHeaderLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { CGSize(width: proposal.width ?? 800, height: 72) }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 3 else { return }
        let center = subviews[1].sizeThatFits(.unspecified)
        let sideWidth = max(0, (bounds.width - center.width - 24) / 2)
        subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading, proposal: ProposedViewSize(width: sideWidth, height: 48))
        subviews[1].place(at: CGPoint(x: bounds.midX, y: bounds.midY), anchor: .center, proposal: ProposedViewSize(center))
        subviews[2].place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing, proposal: ProposedViewSize(width: 36, height: 36))
    }
}
private struct CompanionStatusBar: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        HStack(spacing: T.space3) {
            AgentAvatar(id: store.profile?.avatarId ?? "shi", color: store.profile?.color ?? "#e55f6f", size: 40, state: store.running ? .work : .idle)
            VStack(alignment: .leading, spacing: T.space1) {
                Text(store.profile?.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? store.agentName : "Everplain")
                    .font(TypeStyle.ui(T.textControl, weight: .medium))
                Text(status).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            }
        }.frame(minHeight: 56).accessibilityElement(children: .combine).accessibilityLabel("Agent 状态")
    }
    private var status: String {
        if store.isCurrentStopPending { return store.stopping ? "正在暂停" : "暂停待重试" }
        if store.running { return store.pending?.answer.isEmpty == false ? "正在回复" : "正在思考" }
        return store.pending == nil ? "等待消息" : "需要重试"
    }
}

private struct ChatTurn: Identifiable {
    let id: String
    let question: String
    let answer: String
    var citations: [AgentCitationResponse] = []
    var toolSteps: [ChatActivityStep] = []
    var streaming = false
    var statusText = "正在思考"
    var pendingKey: String?
    var pendingStatus: String?
}
private struct ConversationThreadView: View {
    @EnvironmentObject private var store: AppStore
    @State private var followLatest = true
    private var turns: [ChatTurn] {
        var result = (store.conversation?.turns ?? []).map { turn in
            ChatTurn(id: turn.turnId == store.completedTurnId ? (store.completedPendingTurn?.key ?? turn.turnId) : turn.turnId,
                     question: turn.user.content, answer: turn.assistant.content, citations: turn.assistant.citations ?? [],
                     toolSteps: ChatActivityStep.persisted(turn.toolTraces ?? []))
        }
        for unfinished in store.unfinishedTurns {
            result.append(ChatTurn(id: unfinished.key, question: unfinished.request.message, answer: unfinished.answer,
                                   citations: unfinished.citations ?? [], toolSteps: (unfinished.toolSteps ?? []).map(ChatActivityStep.init),
                                   streaming: store.running && store.pending?.key == unfinished.key, statusText: unfinished.statusText,
                                   pendingKey: unfinished.key, pendingStatus: unfinished.status))
        }
        return result
    }
    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: T.space8) {
                    ForEach(turns) { turn in ConversationTurnView(turn: turn) }
                    if let research = store.pending?.research { NativeResearchFlow(progress: research).id("\(store.pending?.key ?? ""): \(research.stage):\(research.question)") }
                    Color.clear.frame(height: 1).id("latest")
                }.padding(.horizontal, T.space6).padding(.top, T.space6).padding(.bottom, T.space8).frame(maxWidth: 780).frame(maxWidth: .infinity)
            }
            .onAppear { reader.scrollTo("latest", anchor: .bottom) }
            .onChange(of: store.pending?.answer) { _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: store.conversation?.turnCount) { _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
        }
    }
}
private struct ConversationTurnView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    let turn: ChatTurn
    @State private var pacer = ConversationStreamPacer()
    @State private var copied = false
    private var avatarState: AgentAvatar.MotionState { !turn.streaming ? .idle : turn.answer.isEmpty && !turn.toolSteps.contains(where: { $0.status == "running" }) ? .think : .work }
    var body: some View {
        VStack(alignment: .leading, spacing: T.space8) {
            UserBubbleRow { SendFlightBubble(text: turn.question, eligible: turn.streaming) }
            HStack(alignment: .top, spacing: T.space4) {
                AgentAvatar(id: store.profile?.avatarId ?? "shi", color: store.profile?.color ?? "#e55f6f", size: 32, state: avatarState)
                VStack(alignment: .leading, spacing: T.space4) {
                    ConversationThinking(active: turn.streaming && turn.answer.isEmpty, text: turn.statusText)
                    if !turn.toolSteps.isEmpty { NativeConversationActivity(steps: turn.toolSteps) }
                    if !pacer.visible.isEmpty || (reducedMotion && !turn.answer.isEmpty) {
                        TimelineView(.animation(minimumInterval: 1 / 30, paused: !pacer.needsTicks || reducedMotion)) { timeline in
                            NativeMarkdown(content: reducedMotion ? turn.answer : pacer.visible, revealedAt: reducedMotion ? [] : pacer.revealedAt,
                                           now: timeline.date.timeIntervalSinceReferenceDate, agentColor: store.profile?.color ?? "#e55f6f",
                                           citations: turn.citations, onSelectCitation: store.selectCitation)
                        }
                    }
                    if !turn.citations.isEmpty { CitationFlow {
                    ForEach(Array(turn.citations.enumerated()), id: \.element.citationId) { item in
                        Button { store.selectCitation(item.element) } label: {
                            HStack(spacing: 6) {
                                Text("\(item.offset + 1)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(Palette(dark: scheme == .dark).onAccent)
                                    .frame(width: 18, height: 18).background(Palette(dark: scheme == .dark).accent, in: Circle())
                                Text(item.element.label).font(TypeStyle.ui(T.textMeta)).lineLimit(1)
                            }.padding(.horizontal, 8).padding(.vertical, 4)
                                .overlay(Capsule().stroke(Palette(dark: scheme == .dark).rule, lineWidth: 1))
                        }.buttonStyle(.plain).accessibilityLabel("查看证据：\(item.element.label)")
                    }
                    } }
                    if !turn.streaming && !turn.answer.isEmpty {
                        HStack(spacing: 4) {
                        Button {
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(ConversationCitations.displayText(turn.answer), forType: .string)
                            copied = true
                            Task { try? await Task.sleep(nanoseconds: 1_600_000_000); copied = false }
                        } label: {
                            WebIcon(name: copied ? .check : .copy)
                        }.buttonStyle(EPIconButtonStyle()).help(copied ? "已复制" : "复制回答").accessibilityLabel(copied ? "已复制" : "复制回答")
                        if turn.pendingKey == nil {
                            Button { store.regenerateTurn(question: turn.question) } label: { WebIcon(name: .arrowClockwise) }
                                .buttonStyle(EPIconButtonStyle()).disabled(store.running || store.isCurrentStopPending)
                                .help("重新生成").accessibilityLabel("重新生成")
                        }
                        }
                    }
                    if let key = turn.pendingKey, !turn.streaming {
                        unfinishedActions(key: key)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { updatePacer() }
        .onChange(of: turn.answer) { _ in updatePacer() }
        .onChange(of: turn.streaming) { _ in updatePacer() }
        .onChange(of: reducedMotion) { _ in updatePacer() }
        .task(id: pacer.needsTicks) {
            guard pacer.needsTicks else { return }
            while !Task.isCancelled && pacer.needsTicks {
                try? await Task.sleep(nanoseconds: 48_000_000)
                guard !Task.isCancelled else { return }
                pacer.tick(now: Date().timeIntervalSinceReferenceDate)
            }
        }
    }
    @ViewBuilder private func unfinishedActions(key: String) -> some View {
        if store.isStopPending(for: key) {
            VStack(alignment: .leading, spacing: 8) {
                EPText("这轮停止结果仍待核对。此处仅显示保留记录，不会重新发送。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                EPButton("重新核对") { store.recheckStop(key) }.buttonStyle(EPGhostButtonStyle()).disabled(store.running || store.loadingConversation)
            }
        } else if turn.pendingStatus?.hasPrefix("awaiting_") == true {
            EPButton("查看研究确认") { store.selectUnfinishedTurn(key) }
                .buttonStyle(EPGhostButtonStyle()).disabled(store.running || store.loadingConversation)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if turn.pendingStatus == "failed" || turn.pendingStatus == "interrupted" {
                    EPText("这轮回答未完成，可以从保存的位置重试。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    EPButton(turn.pendingStatus == "running" ? "重新连接" : "重试本轮") { store.retry(key) }
                        .buttonStyle(EPGhostButtonStyle()).disabled(!store.canRetryUnfinishedTurn(key))
                    EPButton("重新核对") { Task { await store.refreshUnfinishedTurns() } }
                        .buttonStyle(EPGhostButtonStyle()).disabled(store.running || store.loadingConversation)
                }
            }
        }
    }
    private func updatePacer() { pacer.update(answer: turn.answer, streaming: turn.streaming, reducedMotion: reducedMotion) }
}

private struct CitationFlow: Layout {
    private func positions(width: CGFloat, subviews: Subviews) -> ([CGPoint], CGSize) {
        var points: [CGPoint] = [], x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + 8; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y)); x += size.width + 8; rowHeight = max(rowHeight, size.height)
        }
        return (points, CGSize(width: width, height: y + rowHeight))
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        positions(width: proposal.width ?? 600, subviews: subviews).1
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let points = positions(width: bounds.width, subviews: subviews).0
        for index in subviews.indices {
            subviews[index].place(at: CGPoint(x: bounds.minX + points[index].x, y: bounds.minY + points[index].y),
                                  anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: nil))
        }
    }
}

private struct UserBubbleRow: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 732
        let bubble = subviews.first?.sizeThatFits(ProposedViewSize(width: min(width * 0.8, 576), height: nil)) ?? .zero
        return CGSize(width: width, height: bubble.height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let bubble = subviews.first else { return }
        let proposed = ProposedViewSize(width: min(bounds.width * 0.8, 576), height: nil)
        let size = bubble.sizeThatFits(proposed)
        bubble.place(at: CGPoint(x: bounds.maxX, y: bounds.minY), anchor: .topTrailing, proposal: ProposedViewSize(size))
    }
}
#endif
