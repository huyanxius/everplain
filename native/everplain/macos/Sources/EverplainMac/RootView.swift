#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var historyExpanded = true
    @State private var sidebarCollapsed = false
    @State private var renameId: String?
    @State private var renameTitle = ""
    @State private var deletion: AgentConversationSummaryResponse?
    private var modalOpen: Bool { store.session != nil && (store.route == .account || store.route == .agent || store.companionTab != nil) }
    private var compact: Bool { sidebarCollapsed || store.splitSidebar }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Group {
            if store.booting {
                VStack(spacing:T.space4) { AgentLiquid(); EPText("正在确认登录状态…").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    .frame(maxWidth:.infinity,maxHeight:.infinity)
            } else if store.session == nil { LoginView() }
            else if store.profile == nil {
                VStack(spacing: T.space4) {
                    if let error = store.profileError { InlineMessage(text: error, isError: true); EPButton("重新读取伙伴设置") { Task { await store.refreshProfile() } }.buttonStyle(EPButtonStyle()) }
                    else { AgentLiquid(); EPText("正在读取伙伴设置…").foregroundStyle(.secondary) }
                }.padding(T.space8).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.welcomePresented || store.profile?.setupCompleted != true {
                WelcomeSetupView(store: store.welcome, knowledge: store.knowledge, onSettings: { Task { await store.navigate(.account) } }, onFinished: store.finishWelcomeSetup)
            } else {
                HStack(spacing: 0) {
                    HStack(spacing: 0) {
                        classicSidebar
                        if store.splitSidebar {
                            recordsRail.frame(width: store.sidebarRecordsOpen ? 200 : 0).clipped()
                                .opacity(store.sidebarRecordsOpen ? 1 : 0).allowsHitTesting(store.sidebarRecordsOpen).accessibilityHidden(!store.sidebarRecordsOpen)
                        }
                    }.zIndex(10)
                    VStack(spacing: 0) {
                        if store.unresolvedStopCount > 0 { StopRecoveryBanner().padding([.horizontal, .top], T.space4) }
                        if let message = store.error { InlineMessage(text: message, isError: true).padding([.horizontal, .top], T.space4) }
                        if let message = store.notice { InlineMessage(text: message).padding([.horizontal, .top], T.space4) }
                        let visibleRoute = store.route == .account || store.route == .agent ? store.settingsBackground : store.route
                        switch visibleRoute {
                        case .home, .chat:
                            HStack(spacing: 0) {
                                HomeConversationSurface(isHome: visibleRoute == .home)
                                if visibleRoute == .chat && store.researchPanelOpen { ConversationSourcePanel() }
                            }
                        case .library: LibraryWorkspaceView(store: store.knowledge, onGraph: { Task { await store.navigate(.graph) } }, onChat: store.openLibraryChat, chatPanel: { _ in AnyView(HomeConversationSurface(isHome: false).environmentObject(store)) }, onChatVisibilityChange: store.prepareLibraryDiscussion)
                        case .graph: PersonalGraphView(store: store.knowledge, onLibrary: { Task { await store.navigate(.library) } }, onChat: store.openLibraryChat)
                        case .research: ResearchHubView(store: store.research)
                        case .workspace: ResearchWorkspaceView()
                        case .account, .agent: EmptyView()
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(p.canvas)
                        .overlay(alignment: .topLeading) {
                            if store.splitSidebar {
                                Button { withAnimation(reduceMotion ? nil : .timingCurve(0.2, 0, 0, 1, duration: 0.3)) { store.setSidebarRecordsOpen(!store.sidebarRecordsOpen) } } label: { NavigationIcon(kind: .sidebar) }
                                    .buttonStyle(EPIconButtonStyle()).padding(.leading, T.space2).padding(.top, T.space4)
                                    .accessibilityLabel(epLocalized(store.sidebarRecordsOpen ? "收起对话与研究" : "展开对话与研究"))
                            }
                        }
                }

            }
        }
                    .disabled(modalOpen).accessibilityHidden(modalOpen)
                    .overlay {
                        if store.session != nil && (store.route == .account || store.route == .agent) {
                            ZStack {
                                T.colorOverlay(dark: scheme == .dark).color.ignoresSafeArea()
                                    .onTapGesture { if !store.saving { store.dismissSettings() } }
                                SettingsWorkspaceView(initialSection: store.settingsSection)
                            }.onExitCommand { if !store.saving { store.dismissSettings() } }
                                .onAppear { NSApp.keyWindow?.makeFirstResponder(nil) }
                        }
                    }
                    .overlay(alignment: .trailing) {
                        if store.session != nil, let tab = store.companionTab {
                            ZStack(alignment: .trailing) {
                                p.ink.opacity(0.18).ignoresSafeArea().onTapGesture { store.companionTab = nil }
                                CompanionPanel(initialTab: tab).padding(T.space3)
                            }.onExitCommand { store.companionTab = nil }
                                .onAppear { NSApp.keyWindow?.makeFirstResponder(nil) }
                        }
                    }
        .onChange(of: store.session?.user.userId) { _ in renameId = nil; renameTitle = ""; deletion = nil }
        .foregroundStyle(p.ink).background(p.canvas)
            .font(TypeStyle.ui(T.textBody))
            .tint(p.accent)
            .alert("放弃未保存的修改？", isPresented: $store.workspaceChangeNeedsConfirmation) {
                EPButton("继续编辑", role: .cancel) { store.cancelWorkspaceChange() }
                EPButton("放弃修改并切换", role: .destructive) { store.confirmWorkspaceChange() }
            } message: { EPText("切换研究会放弃当前未保存的文稿或方法修改。已保存的版本仍可在历史中查看。") }
            .sheet(isPresented:Binding(get:{renameId != nil},set:{if !$0 {renameId=nil}})) {
                VStack(alignment:.leading,spacing:T.space4) {
                    EPText("重命名对话").font(TypeStyle.reading(T.textSection))
                    TextField("标题",text:$renameTitle).textFieldStyle(.roundedBorder)
                    HStack { EPButton("取消") { renameId=nil }.keyboardShortcut(.cancelAction); Spacer(); EPButton("保存") { if let id=renameId { Task { await store.renameConversation(id,title:renameTitle); renameId=nil } } }.keyboardShortcut(.defaultAction).disabled(renameTitle.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || renameTitle.count>120 || store.saving) }
                }.padding(T.space8).frame(width:420)
            }
            .alert("删除这段对话？",isPresented:Binding(get:{deletion != nil},set:{if !$0 {deletion=nil}})) {
                EPButton("取消",role:.cancel) { deletion=nil }
                EPButton("删除",role:.destructive) { if let item=deletion { Task { await store.deleteConversation(item.conversationId) } }; deletion=nil }
            } message: { Text("这会删除“\(deletion?.title ?? "")”及其历史内容，无法从应用恢复。") }
    }
    private var classicSidebar: some View {
        let p = Palette(dark: scheme == .dark)
        return VStack(alignment: .leading, spacing: T.space1) {
                        (compact && !store.splitSidebar ? AnyLayout(VStackLayout(spacing: T.space1)) : AnyLayout(HStackLayout(spacing: T.space2))) {
                            if !compact {
                                BrandMark().fill().frame(width: 26, height: 26)
                                EPText("Everplain").font(TypeStyle.ui(T.textReading, weight: .medium))
                                Spacer(minLength: 0)
                            }
                            if compact { BrandMark().fill().frame(width: 26, height: 26) }
                            if !store.splitSidebar {
                                Button { withAnimation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.42)) { sidebarCollapsed.toggle() } } label: { NavigationIcon(kind: .sidebar) }
                                    .buttonStyle(EPIconButtonStyle()).accessibilityLabel(epLocalized(sidebarCollapsed ? "展开侧栏" : "收起侧栏"))
                            }
                        }.frame(minHeight: T.actionHeight).padding(.horizontal, T.space1)
                        nav("新对话", icon: .compose, route: .chat, newChat: true).padding(.vertical, T.space1)
                        VStack(spacing: 0) {
                            nav("首页", icon: .home, route: .home)
                            nav("知识库", icon: .library, route: .library)
                            nav("图谱", icon: .graph, route: .graph)
                            nav("研究", icon: .file, route: .research)
                        }
                        if !compact {
                            ScrollView {
                                LazyVStack(spacing: 0) {
                                    Button { historyExpanded.toggle() } label: {
                                        HStack { EPText("最近对话"); Spacer(); NavigationIcon(kind: .chevron).rotationEffect(.degrees(historyExpanded ? 90 : 0)) }
                                            .font(TypeStyle.ui(T.textControl)).foregroundStyle(p.muted).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                                    }.buttonStyle(WebRowStyle())
                                    if let message = store.historyError {
                                        EPButton("重试读取对话") { Task { await store.refreshHistory() } }.buttonStyle(EPGhostButtonStyle()).help(message)
                                    }
                                    ForEach(historyExpanded ? Array(store.conversations.prefix(20)) : [], id: \.conversationId) { item in
                                        Button { store.openConversation(item.conversationId) } label: {
                                            Text(item.title.isEmpty ? "新对话" : item.title).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                                .padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                                                .background(store.conversation?.conversationId == item.conversationId && store.route == .chat ? T.colorAccentSoft(dark: scheme == .dark).color : .clear, in: RoundedRectangle(cornerRadius: T.radiusTag))
                                        }.buttonStyle(WebRowStyle()).font(TypeStyle.ui(T.textControl))
                                            .contextMenu {
                                                EPButton("重命名") { renameId = item.conversationId; renameTitle = item.title }
                                                EPButton("删除对话", role: .destructive) { deletion = item }
                                            }
                                    }
                                }
                            }.padding(.top, T.space3)
                        } else { Spacer(minLength: 0) }
                        SidebarAccountView(collapsed: compact, split: store.splitSidebar).padding(.top, T.space2)
                    }.padding(T.space2).frame(width: compact ? 64 : 240).background(p.mutedSurface).zIndex(10)
    }
    private var recordsRail: some View {
        let p = Palette(dark: scheme == .dark)
        return VStack(alignment: .leading, spacing: 0) {
            EPText("对话与研究").font(TypeStyle.ui(T.textBody, weight: .semibold)).padding(T.space2)
                            ScrollView {
                                LazyVStack(spacing: 0) {
                                    Button { historyExpanded.toggle() } label: {
                                        HStack { EPText("最近对话"); Spacer(); NavigationIcon(kind: .chevron).rotationEffect(.degrees(historyExpanded ? 90 : 0)) }
                                            .font(TypeStyle.ui(T.textControl)).foregroundStyle(p.muted).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                                    }.buttonStyle(WebRowStyle())
                                    if let message = store.historyError {
                                        EPButton("重试读取对话") { Task { await store.refreshHistory() } }.buttonStyle(EPGhostButtonStyle()).help(message)
                                    }
                                    ForEach(historyExpanded ? Array(store.conversations.prefix(20)) : [], id: \.conversationId) { item in
                                        Button { store.openConversation(item.conversationId) } label: {
                                            Text(item.title.isEmpty ? "新对话" : item.title).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                                .padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                                                .background(store.conversation?.conversationId == item.conversationId && store.route == .chat ? T.colorAccentSoft(dark: scheme == .dark).color : .clear, in: RoundedRectangle(cornerRadius: T.radiusTag))
                                        }.buttonStyle(WebRowStyle()).font(TypeStyle.ui(T.textControl))
                                            .contextMenu {
                                                EPButton("重命名") { renameId = item.conversationId; renameTitle = item.title }
                                                EPButton("删除对话", role: .destructive) { deletion = item }
                                            }
                                    }
                                    RecentResearchSidebar(store: store.research)
                                }
                            } .padding(.top, T.space2)
        }.padding(.horizontal, T.space2).padding(.vertical, T.space4).frame(width: 200).frame(maxHeight: .infinity).background(p.canvas)
    }
    private func nav(_ title:String,icon:NavigationIcon.Kind,route:AppStore.Route,newChat:Bool=false)->some View {
        Button { Task { await store.navigate(route,newChat:newChat) } } label: {
            HStack(spacing: T.space3) { NavigationIcon(kind: icon); if !compact { EPText(title); Spacer(minLength: 0) } }.lineLimit(1).frame(maxWidth: .infinity, alignment: compact ? .center : .leading).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                .background(store.route == route && !newChat ? T.colorAccentSoft(dark:scheme == .dark).color : .clear,in:RoundedRectangle(cornerRadius:T.radiusTag))
        }.buttonStyle(WebRowStyle()).font(TypeStyle.ui(T.textControl)).help(epLocalized(title))
    }
}

