#if os(macOS)
import SwiftUI
import EverplainCore

/// The four source onboarding stages, using native controls and the real import pipeline.
struct WelcomeSetupView: View {
    @ObservedObject var store: WelcomeSetupStore
    @ObservedObject var knowledge: KnowledgeStore
    var onSettings: () -> Void
    var onFinished: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var palette: Palette { Palette(dark: scheme == .dark) }
    private var progress: WelcomeImportProgress { WelcomeImportProgress(batches: knowledge.batches) }
    private var disabled: Bool { store.isBusy || knowledge.busy }
    private var pollKey: String { "\(store.ownerRevision)-\(progress.processing)-\(store.importProgressError == nil)" }

    var body: some View {
        let revision = store.ownerRevision
        Group {
            if store.profile == nil {
                initialState
            } else {
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        VStack(spacing: T.space6) {
                            AgentAvatar(id: store.draft.avatar, color: store.draft.color, size: store.step == 3 ? 128 : 96, state: avatarState)
                            Text(title).font(TypeStyle.reading(T.textDisplay)).multilineTextAlignment(.center)
                                .accessibilityAddTraits(.isHeader)
                            Group {
                                switch store.step {
                                case 0: importStep
                                case 1: identityStep
                                case 2: surveyStep
                                default: graphStep
                                }
                            }.disabled(disabled)
                            if let latest = store.latestProfile { conflictReview(latest) }
                            if let error = store.error {
                                InlineMessage(text: error, isError: true)
                                if store.latestProfile == nil {
                                    Button("重新读取档案") { store.performUserAction { await store.load() } }
                                        .buttonStyle(EPGhostButtonStyle()).disabled(disabled)
                                }
                            }
                            footer
                        }.frame(maxWidth: store.step == 2 ? 640 : 540)
                            .padding(.horizontal, T.space6).padding(.top, T.space6).padding(.bottom, T.space12)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }.background(palette.canvas).foregroundStyle(palette.ink)
            .task(id: revision) {
                guard revision == store.ownerRevision else { return }
                await store.load()
                guard revision == store.ownerRevision, !Task.isCancelled else { return }
                await store.refreshImports(using: knowledge)
            }
            .task(id: pollKey) {
                guard revision == store.ownerRevision, progress.processing, store.importProgressError == nil else { return }
                await store.pollImports(using: knowledge)
            }
    }

    /// Source LoadingState delegates to full-page AgentLoading/AgentLiquid, before setup controls mount.
    private var initialState: some View {
        VStack(spacing: T.space5) {
            if let error = store.error, !store.loading {
                InlineMessage(text: error, isError: true).frame(maxWidth: 540)
                Button("重新读取") { store.performUserAction { await store.load() } }.buttonStyle(EPButtonStyle())
            } else {
                AgentLiquid()
                Text("正在铺开你的知识空间").font(TypeStyle.ui(T.textBody))
                    .foregroundStyle(palette.muted).multilineTextAlignment(.center)
            }
        }.padding(T.space6).frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)
    }

