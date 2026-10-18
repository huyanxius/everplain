#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

struct AccountView: View { var body: some View { SettingsWorkspaceView(initialSection: .profile) } }
struct AgentSettingsView: View { var body: some View { SettingsWorkspaceView(initialSection: .agent) } }

enum SettingsSection: String, CaseIterable, Identifiable {
    case agent, channels, profile, usage, preferences, security, privacy, danger
    var id: String { rawValue }
    var title: String {
        switch self { case .agent: return "我的 Agent"; case .channels: return "聊天平台"; case .profile: return "个人资料"; case .usage: return "使用情况"; case .preferences: return "使用偏好"; case .security: return "安全"; case .privacy: return "数据与隐私"; case .danger: return "账户状态" }
    }
    // Account-only glyphs use the exact captured Phosphor regular geometry.
    var icon: WebIconName {
        switch self { case .agent: return .smiley; case .channels: return .list; case .profile: return .user; case .usage: return .chartBar; case .preferences: return .gearSix; case .security: return .lockSimple; case .privacy: return .lockSimple; case .danger: return .user }
    }
}

struct SettingsWorkspaceView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var section: SettingsSection
    init(initialSection: SettingsSection) { _section = State(initialValue: initialSection) }
    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 640
            VStack(spacing: T.space4) {
                HStack(spacing: T.space3) {
                    AgentAvatar(id: store.profile?.avatarId ?? "cheng", color: store.profile?.color ?? AgentAvatar.presets[0].color, size: 40)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(store.agentName).font(TypeStyle.ui(T.textControl, weight: .semibold))
                        if !store.displayName.isEmpty && store.displayName != store.agentName { Text(store.displayName).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    }.lineLimit(1)
                    Spacer()
                    Button { store.dismissSettings() } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel(epLocalized("关闭账户设置")).disabled(store.saving).keyboardShortcut(.cancelAction)
                }
                if compact {
                    WebSelect(label: epLocalized("设置分类"), selection: Binding(get: { section.rawValue }, set: { if let next = SettingsSection(rawValue: $0) { section = next } }), options: SettingsSection.allCases.map { ($0.rawValue, epLocalized($0.title)) }).zIndex(10)
                    panel
                    logoutButton
                } else {
                    HStack(alignment: .top, spacing: T.space5) {
                        VStack(spacing: T.space3) {
                            VStack(spacing: 2) { ForEach(SettingsSection.allCases) { item in
                                Button { section = item } label: {
                                    HStack(spacing: T.space2) { AccountSectionIcon(section: item); EPText(item.title) }.frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize)
                                        .background(section == item ? Palette(dark: scheme == .dark).strong : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
                                }.buttonStyle(.plain).accessibilityAddTraits(section == item ? .isSelected : [])
                            } }
                            Spacer(minLength: T.space3)
                            logoutButton
                        }.padding(T.space2).frame(width: 184).frame(maxHeight: .infinity)
                            .background(Palette(dark: scheme == .dark).mutedSurface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                        panel
                    }
                }
            }.padding(compact ? T.space4 : T.space6)
                .frame(width: max(0, min(760, geometry.size.width - (compact ? 16 : 48))), height: max(0, min(480, geometry.size.height - (compact ? 16 : 48))))
                .background(Palette(dark: scheme == .dark).raised, in: RoundedRectangle(cornerRadius: T.radiusModal))
                .overlay(RoundedRectangle(cornerRadius: T.radiusModal).stroke(Palette(dark: scheme == .dark).ring, lineWidth: 1))
                .shadow(color: T.shadowPanel(dark: scheme == .dark).last!.color.color, radius: 32, y: 24)
                .font(TypeStyle.ui(T.textControl)).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: store.settingsSection) { value in section = value }
    }
    private var logoutButton: some View {
        Button { Task { await store.logout() } } label: { Label { EPText("退出登录") } icon: { WebIcon(name: .signOut) }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, T.space2).frame(minHeight: T.iconControlSize) }.buttonStyle(.plain).disabled(store.saving)
    }
    private var panel: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: T.space3) {
                    EPText(section.title).font(TypeStyle.ui(T.textTitle, weight: .medium)).padding(.bottom, T.space1).id("settings-top")
                    ZStack(alignment: .topLeading) {
                        AgentSettingsPanel(active: section == .agent).id(store.session?.user.userId).frame(height: section == .agent ? nil : 0).clipped().opacity(section == .agent ? 1 : 0).allowsHitTesting(section == .agent).accessibilityHidden(section != .agent)
                        AccountSettingsPanel(section: section, management: store.accountManagement).id(store.session?.user.userId).frame(height: section == .agent ? 0 : nil).clipped().opacity(section == .agent ? 0 : 1).allowsHitTesting(section != .agent).accessibilityHidden(section == .agent)
                    }
                }.padding(.leading, T.space1).padding([.top, .bottom, .trailing], T.space2).frame(maxWidth: .infinity, alignment: .leading)
            }.onChange(of: section) { _ in reader.scrollTo("settings-top", anchor: .top) }
        }
    }
}

private struct AccountPageLoading: View {
    @EnvironmentObject private var store: AppStore
    let message: String
    var body: some View {
        VStack(spacing: T.space5) {
            AgentLiquid(lead: store.profile?.avatarId, color: store.profile?.color)
            EPText(message).font(TypeStyle.ui(T.textBody)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, minHeight: 240)
    }
}

private struct AccountSectionIcon: View {
    let section: SettingsSection
    var body: some View {
        Group {
            if section == .channels { AccountSourceIcon(kind: "ChatsCircle") }
            else if section == .privacy { AccountSourceIcon(kind: "Shield") }
            else if section == .danger { AccountSourceIcon(kind: "UserGear") }
            else { WebIcon(name: section.icon) }
        }.frame(width: 20, height: 20).accessibilityHidden(true)
    }
}

private struct SettingRow<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content
    var body: some View {
        HStack(alignment: .top, spacing: T.space4) {
            EPText(label).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.top, T.space2).frame(width: 100, alignment: .leading)
            VStack(alignment: .leading, spacing: T.space2) { content }.frame(maxWidth: .infinity, alignment: .leading)
        }.frame(minHeight: T.actionHeight, alignment: .top).padding(.vertical, T.space2)
    }
}