private struct RecentResearchSidebar: View {
    @ObservedObject var store: ResearchStore
    @State private var expanded = true
    var body: some View {
        VStack(spacing: 0) {
            Button { expanded.toggle() } label: {
                HStack { EPText("最近研究"); Spacer(); NavigationIcon(kind: .chevron).rotationEffect(.degrees(expanded ? 90 : 0)) }
                    .foregroundStyle(.secondary).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
            }.buttonStyle(WebRowStyle())
            if expanded {
                if store.loading { EPText("正在读取").foregroundStyle(.secondary).padding(.horizontal, T.space2) }
                else if store.error != nil { EPButton("重试读取研究") { Task { await store.load() } }.buttonStyle(EPGhostButtonStyle()) }
                ForEach(Array(store.projects.prefix(8)), id: \.taskId) { item in
                    Button { store.openWorkspace(item.taskId) } label: {
                        Text(ResearchStore.title(item)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                    }.buttonStyle(WebRowStyle())
                }
                if !store.loading && store.error == nil && store.projects.isEmpty { EPText("还没有研究记录").foregroundStyle(.secondary).padding(.horizontal, T.space2) }
            }
        }.font(TypeStyle.ui(T.textControl))
    }
}

private struct StopRecoveryBanner: View {
    @EnvironmentObject private var store: AppStore
    @State private var confirmEnd = false
    var body: some View {
        VStack(alignment: .leading, spacing: T.space2) {
            HStack {
                Label("有 \(store.unresolvedStopCount) 次停止结果待核对", systemImage: "clock.arrow.circlepath")
                    .font(TypeStyle.ui(T.textMeta))
                Spacer()
                if store.stopping { ProgressView().controlSize(.small) }
                EPButton("结束本次等待") { confirmEnd = true }.buttonStyle(.plain).font(TypeStyle.ui(T.textMeta))
            }
            ForEach(store.stopRecords.filter { $0.confirmation.isPending }, id: \.turn.key) { record in
                HStack {
                    Text(record.turn.request.message).lineLimit(1).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    Spacer()
                    EPButton("查看记录") { store.showStopRecord(record.turn.key) }.buttonStyle(.plain).disabled(store.running)
                    EPButton("重新核对") { store.recheckStop(record.turn.key) }.buttonStyle(.plain).disabled(store.running)
                }.font(TypeStyle.ui(T.textMeta))
            }
        }.padding(T.space3).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: T.radiusItem))
            .alert("结束本次等待？", isPresented: $confirmEnd) {
                EPButton("继续等待", role: .cancel) {}
                EPButton("结束本次等待") {
                    store.endStopWaiting()
                    store.notice = "仅结束了本机等待，服务端状态仍未确认。原请求已保留，可以稍后核对；新建另一对话会使用新的请求。"
                }
            } message: {
                EPText("这只解除本地等待，不代表服务器已经停止。原请求和标识仍会按账户保留，不会自动重新发送。你可以稍后重新核对，或明确新建另一对话。")
            }
    }
}
#endif