    private var header: some View {
        HStack(spacing: T.space4) {
            if store.step > 0 {
                Button { move(to: store.step - 1, skip: true) } label: { WebIcon(name: .arrowLeft, size: 18) }
                    .buttonStyle(EPIconButtonStyle()).accessibilityLabel("上一步").disabled(disabled)
            } else if let origin = store.serviceOrigin {
                Link(destination: origin.appendingPathComponent("welcome")) { WebIcon(name: .arrowLeft, size: 18) }
                    .buttonStyle(EPIconButtonStyle()).accessibilityLabel("返回官网")
            } else { Color.clear.frame(width: T.iconControlSize, height: T.iconControlSize) }
            Spacer()
            HStack(spacing: T.space3) {
                ForEach(Array(WelcomeSetupLogic.stageNames.enumerated()), id: \.offset) { index, name in
                    Button { move(to: index, skip: true) } label: {
                        Capsule().fill(index <= store.step ? palette.accent : palette.strong)
                            .frame(width: index == store.step ? 34 : 22, height: 7)
                            .padding(.vertical, T.space3)
                    }.buttonStyle(.plain).disabled(disabled || index >= store.step)
                        .accessibilityLabel("\(name)，第 \(index + 1) 步，共 4 步")
                        .accessibilityValue(index == store.step ? "当前步骤" : index < store.step ? "已完成" : "未开始")
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("第 \(store.step + 1) 步，共 4 步")
            Spacer()
            if store.step < 3 {
                Button("暂时跳过") { move(to: store.step + 1, skip: true) }
                    .buttonStyle(EPGhostButtonStyle()).disabled(disabled || store.profile == nil)
            } else { Color.clear.frame(width: 88, height: T.controlHeight) }
        }.padding(.horizontal, T.space6).padding(.top, T.space4)
    }
    private var avatarState: AgentAvatar.MotionState {
        switch store.step { case 0: return .idle; case 1: return .greet; case 2: return .think; default: return progress.processing ? .work : .greet }
    }
    private var title: String {
        switch store.step {
        case 0: return "先把你收藏过的东西带进来"
        case 1: return "给它起个名字"
        case 2: return "说说你自己"
        default: return progress.title(name: store.draft.name, readable: store.importsReadable)
        }
    }
    private var footer: some View {
        VStack(spacing: T.space3) {
            Button { move(to: store.step + 1) } label: {
                Text(actionTitle).frame(minWidth: 240, minHeight: T.actionHeight)
            }.buttonStyle(AuthenticationSubmitStyle()).disabled(disabled || store.latestProfile != nil)
            if store.step == 3, progress.processing {
                Button("先进入，后台继续") { move(to: 4, skip: true) }
                    .buttonStyle(EPGhostButtonStyle()).disabled(disabled || store.latestProfile != nil)
            }
            Button("账户设置", action: onSettings).buttonStyle(.plain)
                .font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted).padding(.top, T.space3).disabled(disabled)
        }
    }
    private var actionTitle: String {
        if store.busy == .save { return "正在保存…" }
        if store.busy == .importing { return "正在导入…" }
        if store.busy == .retry { return "正在重试…" }
        switch store.step {
        case 1:
            let name = store.draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return "就叫\(name.isEmpty ? "它" : name)"
        case 2: return "好了"
        case 3: return "看看我的知识图谱"
        default: return "继续"
        }
    }
    private func move(to next: Int, skip: Bool = false) {
        guard !disabled else { return }
        let revision = store.ownerRevision
        store.performUserAction {
            if await store.change(to: next, skip: skip), revision == store.ownerRevision, next == 4 { onFinished() }
        }
    }

    private var importStep: some View {
        VStack(spacing: T.space5) {
            Text("选几个你常用的地方。导入在后台进行，不用等。")
                .font(TypeStyle.ui(T.textBody)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
            VStack(spacing: T.space3) {
                sourceButton(.chrome, title: "Chrome 书签", hint: "上传导出的书签文件", symbol: "BookmarkSimple", accessibility: "导入 Chrome 书签") {
                    store.chooseFiles(source: .chrome, using: knowledge)
                }
                sourceButton(.obsidian, title: "Obsidian", hint: "选择整个 Vault 文件夹", symbol: "Folder", accessibility: "导入 Markdown 文件夹") {
                    store.chooseFiles(source: .obsidian, using: knowledge)
                }
                sourceButton(.bilibili, title: "B 站收藏夹", hint: "填你的 UID", symbol: "TelevisionSimple", accessibility: "B 站收藏夹") {
                    store.favoritesVisible.toggle()
                }
                sourceButton(.appleNotes, title: "Apple 备忘录", hint: "导出 Markdown 后上传", symbol: "Note", accessibility: "导入 Apple 备忘录") {
                    store.chooseFiles(source: .appleNotes, using: knowledge)
                }
            }
            if store.favoritesVisible {
                VStack(alignment: .leading, spacing: T.space3) {
                    HStack {
                        TextField("B 站 UID", text: $store.favoritesUID).textFieldStyle(EPFieldStyle())
                            .accessibilityLabel("B 站 UID").onSubmit(importFavorites)
                        Button("导入收藏夹", action: importFavorites).buttonStyle(EPButtonStyle())
                    }
                    Text("只导入公开可访问的收藏内容。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
                }
            }
            batchAvailability
            if store.importsReadable, progress.total > 0 {
                Text("已接收 \(progress.total) 条资料 · 已处理 \(progress.finished) 条").font(TypeStyle.ui(T.textBody)).foregroundStyle(palette.muted)
            }
            Text("默认只有你能看到。以后也能继续导入。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
        }
    }
    private func importFavorites() { store.performUserAction { await store.importFavorites(using: knowledge) } }
    private func sourceButton(_ source: KnowledgeImportSource, title: String, hint: String, symbol: String, accessibility: String, action: @escaping () -> Void) -> some View {
        let selected = knowledge.batches.contains { $0.sourceType == source.rawValue }
        return Button(action: action) {
            HStack(spacing: T.space4) {
                AccountSourceIcon(kind: symbol).frame(width: 44, height: 44).foregroundStyle(palette.ink)
                    .background(palette.strong, in: RoundedRectangle(cornerRadius: T.radiusItem))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(TypeStyle.ui(T.textBody, weight: .medium))
                    Text(hint).font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
                }
                Spacer()
                Circle().fill(selected ? palette.accent : Color.clear)
                    .overlay(Circle().stroke(selected ? Color.clear : T.colorRuleStrong(dark: scheme == .dark).color, lineWidth: 1.5))
                    .overlay {
                        if selected { WebIcon(name: .check, size: 14).foregroundStyle(palette.onAccent) }
                    }.frame(width: 24, height: 24).accessibilityHidden(true)
            }.padding(T.space4).frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(palette.rule, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityLabel(accessibility).accessibilityValue(selected ? "已导入" : "尚未导入")
    }

    private var identityStep: some View {
        VStack(spacing: T.space6) {
            TextField("例如：小叶", text: $store.draft.name).textFieldStyle(EPFieldStyle())
                .accessibilityLabel("你想叫它什么？").onSubmit { move(to: 2) }
            HStack(spacing: T.space1) {
                ForEach(Array(AgentAvatar.presets.enumerated()), id: \.element.id) { index, preset in
                    Button { store.draft.avatar = preset.id; store.draft.color = preset.color } label: {
                        AgentAvatar(id: preset.id, color: store.draft.avatar == preset.id ? store.draft.color : preset.color, size: 56, offset: Double(index) * 0.6)
                            .padding(2).background(store.draft.avatar == preset.id ? palette.strong : Color.clear, in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel(preset.name).accessibilityValue(store.draft.avatar == preset.id ? "已选择" : "未选择")
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("外观")
            HStack(spacing: T.space3) {
                ForEach(WelcomeSetupLogic.colors, id: \.self) { color in
                    Button { store.draft.color = color } label: {
                        Circle().fill(Color(hex: color)).frame(width: 26, height: 26)
                            .overlay(Circle().stroke(store.draft.color == color ? palette.ink : Color.clear, lineWidth: 2).padding(-4))
                    }.buttonStyle(.plain).accessibilityLabel("颜色 \(color)").accessibilityValue(store.draft.color == color ? "已选择" : "未选择")
                }
            }.padding(.vertical, T.space2).accessibilityElement(children: .contain).accessibilityLabel("颜色")
            VStack(alignment: .leading, spacing: T.space4) {
                question("你喜欢它怎么说话？")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 105))], spacing: T.space3) {
                    ForEach(WelcomeSetupLogic.speakingStyles, id: \.id) { style in
                        choice(style.title, selected: store.draft.style == style.id) { store.draft.style = style.id }.help(style.detail)
                    }
                }
            }
        }
    }
    private var surveyStep: some View {
        VStack(alignment: .leading, spacing: T.space6) {
            VStack(alignment: .leading, spacing: T.space3) {
                question("你现在主要在做什么？")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: T.space3) {
                    ForEach(WelcomeSetupLogic.occupations, id: \.self) { occupation in
                        choice(occupation, selected: store.draft.occupation == occupation) { store.draft.occupation = store.draft.occupation == occupation ? "" : occupation }
                    }
                }
            }
            VStack(alignment: .leading, spacing: T.space3) {
                question("所在领域", detail: "选填")
                TextField("例如：教育、设计、互联网", text: $store.draft.industry).textFieldStyle(EPFieldStyle()).accessibilityLabel("所在领域，选填")
            }
            VStack(alignment: .leading, spacing: T.space3) {
                question("最想让它帮你做什么？", detail: "可以多选")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: T.space3) {
                    ForEach(WelcomeSetupLogic.goals, id: \.self) { goal in
                        choice(goal, selected: store.draft.goals.contains(goal)) {
                            if store.draft.goals.contains(goal) { store.draft.goals.removeAll { $0 == goal } }
                            else { store.draft.goals.append(goal) }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: T.space3) {
                question("最近在关心什么？")
                TextField("例如：城市、认知科学、电影，用顿号分隔", text: $store.draft.interests).textFieldStyle(EPFieldStyle()).accessibilityLabel("最近在关心什么？")
            }
            VStack(alignment: .leading, spacing: T.space3) {
                question("还有什么想告诉它的？", detail: "选填")
                TextEditor(text: $store.draft.additional).font(TypeStyle.ui(T.textBody)).scrollContentBackground(.hidden)
                    .padding(T.space3).frame(minHeight: 100).background(palette.strong, in: RoundedRectangle(cornerRadius: T.radiusCard))
                    .accessibilityLabel("还有什么想告诉它的？选填")
                Text("你自己的节奏、目标，或一个正在琢磨的问题……").font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
            }
            Text("每一项都可跳过。以后可以在记忆面板里修改或删除。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
        }
    }
    private func question(_ title: String, detail: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: T.space2) {
            Text(title).font(TypeStyle.ui(T.textBody, weight: .medium))
            if let detail { Text(detail).font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted) }
        }
    }
    private func choice(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).frame(maxWidth: .infinity) }
            .buttonStyle(WelcomeChoiceStyle(selected: selected)).accessibilityValue(selected ? "已选择" : "未选择")
    }
    @ViewBuilder private var batchAvailability: some View {
        if !store.importsLoaded {
            ProgressView("正在读取导入进度…").font(TypeStyle.ui(T.textMeta))
        } else if let error = store.importProgressError {
            VStack(alignment: .leading, spacing: T.space2) {
                InlineMessage(text: "暂时无法读取导入进度：\(error)", isError: true)
                Button("重新读取") { store.performUserAction { await store.refreshImports(using: knowledge) } }
                    .buttonStyle(EPGhostButtonStyle()).disabled(store.importProgressLoading)
            }
        }
    }
    private var graphStep: some View {
        VStack(spacing: T.space5) {
            batchAvailability
            if store.importsReadable {
                ProgressView(value: progress.fraction, total: 1).tint(Color(hex: store.draft.color))
                    .accessibilityLabel("资料导入进度").accessibilityValue("\(min(progress.finished, progress.total)) / \(progress.total)")
                Text(progress.total > 0 ? "\(progress.finished) / \(progress.total) 条已处理\(progress.failed > 0 ? " · \(progress.failed) 条需要重试" : "")" : "还没有导入资料，随时都可以添加。")
                    .font(TypeStyle.ui(T.textBody)).foregroundStyle(palette.muted)
                ForEach(knowledge.batches, id: \.id) { batch in
                    VStack(alignment: .leading, spacing: T.space3) {
                        HStack {
                            Text(sourceTitle(batch.sourceType)); Spacer(); Text("\(batch.finished) / \(batch.total)").foregroundStyle(palette.muted)
                        }.font(TypeStyle.ui(T.textControl, weight: .medium))
                        ForEach(batch.items.filter { $0.status == "failed" }, id: \.id) { item in
                            HStack(alignment: .top, spacing: T.space3) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.title).font(TypeStyle.ui(T.textControl))
                                    if let error = item.error { Text(error).font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.danger).textSelection(.enabled) }
                                }
                                Spacer()
                                Button("重试") { store.performUserAction { await store.retry(batchId: batch.id, itemId: item.id, using: knowledge) } }
                                    .buttonStyle(EPButtonStyle()).accessibilityLabel("重试 \(item.title)")
                            }
                        }
                    }.padding(T.space4).background(palette.surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                }
            }
        }
    }
    private func sourceTitle(_ source: String) -> String {
        switch source { case "chrome": return "Chrome 书签"; case "obsidian": return "Obsidian"; case "bilibili": return "B 站收藏夹"; case "apple_notes": return "Apple 备忘录"; default: return "笔记文件" }
    }
    private func conflictReview(_ latest: AgentProfileResponse) -> some View {
        VStack(alignment: .leading, spacing: T.space3) {
            Text("最新档案：\(latest.name)").font(TypeStyle.ui(T.textBody, weight: .medium))
            Text("\(AgentAvatar.presets.first(where: { $0.id == latest.avatarId })?.name ?? "伙伴") · \(latest.color) · \(WelcomeSetupLogic.speakingStyles.first(where: { $0.id == latest.speakingStyle })?.title ?? latest.speakingStyle)")
                .font(TypeStyle.ui(T.textMeta)).foregroundStyle(palette.muted)
            if let occupation = latest.questionnaire.occupation, !occupation.isEmpty { Text("职业：\(occupation)").font(TypeStyle.ui(T.textMeta)) }
            if let field = latest.questionnaire.industry, !field.isEmpty { Text("领域：\(field)").font(TypeStyle.ui(T.textMeta)) }
            if let goals = latest.questionnaire.goals, !goals.isEmpty { Text("目标：\(goals.joined(separator: "、"))").font(TypeStyle.ui(T.textMeta)) }
            if let interests = latest.questionnaire.interests, !interests.isEmpty { Text("关注：\(interests.joined(separator: "、"))").font(TypeStyle.ui(T.textMeta)) }
            if let additional = latest.questionnaire.additional, !additional.isEmpty { Text("补充：\(additional)").font(TypeStyle.ui(T.textMeta)).textSelection(.enabled) }
            HStack {
                Button("保留我的修改", action: store.keepDraftAfterReview).buttonStyle(EPButtonStyle())
                Button("采用最新档案", action: store.discardDraftAfterReview).buttonStyle(EPGhostButtonStyle())
            }.disabled(disabled)
        }.padding(T.space4).frame(maxWidth: .infinity, alignment: .leading).background(palette.strong, in: RoundedRectangle(cornerRadius: T.radiusCard))
    }
}

private struct WelcomeChoiceStyle: ButtonStyle {
    let selected: Bool
    @Environment(\.colorScheme) private var scheme
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl)).foregroundStyle(selected ? p.onAccent : p.ink)
            .padding(.horizontal, T.space3).frame(minHeight: T.controlHeight)
            .background(selected ? p.accent : p.surface, in: Capsule())
            .overlay(Capsule().stroke(selected ? Color.clear : p.rule, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}
#endif
