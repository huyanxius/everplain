#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchMemoryView: View {
    @ObservedObject var store: MemoryStore
    @EnvironmentObject private var appStore: AppStore
    var projectName: String?
    @State private var details = false
    @State private var settingsOpen = false
    @State private var query = ""
    @State private var origin = "all"
    @State private var sort = "recent"
    @State private var deleting: MemoryResponse?
    @FocusState private var editorFocused: Bool
    private var scoped: Bool { store.taskId != nil }
    private var visible: [MemoryResponse] {
        store.items.filter { (origin == "all" || $0.origin == origin) && (query.isEmpty || ($0.content + " " + ($0.sourceQuote ?? "")).localizedCaseInsensitiveContains(query.trimmingCharacters(in: .whitespacesAndNewlines))) }
            .sorted { sort == "recent" ? $0.updatedAt > $1.updatedAt : $0.updatedAt < $1.updatedAt }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: T.space2) {
                    Text(scoped ? "关于这个项目" : "Agent 记住了什么").font(TypeStyle.ui(T.textHeading, weight: .semibold))
                    Text("\(scoped ? projectName ?? "项目记忆" : "个人记忆") · \(store.loading ? "正在读取…" : "\(store.items.count) 条记忆")\(store.limits.map { " · 上限 \($0.maxEntries) 条" } ?? "")")
                        .font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                }
                Spacer()
                Button { settingsOpen.toggle() } label: { Label { Text("记忆设置") } icon: { NavigationIcon(kind: .settings) } }.buttonStyle(EPGhostButtonStyle())
            }
            Group {
                if store.loading || store.summaryBusy { Text(store.loading ? "正在读取记忆…" : "Agent 正在整理记忆概览…").foregroundStyle(.secondary) }
                else if !store.summary.isEmpty { Text(store.summary).font(TypeStyle.reading(T.textBody)).textSelection(.enabled) }
                else if let message = store.summaryError { Text(message); Button("重新整理") { store.performUserAction { await store.load() } }.buttonStyle(EPButtonStyle()) }
                else { Text(store.error != nil ? "暂时无法读取记忆。" : scoped ? "这里保存当前项目的研究约定。你可以先添加一条，也可以在项目对话中让 Agent 记住。" : "这里会逐渐形成 Agent 对你的了解。你可以先添加一条记忆，也可以在对话中让它记住。") }
            }.padding(.vertical, T.space4)
            HStack {
                Button(details ? "收起记忆明细" : "查看记忆明细") { details.toggle() }.buttonStyle(EPButtonStyle())
                Button("＋ 添加记忆") { store.beginEditing(); details = true; editorFocused = true }
                    .buttonStyle(EPButtonStyle(primary: true)).disabled(store.loading || store.busy || store.limits == nil || store.settings == nil || store.items.count >= (store.limits?.maxEntries ?? 0))
            }
            if let limits = store.limits, store.items.count >= limits.maxEntries { Text("已达到 \(limits.maxEntries) 条上限，可编辑已有记忆，或删除后再添加。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if scoped { Text("项目对话也会参考已开启的个人记忆。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if store.settings?.useMemory == false { Text("已暂停在对话中使用\(scoped ? "项目" : "个人")记忆，保存的内容仍可查看。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if settingsOpen {
                Card {
                    VStack(spacing: T.space4) {
                        memorySetting(scoped ? "使用项目记忆" : "使用个人记忆", detail: "在对话中按需参考已保存的记忆。关闭后仍然保留内容。", value: store.settings?.useMemory ?? false, field: "use")
                        memorySetting("从对话中学习", detail: "从对话中整理值得保留的信息。关闭后仍可手动添加。", value: store.settings?.learnMemory ?? false, field: "learn")
                    }
                }
            }
            if let error = store.error {
                InlineMessage(text: error, isError: true)
                Button("刷新记录") { store.performUserAction { await store.load() } }.buttonStyle(EPButtonStyle()).disabled(store.loading || store.busy)
            }
            if let notice = store.notice { Text(notice).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if details {
                VStack(alignment: .leading, spacing: T.space3) {
                    TextField("搜索记忆内容", text: $query).textFieldStyle(EPFieldStyle())
                    HStack {
                        WebSelect(label: "记忆来源", selection: $origin, options: [("all", "全部来源"), ("manual", "手动记录"), ("explicit", "对话中记住"), ("learned", "自动整理")])
                        WebSelect(label: "记忆排序", selection: $sort, options: [("recent", "最近更新"), ("oldest", "最早更新")])
                    }
                    Text("手动添加、修改或明确要求记住的内容，后台学习不会覆盖；这不代表每轮对话都会加载全文。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    if store.editing || store.selected != nil { detail }
                    ForEach(visible, id: \.memoryId) { item in
                        Button { store.select(item); deleting = nil } label: {
                            Card { VStack(alignment: .leading, spacing: T.space2) { Text(item.content).frame(maxWidth: .infinity, alignment: .leading); Text("\(originLabel(item)) · \(shortDate(item.updatedAt))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) } }
                        }.buttonStyle(.plain).disabled(store.busy || store.editing)
                    }
                    if !store.loading, visible.isEmpty, store.error == nil { Text(query.isEmpty && origin == "all" ? "还没有记忆" : "没有匹配的记忆").foregroundStyle(.secondary) }
                }
            }
        }.font(TypeStyle.ui(T.textControl)).onAppear { if store.editing || store.selected != nil { details = true } }.task { await store.load() }
    }
    private var detail: some View {
        Card {
            VStack(alignment: .leading, spacing: T.space3) {
                HStack {
                    Text(store.editing ? store.editor == nil ? "添加记忆" : "编辑记忆" : "记忆详情").fontWeight(.semibold)
                    Spacer()
                    Button { store.cancelEditing(); store.select(nil); deleting = nil } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).disabled(store.busy).accessibilityLabel("关闭记忆详情")
                }
                if store.editing {
                    Text(scoped ? "希望在这个项目里记住什么？" : "希望 Agent 记住什么？")
                    TextEditor(text: $store.draft).font(TypeStyle.ui(T.textBody)).frame(minHeight: 140).focused($editorFocused)
                        .scrollContentBackground(.hidden).padding(T.space3).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: T.radiusField))
                        .disabled(store.busy).onAppear { editorFocused = true }
                    Text("本条 \(store.draft.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count) / \(store.limits.map { String($0.maxContentBytes) } ?? "…") 字节（UTF-8）；通常一个汉字占 3 字节。")
                        .font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    if store.editorNeedsReview {
                        if let previous = store.editor, let latest = store.items.first(where: { $0.memoryId == previous.memoryId }) {
                            Text("最新记录 · 第 \(latest.version) 版").fontWeight(.semibold); Text(latest.content).textSelection(.enabled)
                            Text("你的草稿仍保留在上方。请对照最新记录合并需要保留的内容；核对后再保存，会以草稿替换最新记录。").font(TypeStyle.ui(T.textMeta))
                            Button("已核对，基于最新版本继续编辑") { store.acknowledgeLatestVersion() }.buttonStyle(EPButtonStyle())
                        } else { Text("这条记忆已被删除。你的草稿仍保留在上方，可复制留存；不会自动重新创建。").font(TypeStyle.ui(T.textMeta)) }
                    }
                    HStack { Button("取消") { store.cancelEditing() }.buttonStyle(EPGhostButtonStyle()).disabled(store.busy); Spacer(); Button(store.busy ? "正在保存…" : "保存记忆") { store.performUserAction { await store.save() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(!store.canSave) }
                } else if let item = store.selected {
                    Text(item.content).textSelection(.enabled)
                    Text("\(originLabel(item)) · 第 \(item.version) 版").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: T.space1) {
                        Text("范围 · \(scoped ? projectName ?? "当前项目" : "个人记忆")")
                        Text("来源 · \(originLabel(item))")
                        Text("创建于 · \(shortDate(item.createdAt))")
                        Text("更新于 · \(shortDate(item.updatedAt))")
                    }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    if let quote = item.sourceQuote, !quote.isEmpty {
                        Text("来源原话").fontWeight(.medium); Text(quote).textSelection(.enabled)
                        if let conversationId = item.sourceConversationId {
                            Button("打开来源对话") { appStore.companionTab = nil; appStore.openConversation(conversationId) }.buttonStyle(EPGhostButtonStyle())
                        }
                    }
                    HStack {
                        Button("编辑") { store.beginEditing(item); editorFocused = true }.buttonStyle(EPButtonStyle())
                        Button(store.historyId == item.memoryId ? "收起修改历史" : "修改历史 · 最近 \(min(item.version, 50)) 个版本") { store.performUserAction { await store.loadHistory(item) } }.buttonStyle(EPGhostButtonStyle()).disabled(store.historyBusy)
                        Button("删除") { deleting = item }.buttonStyle(EPGhostButtonStyle())
                    }.disabled(store.busy)
                    if store.historyId == item.memoryId {
                        if store.historyBusy { ProgressView("正在读取修改历史…") }
                        ForEach(store.history, id: \.version) { revision in
                            VStack(alignment: .leading, spacing: T.space2) {
                                Text("第 \(revision.version) 版 · \(shortDate(revision.updatedAt)) · \(originLabel(revision))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                Text(revision.content).textSelection(.enabled)
                                if let quote = revision.sourceQuote { Text(quote).foregroundStyle(.secondary).textSelection(.enabled) }
                            }.padding(.vertical, T.space2)
                        }
                    }
                    if deleting?.memoryId == item.memoryId {
                        Text("删除这条记忆及其修改历史？原始对话仍保留。")
                        HStack {
                            Button("取消") { deleting = nil }.buttonStyle(EPGhostButtonStyle())
                            Button("确认删除") { store.performUserAction { await store.remove(item); if store.error == nil { deleting = nil } } }.buttonStyle(EPButtonStyle()).foregroundStyle(.red)
                        }.disabled(store.busy)
                    }
                }
            }
        }
    }
    private func memorySetting(_ label: String, detail: String, value: Bool, field: String) -> some View {
        HStack { VStack(alignment: .leading, spacing: T.space2) { Text(label).fontWeight(.semibold); Text(detail).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }; Spacer(); WebToggle(label: label, value: value) { store.performUserAction { await store.toggle(field) } }.disabled(store.settings == nil || store.busy) }
    }
    private func originLabel(_ item: MemoryResponse) -> String { item.sourceQuote?.hasPrefix("引导问卷") == true ? "引导问卷" : ["manual":"手动记录", "explicit":"对话中记住", "learned":"自动整理"][item.origin] ?? item.origin }
    private func shortDate(_ raw: String) -> String { String(raw.prefix(10)) }
}
#endif