private enum AccountConfirmation: Identifiable {
    case session(AccountSessionResponse), model(Bool, AccountPreferencesResponse), deactivate, delete
    var id: String { switch self { case .session(let value): return "session-" + value.sessionId; case .model: return "model"; case .deactivate: return "deactivate"; case .delete: return "delete" } }
}

private struct AccountSettingsPanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let section: SettingsSection
    @ObservedObject var management: AccountManagementStore
    @State private var name = ""
    @State private var locale = "zh-CN"
    @State private var timezone = "UTC"
    @State private var loadedOwner: String?
    @State private var nameVersion = 0
    @State private var preferencesVersion = 0
    @State private var editingName = false
    @State private var reloadAccount = false
    @State private var confirmation: AccountConfirmation?
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var revokeOtherSessions = true
    @State private var passwordError: String?
    @State private var actionPassword = ""
    @State private var deletionEmail = ""
    @State private var deactivationReason = ""
    var body: some View {
        VStack(alignment: .leading, spacing: T.space3) {
            if let feedback = management.feedback { InlineMessage(text: epLocalized(feedback), isError: false) }
            if let error = management.error, confirmation == nil { InlineMessage(text: epLocalized(error), isError: true) }
            if let error = store.accountError {
                InlineMessage(text: epLocalized(error), isError: true)
                EPButton("重新读取") { reloadAccount = true }.buttonStyle(EPButtonStyle())
            }
            if let account = store.account {
                switch section {
                case .profile: profilePanel(account)
                case .usage: usagePanel
                case .preferences: preferencesPanel
                case .security: securityPanel
                case .privacy: privacyPanel(account)
                case .danger: accountStatusPanel(account)
                case .channels: ChatPlatformsPanel(management: management)
                case .agent: EmptyView()
                }
            } else if store.accountError == nil { AccountPageLoading(message: "正在读取账户设置") }
        }.disabled(store.saving || management.busy)
        .onAppear { if loadedOwner != store.account?.userId { loadFields() }; management.seedCredits(store.credits) }
        .onChange(of: store.account?.userId) { _ in if loadedOwner != store.account?.userId { clearSecrets(); loadFields() } }
        .onChange(of: section) { _ in management.clearMessages(); passwordError = nil }
        .onDisappear { clearSecrets() }
        .task(id: section) { if section == .usage { await management.loadCredits() } }
        .alert(epLocalized("读取最新账户设置？"), isPresented: $reloadAccount) {
            Button(epLocalized("取消"), role: .cancel) {}
            Button(epLocalized("重新读取")) { Task { await store.refreshAccount(); if store.accountError == nil { loadFields() } } }
        } message: { EPText("这会替换此页尚未保存的编辑。") }
        .sheet(item: $confirmation, onDismiss: { actionPassword = ""; deletionEmail = ""; deactivationReason = "" }) { action in confirmationPanel(action) }
    }
    private func profilePanel(_ account: AccountResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space5) {
            VStack(spacing: T.space2) {
                SettingRow(label: "显示名称") {
                    if editingName {
                        EPTextField("显示名称", text: $name).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("显示名称"))
                        HStack { Spacer(); EPButton("取消") { name = account.displayName ?? ""; editingName = false }.buttonStyle(EPButtonStyle())
                            EPButton("保存资料") { Task { if await store.saveAccount(name: name.trimmingCharacters(in: .whitespacesAndNewlines), expectedVersion: nameVersion) { nameVersion = store.account?.version ?? nameVersion; editingName = false } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 80)
                        }
                    } else { HStack { Text(account.displayName ?? epLocalized("研究者")); Spacer(); EPButton("修改") { nameVersion = account.version; editingName = true }.buttonStyle(EPButtonStyle()).accessibilityLabel(epLocalized("修改显示名称")) } }
                }
                SettingRow(label: "邮箱") { Text(account.email).textSelection(.enabled); EPText("变更请联系管理员").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            }.padding(T.space4).background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: T.radiusCard)).overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(Palette(dark: scheme == .dark).ring, lineWidth: 1))
            HStack(alignment: .top, spacing: T.space4) { metadata("账户类型", account.role == "admin" ? "管理员" : "个人账户"); metadata("加入时间", Self.date(account.createdAt)) }.padding(.horizontal, T.space4)
        }
    }
    private func metadata(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: T.space2) { EPText(title).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); EPText(value) }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var preferencesPanel: some View {
        VStack(spacing: 0) {
            SettingRow(label: "外观") {
                HStack(spacing: T.space1) { ForEach(["system", "light", "dark"], id: \.self) { value in EPButton(["system":"跟随系统", "light":"浅色", "dark":"深色"][value]!) { store.setAppearance(value) }.buttonStyle(SelectionButtonStyle(selected: store.appearance == value)) } }.padding(T.space1).background(Palette(dark: scheme == .dark).strong, in: Capsule())
            }
            SettingRow(label: "新侧栏布局") { WebToggle(label: epLocalized("新侧栏布局"), value: store.splitSidebar) { store.setSplitSidebar(!store.splitSidebar) } }
            SettingRow(label: "界面语言") { WebSelect(label: epLocalized("界面语言"), selection: Binding(get: { locale }, set: { locale = $0; store.setInterfaceLocale($0) }), options: [("zh-CN", epLocalized("简体中文")), ("en-US", "English")]) }.zIndex(2)
            SettingRow(label: "时区") { WebSelect(label: epLocalized("时区"), selection: $timezone, options: [("Asia/Shanghai", epLocalized("中国标准时间")), ("UTC", epLocalized("协调世界时"))] + (["Asia/Shanghai", "UTC"].contains(timezone) ? [] : [(timezone, timezone)])) }.zIndex(1)
            HStack { Spacer(); EPButton("保存偏好") { Task { if await store.savePreferences(locale: locale, timezone: timezone, expectedVersion: preferencesVersion) { preferencesVersion = store.account?.preferences.version ?? preferencesVersion } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(TimeZone(identifier: timezone) == nil) }.padding(.top, T.space4)
        }
    }
    private var usagePanel: some View {
        VStack(alignment: .leading, spacing: T.space3) {
            SettingRow(label: "剩余使用额度") {
                if let credits = management.credits {
                    if credits.isUnlimited { EPText("不限量").font(TypeStyle.ui(T.textHeading, weight: .semibold)) }
                    else {
                        let buckets = AccountAllowance.from(credits)
                        if buckets.isEmpty { EPText("额度信息暂不可用").foregroundStyle(.secondary) }
                        ForEach(buckets) { bucket in
                            VStack(alignment: .leading, spacing: T.space2) {
                                HStack { EPText(bucket.label); Spacer(); EPText(bucket.remainingPercent.map { String(format: "%g%%", $0) } ?? "暂不可用").fontWeight(.semibold) }
                                if let percent = bucket.remainingPercent { GeometryReader { geometry in Capsule().fill(Palette(dark: scheme == .dark).strong).overlay(alignment: .leading) { Capsule().fill(Palette(dark: scheme == .dark).ink).frame(width: geometry.size.width * percent / 100) } }.frame(height: T.space1).accessibilityLabel(bucket.label).accessibilityValue("\(percent)%") }
                                if let expiry = credits.activeUsageBuckets?.first(where: { $0.bucketId == bucket.id })?.expiresAt { EPText("有效至 \(Self.date(expiry))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                            }.padding(.bottom, T.space2)
                        }
                    }
                } else { EPText("额度信息暂不可用").foregroundStyle(.secondary) }
            }
            if let credits = management.credits {
                if !credits.isUnlimited {
                    SettingRow(label: "兑换码") {
                        HStack { EPTextField("QX-XXXX-XXXX", text: $management.redemptionCode).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("兑换码")); EPButton(management.pending == "credit-redemption" ? "正在兑换…" : "兑换") { management.performUserAction { _ = await management.redeemCredits() } }.buttonStyle(EPButtonStyle()).disabled(management.redemptionCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || management.redemptionCode.utf16.count > 64) }
                        EPText("每个兑换码仅可使用一次").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: T.space3) {
                    HStack { EPText("用量记录").font(TypeStyle.ui(T.textHeading, weight: .semibold)); Spacer(); EPText("共 \(credits.totalEntries) 笔").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    ForEach(credits.entries, id: \.entryId) { entry in
                        HStack(alignment: .top, spacing: T.space3) {
                            VStack(alignment: .leading, spacing: T.space1) {
                                EPText(entry.kind == "usage" ? "Agent 对话" : entry.kind == "redemption" ? "兑换码到账" : "新用户赠送").fontWeight(.semibold)
                                EPText(Self.date(entry.createdAt)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                if entry.kind == "usage" { EPText("\(entry.inputTokens) 输入 · \(entry.outputTokens) 输出 token").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 0)
                        }.padding(.vertical, T.space3)
                    }
                    if credits.entries.isEmpty { EPText("完成首轮对话后，用量流水会出现在这里。").foregroundStyle(.secondary) }
                    if credits.totalEntries > AccountManagementLogic.creditPageSize {
                        HStack { EPButton("上一页") { management.performUserAction { await management.loadCredits(page: management.creditPage - 1) } }.buttonStyle(EPButtonStyle()).disabled(management.creditPage == 1); Spacer(); EPText("第 \(management.creditPage) 页").font(TypeStyle.ui(T.textMeta)); Spacer(); EPButton("下一页") { management.performUserAction { await management.loadCredits(page: management.creditPage + 1) } }.buttonStyle(EPButtonStyle()).disabled(credits.nextCursor == nil) }.accessibilityLabel(epLocalized("用量记录分页"))
                    }
                    EPText("按实际调用计算用量，失败或中止的回答不消耗额度。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                }.padding(.top, T.space5)
            }
        }
    }
    private var securityPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            EPText("登录密码").font(TypeStyle.ui(T.textHeading, weight: .semibold)).padding(.vertical, T.space2)
            SettingRow(label: "当前密码") { EPSecureField("", text: $currentPassword).textContentType(.password).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("当前密码")) }
            SettingRow(label: "新密码") { EPSecureField("", text: $newPassword).epNewPasswordContentType().textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("新密码")) }
            SettingRow(label: "确认新密码") { EPSecureField("", text: $confirmPassword).epNewPasswordContentType().textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("确认新密码")) }
            Toggle(isOn: $revokeOtherSessions) { VStack(alignment: .leading, spacing: T.space1) { EPText("撤销其他设备的会话"); EPText("当前设备不会退出。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) } }.toggleStyle(.checkbox).padding(.top, T.space4)
            if let passwordError { InlineMessage(text: epLocalized(passwordError), isError: true).padding(.top, T.space3) }
            HStack { Spacer(); EPButton("更新密码", action: changePassword).buttonStyle(EPButtonStyle(primary: true)).disabled(currentPassword.isEmpty) }.padding(.top, T.space4)
            VStack(alignment: .leading, spacing: T.space3) {
                EPText("活跃会话").font(TypeStyle.ui(T.textHeading, weight: .semibold))
                ForEach(store.sessions, id: \.sessionId) { session in
                    HStack(spacing: T.space3) {
                        VStack(alignment: .leading, spacing: T.space1) { EPText(session.deviceLabel).fontWeight(.semibold); EPText("最近活动 · \(Self.date(session.lastSeenAt))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                        Spacer()
                        if session.current { EPText("当前会话").font(TypeStyle.ui(T.textMeta)).padding(.horizontal, T.space2).padding(.vertical, T.space1).background(Palette(dark: scheme == .dark).strong, in: Capsule()) }
                        else { EPButton("撤销") { openConfirmation(.session(session)) }.buttonStyle(EPButtonStyle()).accessibilityLabel(epLocalized("撤销 \(session.deviceLabel) 会话")) }
                    }.padding(.vertical, T.space3)
                }
                if !store.sessions.contains(where: { !$0.current }) { EPText("没有其他活跃会话").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            }.padding(.top, T.space5)
        }
    }
    private func privacyPanel(_ account: AccountResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            SettingRow(label: "模型改进") {
                HStack { EPText("允许用于改进模型"); Spacer(); WebToggle(label: epLocalized("允许用于改进模型"), value: account.preferences.modelImprovementAllowed) { openConfirmation(.model(!account.preferences.modelImprovementAllowed, account.preferences)) } }
                EPText("目前不使用研究数据训练模型。此项仅记录未来可选改进计划的授权，可随时撤回。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            }
            SettingRow(label: "导出") {
                EPButton(management.pending == "export" ? "正在准备…" : "导出我的数据") { management.performUserAction { await management.requestExport() } }.buttonStyle(EPButtonStyle())
                EPText("包含账户资料、研究任务与模型交互记录，不包含密码或会话凭据。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                if let data = management.dataExport {
                    if data.status == "ready", !data.downloadHref.isEmpty { EPButton("下载数据副本", action: downloadExport).buttonStyle(EPButtonStyle()); EPText("有效至 \(Self.date(data.expiresAt))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    else { EPText(data.status == "failed" ? "数据副本未能生成，请重试。" : data.status == "expired" ? "数据副本已过期，请重新导出。" : "数据副本正在准备，请稍后重新查看。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                }
            }
        }
    }
    private func accountStatusPanel(_ account: AccountResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            if account.isProtectedAdmin { EPText("部署管理员保护").font(TypeStyle.ui(T.textHeading, weight: .semibold)); EPText("此账户不能被降级、停用或删除。仍可更新密码与撤销其他会话。").foregroundStyle(.secondary) }
            else {
                SettingRow(label: "停用") { EPButton("停用账户") { openConfirmation(.deactivate) }.buttonStyle(EPButtonStyle()); EPText("退出所有设备并暂停访问。研究数据保留，管理员可在核验后恢复账户。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                SettingRow(label: "注销") { EPButton("永久删除账户") { openConfirmation(.delete) }.buttonStyle(EPButtonStyle()).foregroundStyle(Palette(dark: scheme == .dark).danger); EPText("永久删除账户、研究任务与个人模型交互记录。此操作无法恢复。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            }
        }
    }
    private func openConfirmation(_ action: AccountConfirmation) { management.clearMessages(); actionPassword = ""; deletionEmail = ""; deactivationReason = ""; confirmation = action }
    private func confirmationPanel(_ action: AccountConfirmation) -> some View {
        VStack(alignment: .leading, spacing: T.space4) {
            EPText(confirmationTitle(action)).font(TypeStyle.ui(T.textTitle, weight: .semibold))
            EPText(confirmationDescription(action)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            switch action {
            case .deactivate:
                EPText("当前密码"); EPSecureField("", text: $actionPassword).textContentType(.password).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("当前密码"))
                EPText("停用原因"); TextEditor(text: $deactivationReason).font(TypeStyle.ui(T.textControl)).scrollContentBackground(.hidden).frame(height: 84).padding(T.space2).background(Palette(dark: scheme == .dark).strong, in: RoundedRectangle(cornerRadius: T.radiusField)).accessibilityLabel(epLocalized("停用原因"))
            case .delete:
                EPText("账户邮箱"); EPTextField(store.account?.email ?? "", text: $deletionEmail).epEmailContentType().textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("账户邮箱"))
                EPText("当前密码"); EPSecureField("", text: $actionPassword).textContentType(.password).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("当前密码"))
            default: EmptyView()
            }
            if let error = management.error ?? store.accountError { InlineMessage(text: epLocalized(error), isError: true) }
            HStack { Spacer(); EPButton("取消") { confirmation = nil }.buttonStyle(EPButtonStyle()).keyboardShortcut(.cancelAction); EPButton(management.busy || store.saving ? "正在处理…" : confirmationLabel(action)) { confirm(action) }.buttonStyle(EPButtonStyle(primary: true)).disabled(!canConfirm(action)) }
        }.padding(T.space6).frame(width: 460).font(TypeStyle.ui(T.textControl)).disabled(management.busy || store.saving).interactiveDismissDisabled(management.busy || store.saving)
    }
    private func confirmationTitle(_ action: AccountConfirmation) -> String { switch action { case .session: return "撤销这个会话？"; case .model(let allowed, _): return allowed ? "允许用于改进模型？" : "停止用于改进模型？"; case .deactivate: return "停用账户？"; case .delete: return "永久删除账户？" } }
    private func confirmationLabel(_ action: AccountConfirmation) -> String { switch action { case .session: return "确认撤销"; case .model(let allowed, _): return allowed ? "确认允许" : "确认停止"; case .deactivate: return "确认停用"; case .delete: return "确认永久删除" } }
    private func confirmationDescription(_ action: AccountConfirmation) -> String {
        switch action {
        case .session(let value): return "\(value.deviceLabel) 将立即退出，未保存的操作可能丢失。"
        case .model(let allowed, _): return allowed ? "Everplain 当前不使用你的数据训练模型。开启仅记录未来可选改进计划的授权；任何实际启用仍会另行告知。" : "停止后，未来可选改进计划不再取得你的授权；研究功能所需推理不受影响。"
        case .deactivate: return "停用后你会立即退出所有设备。数据会保留，管理员可在核验后恢复访问。"
        case .delete: return "账户、研究任务、派生文档与个人模型交互记录将被永久删除。删除后无法恢复。"
        }
    }
    private func canConfirm(_ action: AccountConfirmation) -> Bool {
        guard let account = store.account else { return false }
        switch action { case .session, .model: return true; case .deactivate: return AccountManagementLogic.canDeactivate(account, ownerId: store.session?.user.userId, password: actionPassword, reason: deactivationReason); case .delete: return AccountManagementLogic.canDelete(account, ownerId: store.session?.user.userId, password: actionPassword, email: deletionEmail) }
    }
    private func confirm(_ action: AccountConfirmation) {
        guard let account = store.account, canConfirm(action) else { return }
        management.performUserAction {
            let success: Bool
            switch action {
            case .session(let session): await store.revokeSession(session.sessionId); success = store.accountError == nil
            case .model(let allowed, let preferences): success = await management.updateModelConsent(allowed: allowed, preferences: preferences)
            case .deactivate: success = await management.deactivate(account: account, password: actionPassword, reason: deactivationReason)
            case .delete: success = await management.deleteAccount(account: account, password: actionPassword, email: deletionEmail)
            }
            if success { confirmation = nil; actionPassword = ""; deletionEmail = ""; deactivationReason = "" }
        }
    }
    private func downloadExport() {
        let owner = store.session?.user.userId
        management.performUserAction {
            guard let file = await management.downloadExport(), management.matchesOwner(owner) else { return }
            let panel = NSSavePanel(); panel.allowedContentTypes = [.json]; panel.nameFieldStringValue = "Everplain-data.json"; panel.canCreateDirectories = true
            panel.begin { response in
                Task { @MainActor in
                    guard response == .OK, let url = panel.url, management.matchesOwner(owner) else { return }
                    do { try file.data.write(to: url, options: .atomic); management.feedback = "数据副本已保存。" }
                    catch { management.error = "未能保存数据副本：\(error.localizedDescription)" }
                }
            }
        }
    }
    private func changePassword() {
        guard (12...128).contains(newPassword.utf16.count) else { passwordError = "新密码需要 12-128 个字符。"; return }
        guard newPassword == confirmPassword else { passwordError = "两次输入的新密码不一致。"; return }
        passwordError = nil
        Task { if await store.changePassword(current: currentPassword, new: newPassword, revokeOtherSessions: revokeOtherSessions) { currentPassword = ""; newPassword = ""; confirmPassword = "" } }
    }
    private func clearSecrets() { currentPassword = ""; newPassword = ""; confirmPassword = ""; actionPassword = ""; deletionEmail = ""; deactivationReason = ""; confirmation = nil }
    private func loadFields() {
        guard let account = store.account else { loadedOwner = nil; name = ""; return }
        name = account.displayName ?? ""; locale = account.preferences.locale; timezone = account.preferences.timezone; store.setInterfaceLocale(locale)
        nameVersion = account.version; preferencesVersion = account.preferences.version; loadedOwner = account.userId
    }
    static func date(_ value: String) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return epLocalized("时间未知") }
        let display = DateFormatter(); display.locale = Locale(identifier: UserDefaults.standard.string(forKey: "qunxue.interface-locale") ?? "zh-CN"); display.dateStyle = .short; display.timeStyle = .short
        return display.string(from: date)
    }
}

private struct ChatPlatformsPanel: View {
    @ObservedObject var management: AccountManagementStore
    @Environment(\.colorScheme) private var scheme
    @State private var revoke: ChannelBindingResponse?
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            EPText("在飞书或 Telegram 私聊中使用你的 Everplain Agent。群聊和附件暂未开放。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            if management.channelsLoading { AccountPageLoading(message: "正在读取聊天平台…") }
            if let error = management.channelError { InlineMessage(text: epLocalized(error), isError: true) }
            if let feedback = management.channelFeedback { InlineMessage(text: epLocalized(feedback), isError: false) }
            if !management.gateways.isEmpty {
                EPText("选择机器人")
                WebSelect(label: epLocalized("选择机器人"), selection: Binding(get: { management.selectedGateway }, set: { management.chooseGateway($0) }), options: management.gateways.map { ($0.gatewayId, $0.name) }).zIndex(2)
                if let target = management.selectedBot { Text(target.gatewayId).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).textSelection(.enabled) }
                Toggle(isOn: $management.channelConsent) { EPText("我理解私聊可能使用我的个人记忆与有权限的资料，回答会发送到所选平台，并按现有 Everplain 用量计费。") }.toggleStyle(.checkbox).font(TypeStyle.ui(T.textMeta))
                if let command = management.command {
                    VStack(alignment: .leading, spacing: T.space3) {
                        EPText("在机器人私聊发送这条命令")
                        Text(command).font(.system(size: T.textControl, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(T.space3).background(Palette(dark: scheme == .dark).strong, in: RoundedRectangle(cornerRadius: T.radiusField)).accessibilityLabel(epLocalized("一次性绑定命令"))
                        EPText("剩余 \(management.remaining / 60) 分 \(management.remaining % 60) 秒，只可使用一次。不要转发给他人。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        HStack { EPButton("复制命令") { guard let value = management.command else { return }; NSPasteboard.general.clearContents(); management.copiedCommand(succeeded: NSPasteboard.general.setString(value, forType: .string)) }.buttonStyle(EPButtonStyle()); if let url = AccountManagementLogic.safeBotURL(management.selectedBot?.botUrl) { EPLink("打开机器人私聊", destination: url).buttonStyle(EPButtonStyle()) } }
                        EPButton(management.pending == "channel-cancel" ? "正在作废…" : "作废绑定码") { management.performUserAction { await management.cancelCode() } }.buttonStyle(EPGhostButtonStyle())
                        if AccountManagementLogic.safeBotURL(management.selectedBot?.botUrl) == nil { EPText("管理员还没有设置机器人入口，请在平台中打开上述机器人；不要把绑定码发到群里。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                        EPText("此页会自动确认绑定状态。关闭页面只隐藏命令；需要立即失效时，请点“作废绑定码”。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    }
                } else { EPButton(management.pending == "channel-generate" ? "正在生成…" : "生成一次性绑定码") { management.performUserAction { await management.generateCode() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(!management.channelConsent || management.channelsLoading) }
            } else if management.channelsLoaded, management.channelError == nil { InlineMessage(text: "聊天平台尚未启用。管理员配置官方机器人后，入口会显示在这里。", isError: false) }
            HStack { EPText("已绑定账号").font(TypeStyle.ui(T.textHeading, weight: .semibold)); Spacer(); EPButton("刷新状态") { management.performUserAction { await management.refreshChannels() } }.buttonStyle(EPGhostButtonStyle()) }
            if management.channelsLoaded, management.bindings.isEmpty { EPText("还没有绑定的聊天账号。").foregroundStyle(.secondary) }
            ForEach(management.bindings, id: \.bindingId) { binding in
                VStack(alignment: .leading, spacing: T.space3) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: T.space1) {
                            Text(management.gateways.first(where: { $0.gatewayId == binding.gatewayId })?.name ?? binding.gatewayId).fontWeight(.semibold)
                            EPText("平台账号：\(binding.subjectId)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                            EPText(Date(timeIntervalSince1970: Double(binding.createdAt)).formatted(date: .numeric, time: .shortened)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        }
                        Spacer(); EPButton("解除绑定") { revoke = binding }.buttonStyle(EPButtonStyle())
                    }
                    if revoke?.bindingId == binding.bindingId {
                        EPText("解除后此账号不能继续使用你的 Agent，该平台未使用的绑定码也会作废。已发送的内容不会撤回。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        HStack { EPButton("取消") { revoke = nil }.buttonStyle(EPButtonStyle()); EPButton(management.pending == "channel-revoke" ? "正在解除…" : "确认解除") { management.performUserAction { if await management.revokeBinding(binding) { revoke = nil } } }.buttonStyle(EPButtonStyle()).foregroundStyle(Palette(dark: scheme == .dark).danger) }
                    }
                }.padding(.vertical, T.space2)
            }
        }.task { await management.loadChannels() }.onDisappear { management.closeChannels(); revoke = nil }.disabled(management.busy)
    }
}
/// Only unsaved Agent identity text is retained, in memory and scoped to one authenticated owner.
/// AppStore resets this alongside its other owner-scoped state; no credential is stored here.
enum SettingsDraftMemory {
    struct AgentEdit { let owner: String; let draft: AgentProfileResponse; let base: AgentProfileResponse }
    static var agent: AgentEdit?
    static func reset() { agent = nil }
}

struct AgentSettingsPanel: View {
    var active: Bool
    var companion = false
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var draft: AgentProfileResponse?
    @State private var base: AgentProfileResponse?
    @State private var cancelRequested = false
    @State private var saved = false
    @State private var localError: String?
    private let styles = [("clear", "清晰直接"), ("warm", "温和自然"), ("rigorous", "严谨细致"), ("curious", "好奇开放")]
    private var conflict: AgentProfileResponse? { guard let base, let latest = store.profile, base.version != latest.version, draft != base else { return nil }; return latest }
    private var valid: Bool {
        guard let value = draft else { return false }
        return !value.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.name.utf16.count <= 40 && value.color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil && (value.soulText?.utf16.count ?? 0) <= 8000
    }
    var body: some View {
        Group {
            if companion {
                VStack(spacing: 0) {
                    ScrollView { editor.padding(.horizontal, T.space5).padding(.bottom, T.space5) }
                    if let value = draft { saveControls(value).padding(.horizontal, T.space5).padding(.vertical, T.space3).background(Palette(dark: scheme == .dark).surface).overlay(alignment: .top) { Rectangle().fill(Palette(dark: scheme == .dark).rule).frame(height: 1) } }
                }
            } else { editor }
        }.disabled(store.saving)
            .onAppear(perform: loadPristine)
            .onChange(of: store.profile?.version) { _ in loadPristine() }
            .onChange(of: store.session?.user.userId) { _ in draft = nil; base = nil; saved = false; localError = nil; cancelRequested = false; loadPristine() }
    }
    private var editor: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            if let value = draft {
                if companion { companionAppearance(value) } else {
                HStack(spacing: T.space4) {
                    AgentAvatar(id: value.avatarId, color: value.color, size: 80, state: .greet, playing: active)
                    VStack(alignment: .leading, spacing: T.space4) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 40, maximum: 40), spacing: T.space1)], alignment: .leading, spacing: T.space1) {
                            ForEach(AgentAvatar.presets, id: \.id) { preset in
                                Button { patch { $0.avatarId = preset.id; $0.color = preset.color } } label: {
                                    AgentAvatar(id: preset.id, color: value.avatarId == preset.id ? value.color : preset.color, size: 32, playing: false)
                                        .frame(width: 40, height: 40).background(Palette(dark: scheme == .dark).raised, in: RoundedRectangle(cornerRadius: T.radiusItem))
                                        .overlay(RoundedRectangle(cornerRadius: T.radiusItem).stroke(value.avatarId == preset.id ? Palette(dark: scheme == .dark).ink : .clear, lineWidth: 2))
                                }.buttonStyle(.plain).help(preset.name).accessibilityLabel(preset.name).accessibilityAddTraits(value.avatarId == preset.id ? .isSelected : [])
                            }
                        }.accessibilityElement(children: .contain).accessibilityLabel(epLocalized("角色"))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 24, maximum: 24), spacing: T.space2)], alignment: .leading, spacing: T.space2) {
                            ForEach(AgentAvatar.presets.map(\.color) + ["#3d3d3a"], id: \.self) { color in
                                Button { patch { $0.color = color } } label: {
                                    Circle().fill(Color(hex: color)).frame(width: 24, height: 24)
                                        .overlay(Circle().stroke(Palette(dark: scheme == .dark).raised, lineWidth: value.color.lowercased() == color.lowercased() ? 2 : 0).padding(-1))
                                        .overlay(Circle().stroke(value.color.lowercased() == color.lowercased() ? Palette(dark: scheme == .dark).ink : .clear, lineWidth: 2).padding(-3))
                                }.buttonStyle(.plain).accessibilityLabel(epLocalized("颜色 \(color)")).accessibilityAddTraits(value.color.lowercased() == color.lowercased() ? .isSelected : [])
                            }
                        }.padding(.horizontal, T.space2).accessibilityElement(children: .contain).accessibilityLabel(epLocalized("颜色"))
                    }
                }
                }
                VStack(alignment: .leading, spacing: T.space2) {
                    EPText("名字")
                    EPTextField("", text: binding(\.name)).textFieldStyle(EPFieldStyle()).accessibilityLabel(epLocalized("名字"))
                }
                VStack(alignment: .leading, spacing: T.space2) {
                    EPText("说话方式")
                    if companion {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: T.space2) {
                            ForEach(styles, id: \.0) { style in
                                EPButton(style.1) { patch { $0.speakingStyle = style.0 } }
                                    .buttonStyle(CompanionSpeakingStyle(selected: value.speakingStyle == style.0))
                            }
                        }
                    } else {
                        HStack(spacing: T.space1) {
                            ForEach(styles, id: \.0) { style in EPButton(style.1) { patch { $0.speakingStyle = style.0 } }.buttonStyle(SelectionButtonStyle(selected: value.speakingStyle == style.0)) }
                        }.padding(T.space1).background(Palette(dark: scheme == .dark).strong, in: Capsule())
                    }
                }
                soulEditor(value)
                if let error = localError ?? store.profileError { InlineMessage(text: epLocalized(error), isError: true) }
                if !companion { saveControls(value) }
            } else if let error = store.profileError {
                InlineMessage(text: epLocalized(error), isError: true)
                EPButton("重试") { Task { await store.refreshProfile(); loadPristine() } }.buttonStyle(EPButtonStyle())
            } else { AccountPageLoading(message: "正在读取 Agent 设置…") }
        }.padding(.vertical, T.space2)
    }
    private func saveControls(_ value: AgentProfileResponse) -> some View {
        HStack {
            if companion { EPText(saved ? "已保存" : "关闭后保留草稿").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            else { Button { store.resetCompanion() } label: { Label { EPText("重新走一遍") } icon: { WebIcon(name: .arrowClockwise) } }.buttonStyle(EPGhostButtonStyle()).accessibilityLabel(epLocalized("重新设置我的 AI 伙伴")) }
            Spacer()
            if saved && !companion { EPText("已保存").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            EPButton(store.saving ? "正在保存…" : companion ? "保存角色" : "保存 Agent") { Task { await save(value) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(!valid || conflict != nil)
        }
    }
    private func companionAppearance(_ value: AgentProfileResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space4) {
            VStack(alignment: .leading, spacing: T.space3) {
                EPText("角色形象")
                HStack(spacing: T.space1) {
                    ForEach(AgentAvatar.presets, id: \.id) { preset in
                        Button { patch { $0.avatarId = preset.id; $0.color = preset.color } } label: {
                            VStack(spacing: T.space1) {
                                AgentAvatar(id: preset.id, color: value.avatarId == preset.id ? value.color : preset.color, size: 36, playing: false)
                                EPText(preset.name).font(TypeStyle.ui(T.textMeta))
                            }.frame(maxWidth: .infinity).padding(.vertical, T.space2)
                                .background(value.avatarId == preset.id ? Palette(dark: scheme == .dark).mutedSurface : .clear, in: RoundedRectangle(cornerRadius: T.radiusControl))
                                .overlay(RoundedRectangle(cornerRadius: T.radiusControl).stroke(value.avatarId == preset.id ? Palette(dark: scheme == .dark).rule : .clear, lineWidth: 1))
                        }.buttonStyle(.plain).accessibilityLabel(preset.name).accessibilityAddTraits(value.avatarId == preset.id ? .isSelected : [])
                    }
                }
            }
            VStack(alignment: .leading, spacing: T.space2) {
                EPText("角色颜色")
                HStack(spacing: T.space2) {
                    ForEach(AgentAvatar.presets.map(\.color) + ["#3d3d3a"], id: \.self) { color in
                        Button { patch { $0.color = color } } label: {
                            Circle().fill(Color(hex: color)).frame(width: 24, height: 24).padding(4)
                                .overlay(Circle().stroke(value.color.lowercased() == color.lowercased() ? Palette(dark: scheme == .dark).ink : .clear, lineWidth: 1))
                        }.buttonStyle(.plain).accessibilityLabel(epLocalized("颜色 \(color)"))
                    }
                }
            }
        }
    }
    private func soulEditor(_ value: AgentProfileResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            EPText("人格描述（Markdown）")
            ZStack(alignment: .topLeading) {
                if (value.soulText ?? "").isEmpty { EPText("例如：你是我的阅读伙伴。先听我说完，再提出不同解释；有疑问时坦诚说明。").font(.system(size: T.textBody, design: .monospaced)).foregroundStyle(Palette(dark: scheme == .dark).faint).padding(.horizontal, T.space5 + 5).padding(.top, T.space4 + 1).allowsHitTesting(false) }
                TextEditor(text: Binding(get: { draft?.soulText ?? "" }, set: { next in patch { $0.soulText = next } }))
                    .font(.system(size: T.textBody, design: .monospaced)).scrollContentBackground(.hidden).frame(minHeight: 180)
                    .padding(.horizontal, T.space5).padding(.vertical, T.space4).accessibilityLabel(epLocalized("人格描述（Markdown）"))
            }.background(Palette(dark: scheme == .dark).strong, in: RoundedRectangle(cornerRadius: T.radiusField))
            EPText("用自己的话写身份、交流方式、偏好与边界。支持 Markdown；上面的风格只是起点。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            if let latest = conflict {
                VStack(alignment: .leading, spacing: T.space3) {
                    EPText("另一处已保存了新版本。你的草稿仍在编辑框内，先核对下面的最新档案。")
                    EPText("最新身份与风格").fontWeight(.medium)
                    Text("\(latest.name) · \(AgentAvatar.presets.first(where: { $0.id == latest.avatarId })?.name ?? latest.avatarId) · \(latest.color) · \(epLocalized(styles.first(where: { $0.0 == latest.speakingStyle })?.1 ?? latest.speakingStyle))")
                    EPText("最新人格描述").fontWeight(.medium)
                    ScrollView { Text(latest.soulText?.isEmpty == false ? latest.soulText! : epLocalized("未填写")).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 240)
                    EPButton("保留我的修改继续编辑") { keepDraft(latest) }.buttonStyle(EPButtonStyle())
                    EPButton("采用最新版本") { cancelRequested = true }.buttonStyle(EPGhostButtonStyle())
                }.padding(T.space3).background(Palette(dark: scheme == .dark).mutedSurface, in: RoundedRectangle(cornerRadius: T.radiusItem))
            }
            if cancelRequested {
                VStack(alignment: .leading, spacing: T.space2) {
                    EPText("放弃当前未保存的修改，恢复已保存的档案？")
                    EPButton("放弃未保存的修改") { draft = store.profile; base = store.profile; SettingsDraftMemory.reset(); cancelRequested = false; saved = false; localError = nil }.buttonStyle(EPButtonStyle())
                    EPButton("继续编辑") { cancelRequested = false }.buttonStyle(EPGhostButtonStyle())
                }
            } else { EPButton("取消修改") { cancelRequested = true }.buttonStyle(EPGhostButtonStyle()) }
        }
    }
    private func loadPristine() {
        if draft == nil, let retained = SettingsDraftMemory.agent, retained.owner == store.session?.user.userId {
            draft = retained.draft; base = retained.base
        } else if draft == nil || draft == base { draft = store.profile; base = store.profile }
        store.agentDraftPreview = draft
    }
    private func rememberDraft() {
        guard let owner = store.session?.user.userId, let draft, let base else { return }
        SettingsDraftMemory.agent = SettingsDraftMemory.AgentEdit(owner: owner, draft: draft, base: base)
    }
    private func patch(_ change: (inout AgentProfileResponse) -> Void) { guard var value = draft, !store.saving else { return }; change(&value); draft = value; store.agentDraftPreview = value; rememberDraft(); saved = false; localError = nil; cancelRequested = false }
    private func binding(_ path: WritableKeyPath<AgentProfileResponse, String>) -> Binding<String> { Binding(get: { draft?[keyPath: path] ?? "" }, set: { next in patch { $0[keyPath: path] = next } }) }
    private func keepDraft(_ latest: AgentProfileResponse) {
        guard let old = base, let edits = draft else { return }
        var merged = latest
        if edits.name != old.name { merged.name = edits.name }
        if edits.avatarId != old.avatarId { merged.avatarId = edits.avatarId }
        if edits.color != old.color { merged.color = edits.color }
        if edits.speakingStyle != old.speakingStyle { merged.speakingStyle = edits.speakingStyle }
        if edits.soulText != old.soulText { merged.soulText = edits.soulText }
        base = latest; draft = merged; rememberDraft(); localError = nil
    }
    private func save(_ value: AgentProfileResponse) async {
        guard valid && conflict == nil else { return }
        if await store.saveAgent(value) { draft = store.profile; base = store.profile; SettingsDraftMemory.reset(); saved = true; localError = nil }
        else { localError = store.profileError; await store.refreshProfile() }
    }
}

private struct CompanionSpeakingStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium))
            .frame(maxWidth: .infinity).padding(.horizontal, T.space3).frame(minHeight: T.controlHeight)
            .foregroundStyle(p.ink)
            .background(selected ? T.colorAccentSoft(dark: scheme == .dark).color : p.surface, in: Capsule())
            .overlay(Capsule().stroke(selected ? p.ink : p.rule, lineWidth: 1))
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.45)
    }
}

private struct SelectionButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium)).lineLimit(1)
            .frame(maxWidth: .infinity).padding(.horizontal, T.space2).frame(minHeight: 32)
            .foregroundStyle(selected ? p.ink : p.muted).background(selected ? p.surface : .clear, in: Capsule())
            .overlay(Capsule().stroke(selected ? p.ring : .clear, lineWidth: 1)).opacity(configuration.isPressed ? 0.7 : 1)
    }
}
#endif
