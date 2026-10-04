#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

struct LibraryWorkspaceView: View {
    @ObservedObject var store: KnowledgeStore
    var onGraph: (() -> Void)? = nil
    var onChat: ((String?) -> Void)? = nil
    var onSharing: (() -> Void)? = nil
    var chatPanel: ((String) -> AnyView)? = nil
    var onChatVisibilityChange: ((String?) -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    @State private var localGraph = false
    var body: some View {
        Group {
            if localGraph { PersonalGraphView(store: store, onLibrary: { localGraph = false }, onChat: onChat, onSharing: onSharing) }
            else if let source = store.source, store.isReadOnly { KnowledgeSharedReader(store: store, source: source).id(source.document.id + store.ownerRevision.uuidString) }
            else if let source = store.source { KnowledgeReader(store: store, source: source, onGraph: showGraph, onChat: onChat, chatPanel: chatPanel, onChatVisibilityChange: onChatVisibilityChange).id(source.document.id + store.ownerRevision.uuidString) }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: T.space6) {
                        KnowledgeHeader(store: store, graph: false, onSwitch: showGraph, onSharing: onSharing)
                        if let library = store.selectedLibrary {
                            HStack {
                                Text(library.viewerAccess == "reader" ? "共享给我的 · 只读。所有者撤销访问后，这些资料将不可继续读取。" : library.description ?? "只有你可以访问这个知识库。")
                                    .font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                Spacer()
                                if !store.isReadOnly {
                                EPButton("浏览知识与关系") { store.graphMode = .points; showGraph() }.buttonStyle(EPGhostButtonStyle())
                                if let onChat { EPButton("基于本库研究") { onChat(library.id) }.buttonStyle(EPGhostButtonStyle()) }
                                }
                            }
                        }
                        HStack {
                            if !store.isReadOnly { KnowledgeViewSwitch(graph: false, action: showGraph) }
                            KnowledgeSearch(placeholder: store.manageLibraries ? "搜索名称或说明" : "搜标题、摘要、知识点", label: store.manageLibraries ? "搜索知识库" : "搜索资料", text: $store.query)
                            if store.manageLibraries { EPButton("返回资料") { store.manageLibraries = false; store.query = "" }.buttonStyle(EPGhostButtonStyle()) }
                            Button { store.performUserAction { await store.load() } } label: { WebIcon(name: .arrowClockwise, size: 18) }.buttonStyle(EPIconButtonStyle()).help("重新加载")
                        }
                        if !store.isReadOnly && !store.manageLibraries && !store.materials.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack { filter("全部 \(store.materials.count)", value: ""); ForEach(Array(Set(store.materials.map { KnowledgeLogic.kind($0.document) })).sorted(), id: \.self) { kind in filter(kind, value: kind) } }
                            }
                        }
                        if let error = store.error { KnowledgeRetry(message: error) { store.performUserAction { await store.load() } } }
                        if let error = store.sourceError { KnowledgeRetry(message: error) { store.closeDocument() } }
                        if let notice = store.notice { InlineMessage(text: notice) }
                        if let error = store.partialError { KnowledgeRetry(message: error) { store.performUserAction { await store.load() } } }
                        if store.loading || store.sourceLoading { ProgressView(store.sourceLoading ? "正在读取原文…" : "正在读取知识库…").frame(maxWidth: .infinity, minHeight: 180) }
                        else if store.manageLibraries { libraryGrid }
                        else if !store.visibleMaterials.isEmpty {
                            if store.pendingCount > 0 { Text("\(store.pendingCount) 份资料正在处理，原文可读后会自动更新。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 18)], alignment: .leading, spacing: 18) {
                                ForEach(store.visibleMaterials) { material in KnowledgeMaterialCard(store: store, material: material) }
                            }
                        } else if store.error == nil { empty }
                    }.padding(T.space8).frame(maxWidth: 1400).frame(maxWidth: .infinity)
                }.background(Palette(dark: scheme == .dark).canvas)
                    .modifier(KnowledgeAddSheet(store: store))
                    .task { await store.load(); await store.monitor() }
            }
        }.id(store.ownerRevision)
    }
    private func showGraph() { if let onGraph { onGraph() } else { localGraph = true } }
    private func filter(_ title: String, value: String) -> some View {
        Button(title) { store.kindFilter = store.kindFilter == value ? "" : value }.buttonStyle(KnowledgeTagStyle(selected: store.kindFilter == value))
    }
    private var libraryGrid: some View {
        let needle = store.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let libraries = store.ownedLibraries.filter { needle.isEmpty || (($0.name ?? "") + " " + ($0.description ?? "")).lowercased().contains(needle) }
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 18)], spacing: 18) {
            ForEach(libraries, id: \.id) { library in
                Card {
                    VStack(alignment: .leading, spacing: T.space3) {
                        Text("私有 · \(library.documents?.count ?? library.readyDocumentCount ?? 0) 份资料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        Text(library.name ?? "未命名知识库").font(TypeStyle.reading(T.textSection))
                        Text(library.description ?? "你的资料与研究依据").font(TypeStyle.ui(T.textBody)).foregroundStyle(.secondary)
                        EPButton("打开知识库 ↗") { store.selectLibrary(library.id) }.buttonStyle(EPGhostButtonStyle())
                    }
                }
            }
            if libraries.isEmpty { KnowledgeEmpty(title: "没有找到相关知识库", detail: "换个关键词，或新建一个知识库。") }
        }
    }
    private var empty: some View {
        let searching = !store.query.isEmpty || !store.kindFilter.isEmpty
        return VStack(spacing: T.space4) {
            WebIcon(name: .books, size: 32).foregroundStyle(.secondary)
            Text(searching ? "没有找到相关资料" : store.isReadOnly ? "当前没有可读资料" : store.ownedLibraries.isEmpty ? "创建你的第一个知识库" : "把第一份资料，放进来。").font(TypeStyle.reading(T.textSection))
            Text(searching ? "换个关键词，或调整筛选条件。" : store.selectedLibraryId != nil ? "在这里上传的文件只属于这个库。从其他应用导入的资料会统一放进「我的资料」。" : "收藏、笔记和文档会汇集在这里，保留原文与知识点。").foregroundStyle(.secondary)
            if searching { EPButton("清除搜索和筛选") { store.query = ""; store.kindFilter = "" }.buttonStyle(EPButtonStyle()) }
            else if !store.isReadOnly {
                HStack { EPButton("上传文件") { store.showAdd(source: .file) }; EPButton("导入浏览器收藏") { store.showAdd(source: .chrome) }; EPButton("导入 Obsidian") { store.showAdd(source: .obsidian) } }.buttonStyle(EPButtonStyle())
                EPButton("还支持印象笔记、Notion、flomo、B 站收藏等 →") { store.showAdd() }.buttonStyle(EPGhostButtonStyle())
            }
        }.multilineTextAlignment(.center).padding(.vertical, 70).frame(maxWidth: .infinity)
    }
}

private struct KnowledgeHeader: View {
    @ObservedObject var store: KnowledgeStore
    let graph: Bool
    let onSwitch: () -> Void
    var onSharing: (() -> Void)?
    @State private var editing = false
    @State private var editId: String?
    @State private var deleting = false
    @State private var sharing = false
    @State private var leaving = false
    var body: some View {
        HStack {
            WebActionMenu(width: 320) {
                Button("全部资料  \(store.allMaterials.count)") { store.selectLibrary(nil) }
                Section("我的") {
                    ForEach(store.ownedLibraries, id: \.id) { library in
                        Button("\(library.name ?? "未命名知识库")  \(library.documents?.count ?? library.readyDocumentCount ?? 0)") { store.selectLibrary(library.id) }
                    }
                    if !graph { EPButton("管理知识库") { store.selectLibrary(nil); store.manageLibraries = true } }
                    EPButton("新建知识库") { editId = nil; editing = true }.disabled(store.storage.map { store.ownedLibraries.count >= $0.maxLibraries } ?? false)
                }
                Section("共享给我的") {
                    ForEach(store.libraries.filter { $0.viewerAccess == "reader" }, id: \.id) { library in
                        Button("\(library.name ?? "未命名知识库") · 只读") { store.selectLibrary(library.id); if graph { onSwitch() } }
                    }
                    if !store.libraries.contains(where: { $0.viewerAccess == "reader" }) { EPText("还没有加入的知识库") }
                    EPButton("用邀请链接加入") { if let onSharing { onSharing() } else { sharing = true } }
                }
                if let quota = store.storage { Text("已用 \(knowledgeSize(quota.usedBytes)) / \(knowledgeSize(quota.maxBytes)) · \(quota.libraryCount) / \(quota.maxLibraries) 个知识库 · 资料仅对你可见") }
            } label: { HStack(spacing: T.space2) { Text(store.selectedLibrary?.name ?? "全部资料").font(TypeStyle.reading(28)); WebIcon(name: .caretDown, size: 18) } }
                .fixedSize().accessibilityLabel("切换知识库：\(store.selectedLibrary?.name ?? "全部资料")")
            Spacer()
            if !graph && store.selectedLibrary?.viewerAccess == "owner" { EPButton("共享") { if let onSharing { onSharing() } else { sharing = true } }.buttonStyle(EPButtonStyle()) }
            if store.isReadOnly { EPButton("退出这个知识库") { leaving = true }.buttonStyle(EPGhostButtonStyle()).disabled(store.busy) }
            if !store.isReadOnly {
                Button { if graph { onSwitch() }; store.showAdd() } label: { Label { EPText("添加") } icon: { WebIcon(name: .plus, size: 18) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(store.busy || store.full).accessibilityLabel("添加资料")
                if !graph && store.selectedLibrary != nil {
                    WebActionMenu {
                        EPButton("编辑名称与说明") { editId = store.selectedLibraryId; editing = true }
                        EPButton("删除知识库", role: .destructive) { deleting = true }
                    } label: { WebIcon(name: .dotsThreeBold, size: 18) }.fixedSize().accessibilityLabel("知识库选项").disabled(store.busy)
                }
            }
        }
        .sheet(isPresented: $editing) { KnowledgeLibraryEditor(store: store, libraryId: editId, onSaved: graph ? onSwitch : nil) }
        .sheet(isPresented: $sharing) { KnowledgeSharingSheet(store: store, onOpenLibrary: graph ? onSwitch : nil) }
        .alert("退出这个知识库？", isPresented: $leaving) {
            EPButton("保留访问", role: .cancel) {}
            EPButton("确认退出") { if let id = store.selectedLibraryId { store.performUserAction { _ = await store.leaveLibrary(id) } } }
        } message: { EPText("退出后将无法继续阅读这里的共享资料。资料本身不会被删除，重新加入需要有效邀请。") }
        .alert("删除知识库？", isPresented: $deleting) {
            EPButton("保留知识库", role: .cancel) {}
            EPButton("确认删除", role: .destructive) { if let id = store.selectedLibraryId { store.performUserAction { _ = await store.deleteLibrary(id) } } }
        } message: { EPText("此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。") }
    }
}
private struct KnowledgePublishTarget: Identifiable {
    let library: SharedKnowledgeResponse
    var id: String { library.id }
}
private struct KnowledgeSharingSheet: View {
    @ObservedObject var store: KnowledgeStore
    var onOpenLibrary: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var invitation = ""
    @State private var copiedId: String?
    @State private var publishing: KnowledgePublishTarget?
    @State private var leaving: SharedKnowledgeResponse?
    var body: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            HStack { EPText("共享知识库").font(TypeStyle.reading(28)); Spacer(); EPButton("发现主题 ↗") { if let url = store.serviceOrigin?.appendingPathComponent("discover") { NSWorkspace.shared.open(url) } }.buttonStyle(EPGhostButtonStyle()); EPButton("关闭") { dismiss() }.disabled(store.busy) }
            EPText("资料默认私有。只读邀请与公开发布可以分别管理。").foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: T.space5) {
                    Card {
                        VStack(alignment: .leading, spacing: T.space3) {
                            EPText("收到一份邀请？").font(TypeStyle.ui(18, weight: .medium))
                            EPText("加入后可以阅读对方共享的资料。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                            HStack { TextField("粘贴邀请链接或口令", text: $invitation).textFieldStyle(.roundedBorder).accessibilityLabel("邀请链接或口令"); EPButton("加入 →") { store.performUserAction { if await store.joinLibrary(invitation: invitation) { invitation = "" } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(invitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy) }
                        }
                    }
                    if let error = store.error { InlineMessage(text: error, isError: true) }
                    if let notice = store.notice { InlineMessage(text: notice) }
                    HStack { EPText("我的共享与邀请").font(TypeStyle.ui(18, weight: .medium)); Spacer(); Text("\(store.libraries.count) 个知识库").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    if store.loading { ProgressView("正在读取知识库") }
                    ForEach(store.libraries, id: \.id) { library in
                        Card {
                            VStack(alignment: .leading, spacing: T.space3) {
                                Label { Text(library.viewerAccess == "owner" ? "我拥有的知识库" : "加入的只读知识库") } icon: { WebIcon(name: .books, size: 16) }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                Button(library.name ?? "未命名知识库") { store.selectLibrary(library.id); onOpenLibrary?(); dismiss() }.buttonStyle(.plain).font(TypeStyle.reading(23))
                                if let description = library.description { Text(description).foregroundStyle(.secondary) }
                                Text("\(library.readyDocumentCount ?? library.documents?.filter { $0.status == "ready" }.count ?? 0) 份可读资料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                if library.viewerAccess == "owner" {
                                    HStack { Text(library.sharingEnabled == true ? "只读邀请已开启" : "只读邀请未开启").font(TypeStyle.ui(T.textMeta)); Spacer(); Button(library.sharingEnabled == true ? "关闭邀请共享" : "开启只读邀请") { store.performUserAction { _ = await store.setSharing(libraryId: library.id, enabled: library.sharingEnabled != true) } }.buttonStyle(EPGhostButtonStyle()) }
                                    if library.sharingEnabled == true, let url = store.invitationURL(for: library) {
                                        EPText("持有此链接并登录的人可加入，只能阅读。关闭共享会撤销成员访问和旧邀请。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                        Button(copiedId == library.id ? "已复制邀请链接" : "复制邀请链接") { NSPasteboard.general.clearContents(); if NSPasteboard.general.setString(url.absoluteString, forType: .string) { copiedId = library.id } else { store.error = "复制失败，请手动复制链接。" } }.buttonStyle(EPButtonStyle())
                                    }
                                    Divider()
                                    if let publication = library.publication { HStack { Text("已公开 \(publication.documentCount) 份资料").font(TypeStyle.ui(T.textMeta)); Spacer(); EPButton("撤回公开") { store.performUserAction { _ = await store.unpublishLibrary(library.id) } }.buttonStyle(EPGhostButtonStyle()) } }
                                    else { EPButton("发布到公共主题 ↗") { publishing = KnowledgePublishTarget(library: library); store.error = nil }.buttonStyle(EPGhostButtonStyle()) }
                                } else { HStack { EPButton("打开 ↗") { store.selectLibrary(library.id); onOpenLibrary?(); dismiss() }.buttonStyle(EPButtonStyle()); EPButton("退出知识库") { leaving = library }.buttonStyle(EPGhostButtonStyle()) } }
                            }.disabled(store.busy)
                        }
                    }
                    if store.libraries.isEmpty && !store.loading { KnowledgeEmpty(title: "还没有知识库", detail: "导入自己的资料，或使用邀请加入知识库。"); EPButton("导入资料 →") { dismiss(); store.showAdd() }.buttonStyle(EPButtonStyle()) }
                }
            }
        }.padding(T.space8).frame(width: 780, height: 740).interactiveDismissDisabled(store.busy).id(store.ownerRevision)
            .sheet(item: $publishing) { target in KnowledgePublishSheet(store: store, library: target.library) }
            .alert("退出这个知识库？", isPresented: Binding(get: { leaving != nil }, set: { if !$0 { leaving = nil } })) { EPButton("保留访问", role: .cancel) { leaving = nil }; EPButton("确认退出") { if let library = leaving { store.performUserAction { _ = await store.leaveLibrary(library.id) } }; leaving = nil } } message: { EPText("退出后将无法继续阅读这里的共享资料。资料本身不会被删除，重新加入需要有效邀请。") }
    }
}
private struct KnowledgePublishSheet: View {
    @ObservedObject var store: KnowledgeStore
    let library: SharedKnowledgeResponse
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var topics = ""
    @State private var confirmed = false
    private var documentCount: Int { library.readyDocumentCount ?? library.documents?.filter { $0.status == "ready" }.count ?? 0 }
    private var topicList: [String] { topics.components(separatedBy: CharacterSet(charactersIn: "、,，")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty } }
    var body: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            EPText("发布到公共主题").font(TypeStyle.reading(26))
            EPText("公共标题"); TextField("公共标题", text: $title).textFieldStyle(.roundedBorder)
            EPText("主题简介"); TextEditor(text: $description).frame(height: 100).border(.quaternary)
            EPText("主题标签"); TextField("用顿号分隔，最多 12 个", text: $topics).textFieldStyle(.roundedBorder)
            Toggle("我确认将当前 \(documentCount) 份可读资料及原文公开，任何人都可阅读。以后新增的资料不会自动公开。", isOn: $confirmed).toggleStyle(.checkbox)
            if let error = store.error { InlineMessage(text: error, isError: true) }
            HStack { EPButton("取消") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); Button(store.busy ? "正在公开…" : "确认公开当前资料") { store.performUserAction { if await store.publishLibrary(library.id, title: title, description: description, topics: topicList, confirmedPublic: confirmed, expectedDocumentCount: documentCount) { dismiss() } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(!confirmed || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 100 || description.count > 1000 || topicList.count > 12) }
        }.padding(T.space8).frame(width: 580).disabled(store.busy).interactiveDismissDisabled(store.busy)
            .onAppear { title = library.name ?? ""; description = library.description ?? "" }
    }
}

private struct KnowledgeLibraryEditor: View {
    @ObservedObject var store: KnowledgeStore
    let libraryId: String?
    var onSaved: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @FocusState private var nameFocused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            Text(libraryId == nil ? "新建知识库" : "编辑知识库").font(TypeStyle.reading(T.textSection))
            EPText("知识库名称"); TextField("知识库名称", text: $name).textFieldStyle(.roundedBorder).focused($nameFocused)
            EPText("说明（选填）"); TextEditor(text: $description).frame(height: 90).overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            if let error = store.error { InlineMessage(text: error, isError: true) }
            HStack { EPButton("取消") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); EPButton("保存知识库") { store.performUserAction { if await store.saveLibrary(id: libraryId, name: name, description: description) { onSaved?(); dismiss() } } }.keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 100 || description.count > 1000) }.buttonStyle(EPButtonStyle())
        }.padding(T.space8).frame(width: 480).disabled(store.busy).interactiveDismissDisabled(store.busy)
            .onAppear { if let library = store.libraries.first(where: { $0.id == libraryId }) { name = library.name ?? ""; description = library.description ?? "" }; nameFocused = true }
    }
}
private struct KnowledgeMaterialCard: View {
    @ObservedObject var store: KnowledgeStore
    let material: KnowledgeMaterial
    @State private var deleting = false
    var body: some View {
        let document = material.document
        let kind = KnowledgeLogic.kind(document)
        let readOnly = material.library.viewerAccess != "owner"
        let retryable = document.status == "ready" && (document.knowledgeStatus == "failed" || document.indexStatus == "failed")
        Card {
            VStack(alignment: .leading, spacing: T.space3) {
                HStack {
                    Label { Text(kind) } icon: { WebIcon(name: kind == "图片" ? .image : kind == "演示文稿" ? .presentation : .fileText, size: 16) }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    Spacer()
                    if store.selectedLibraryId == nil { Button(material.library.name ?? "知识库") { store.selectLibrary(material.library.id) }.buttonStyle(.plain).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    if !readOnly {
                        WebActionMenu {
                            if retryable { EPButton("重试处理") { store.performUserAction { await store.retryDocument(material) } } }
                            if document.status == "failed" { EPButton("重新上传") { store.selectLibrary(material.library.id); store.showAdd(source: .file) } }
                            EPButton("删除资料", role: .destructive) { deleting = true }
                        } label: { WebIcon(name: .dotsThreeBold, size: 18) }.fixedSize().disabled(store.busy).accessibilityLabel("管理资料 \(document.filename)")
                    }
                }
                if kind == "图片" {
                    Group {
                        if let data = store.images[document.id], let image = NSImage(data: data) { Image(nsImage: image).resizable().scaledToFit() }
                        else { Label { EPText("图片预览暂不可用") } icon: { WebIcon(name: .image, size: 28) }.foregroundStyle(.secondary) }
                    }.frame(maxWidth: .infinity, minHeight: 110, maxHeight: 150).task { await store.loadImage(documentId: document.id) }
                }
                Button { store.performUserAction { await store.openDocument(libraryId: material.library.id, documentId: document.id) } } label: {
                    Text(document.filename).font(TypeStyle.reading(21)).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).disabled(document.status != "ready")
                Text(document.status == "failed" ? "资料解析失败，可查看原因后重新上传。" : document.knowledge?.summary ?? "原文已保存，知识摘要将在整理完成后显示。").font(TypeStyle.ui(T.textBody)).foregroundStyle(.secondary).lineLimit(4)
                let status = KnowledgeLogic.status(document)
                if !status.isEmpty { Text(status).font(TypeStyle.ui(T.textMeta)).foregroundStyle(retryable || document.status == "failed" ? Color.red : Color.secondary) }
                let errors = [document.errorMessage, document.knowledgeError, document.indexError].compactMap { $0 }.joined(separator: "；")
                if !errors.isEmpty { Text(errors).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.red).textSelection(.enabled) }
                if retryable && !readOnly { EPButton("重试") { store.performUserAction { await store.retryDocument(material) } }.buttonStyle(EPGhostButtonStyle()).disabled(store.busy) }
                if store.selectedLibraryId != nil { ForEach(document.warnings ?? [], id: \.self) { Text($0).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) } }
                Text((store.sourceURL(for: material)?.host?.replacingOccurrences(of: "www.", with: "") ?? knowledgeSize(document.sizeBytes)) + (document.knowledge.map { " · \($0.topics.count) 个知识点" } ?? "")).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            }
        }.alert("删除资料？", isPresented: $deleting) {
            EPButton("保留资料", role: .cancel) {}
            EPButton("确认删除资料", role: .destructive) { store.performUserAction { _ = await store.deleteDocument(material) } }
        } message: { Text("删除“\(document.filename)”及其知识与索引？此操作无法撤销。") }
    }
}

struct HomeMaterialsSummaryView: View {
    @ObservedObject var store: KnowledgeStore
    let onOpen: () -> Void
    var onDocument: ((String, String) -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack { EPText("资料库").font(TypeStyle.reading(T.textSection)); Spacer(); EPButton("查看全部 →", action: onOpen).buttonStyle(EPGhostButtonStyle()) }
            Text("\(store.ownedLibraries.count) 个知识库 · \(store.allMaterials.count) 份资料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            if store.loading { ProgressView("正在读取资料…") }
            else if let error = store.error { KnowledgeRetry(message: error) { store.performUserAction { await store.load() } } }
            else if store.allMaterials.isEmpty { EPText("收藏、笔记和文档会汇集在这里，保留原文与知识点。").foregroundStyle(.secondary) }
            ForEach(Array(store.allMaterials.sorted { $0.document.createdAt > $1.document.createdAt }.prefix(3))) { material in
                Button { if let onDocument { onDocument(material.library.id, material.document.id) } else { onOpen() } } label: {
                    HStack { WebIcon(name: .fileText, size: 18); Text(material.document.filename).lineLimit(1); Spacer(); Text(KnowledgeLogic.kind(material.document)).foregroundStyle(.secondary) }
                }.buttonStyle(.plain)
            }
        }.task { if store.libraries.isEmpty { await store.load() } }
    }
}

private struct KnowledgeSharedReader: View {
    @ObservedObject var store: KnowledgeStore
    let source: SharedDocumentSourceResponse
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack { EPButton("← 返回资料") { store.closeDocument() }.buttonStyle(EPGhostButtonStyle()); EPText("只读原文").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); Spacer() }
            EPText("共享给我的 · 只读。所有者撤销访问后，这些资料将不可继续读取。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            HSplitView {
                ScrollView {
                    VStack(alignment: .leading, spacing: T.space2) {
                        ForEach(store.selectedLibrary?.documents ?? [], id: \.id) { document in
                            Button(document.filename) { store.performUserAction { await store.openDocument(libraryId: source.knowledgeBaseId, documentId: document.id) } }.buttonStyle(EPGhostButtonStyle()).disabled(document.status != "ready")
                        }
                    }
                }.frame(minWidth: 180, idealWidth: 230, maxWidth: 300)
                ScrollView {
                    VStack(alignment: .leading, spacing: T.space5) {
                        Text(source.document.filename).font(TypeStyle.reading(28))
                        ForEach(source.segments, id: \.segmentId) { Text($0.text).font(TypeStyle.reading(17)).lineSpacing(7).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    }.padding(T.space6)
                }
            }
        }.padding(T.space8).task { await store.monitor() }
    }
}

private struct KnowledgeReader: View {
    @ObservedObject var store: KnowledgeStore
    let source: SharedDocumentSourceResponse
    let onGraph: () -> Void
    var onChat: ((String?) -> Void)?
    var chatPanel: ((String) -> AnyView)?
    var onChatVisibilityChange: ((String?) -> Void)?
    @State private var query = ""
    @State private var searchOpen = false
    @State private var outlineOpen = false
    @State private var panelOpen = true
    @State private var agentOpen = false
    @State private var editing = false
    @State private var editDraft = LibraryEditorDraft()
    @State private var zoom = 100
    @State private var page = 0
    @State private var copied = false
    private let pageSize = 24
    private var visible: [SharedSourceSegmentResponse] { source.segments.filter { query.isEmpty || ($0.text + " " + KnowledgeLogic.locator($0)).localizedCaseInsensitiveContains(query) } }
    private var pageCount: Int { max(1, Int(ceil(Double(visible.count) / Double(pageSize)))) }
    private var currentPage: Int { min(page, pageCount - 1) }
    private var segments: [SharedSourceSegmentResponse] { Array(visible.dropFirst(currentPage * pageSize).prefix(pageSize)) }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { store.closeDocument() } label: { Label { EPText("知识库") } icon: { WebIcon(name: .arrowLeft, size: 17) } }.buttonStyle(EPGhostButtonStyle())
                WebSelect(label: "切换资料", selection: Binding(get: { source.document.id }, set: { id in store.performUserAction { await store.openDocument(libraryId: source.knowledgeBaseId, documentId: id) } }), options: (store.selectedLibrary?.documents ?? []).filter { $0.status == "ready" }.map { ($0.id, $0.filename) }).frame(maxWidth: 240)
                Button(action: onGraph) { WebIcon(name: .graph, size: 18) }.help("知识与关系")
                Spacer()
                if chatPanel != nil { EPButton("结合本库提问") { agentOpen = true; panelOpen = true; onChatVisibilityChange?(source.knowledgeBaseId) }.buttonStyle(EPButtonStyle()) }
                else if let onChat { EPButton("结合本库提问") { onChat(source.knowledgeBaseId) }.buttonStyle(EPButtonStyle()) }
                Button { outlineOpen.toggle() } label: { WebIcon(name: .listBullets, size: 18) }.help(outlineOpen ? "收起章节" : "展开章节")
                Button { searchOpen.toggle() } label: { WebIcon(name: .magnifyingGlass, size: 18) }.help("在材料中查找").keyboardShortcut("f", modifiers: [.command, .shift])
                Button { panelOpen.toggle(); if agentOpen { onChatVisibilityChange?(panelOpen ? source.knowledgeBaseId : nil) } } label: { WebIcon(name: .sidebarSimple, size: 18) }.help(panelOpen ? "收起研究侧栏" : "展开研究侧栏")
            }.buttonStyle(EPIconButtonStyle()).padding(T.space4)
            Divider()
            HSplitView {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: T.space6) {
                            HStack {
                                Label { EPText("原文") } icon: { WebIcon(name: .fileText, size: 16) }
                                Text("\(source.knowledgeBaseName) · \(knowledgeSize(source.document.sizeBytes)) · \(source.segments.count) 段").foregroundStyle(.secondary)
                                Spacer(); HStack(spacing: T.space1) { EPText("缩放").foregroundStyle(.secondary); WebSelect(label: "阅读缩放", selection: Binding(get: { String(zoom) }, set: { if let value = Int($0), [90, 100, 110, 125].contains(value) { zoom = value } }), options: [90, 100, 110, 125].map { (String($0), "\($0)%") }).frame(width: 94) }
                            }.font(TypeStyle.ui(T.textMeta))
                            Text(source.document.filename).font(TypeStyle.reading(30)).textSelection(.enabled)
                            if let summary = source.document.knowledge?.summary { Text(summary).foregroundStyle(.secondary).textSelection(.enabled) }
                            if outlineOpen { outline }
                            if searchOpen {
                                HStack { KnowledgeSearch(placeholder: "在原文中查找", label: "搜索原文", text: $query); Text("\(visible.count) / \(source.segments.count) 段").font(TypeStyle.ui(T.textMeta)); Button { searchOpen = false; query = "" } label: { WebIcon(name: .x, size: 18) } }
                            }
                            ForEach(source.document.warnings ?? [], id: \.self) { InlineMessage(text: $0) }
                            ForEach(segments, id: \.segmentId) { segment in
                                VStack(alignment: .leading, spacing: T.space2) {
                                    Button(KnowledgeLogic.locator(segment)) { select(segment.segmentId) }.buttonStyle(.plain).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                    Text(segment.text).font(segment.kind == "heading" ? TypeStyle.reading(23 * Double(zoom) / 100) : TypeStyle.reading(17 * Double(zoom) / 100)).lineSpacing(7).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                                        .onTapGesture { select(segment.segmentId) }
                                }.padding(T.space3).background(store.selectedSegmentId == segment.segmentId ? Color.accentColor.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem)).id(segment.segmentId)
                            }
                            if segments.isEmpty { EPText("没有找到相关原文，换个关键词试试。").foregroundStyle(.secondary) }
                            HStack { EPButton("上一页") { page = max(0, currentPage - 1) }.disabled(currentPage == 0); Spacer(); Text("第 \(currentPage + 1) / \(pageCount) 页").foregroundStyle(.secondary); Spacer(); EPButton("下一页") { page = currentPage + 1 }.disabled(currentPage + 1 >= pageCount) }.buttonStyle(EPButtonStyle())
                        }.padding(T.space8)
                    }.onChange(of: query) { _ in page = 0 }
                        .onChange(of: store.selectedSegmentId) { id in locate(id, proxy: proxy) }
                        .onChange(of: page) { _ in if let id = store.selectedSegmentId { proxy.scrollTo(id, anchor: .center) } }
                        .onAppear { locate(store.selectedSegmentId, proxy: proxy) }
                }.frame(minWidth: 420)
                if panelOpen {
                    ScrollView {
                        VStack(alignment: .leading, spacing: T.space5) {
                            if chatPanel != nil { LibrarySegmentedControl(label: "资料研究内容", selection: Binding(get: { agentOpen ? "ask" : "knowledge" }, set: { next in agentOpen = next == "ask"; onChatVisibilityChange?(agentOpen ? source.knowledgeBaseId : nil) }), options: [("knowledge", "知识点"), ("ask", "结合本库提问")], horizontalPadding: T.space2) }
                            if let segment = source.segments.first(where: { $0.segmentId == store.selectedSegmentId }) {
                                Card {
                                    VStack(alignment: .leading, spacing: T.space3) {
                                        HStack { EPText("原文依据").font(TypeStyle.ui(17, weight: .medium)); Spacer(); Button { store.selectedSegmentId = nil } label: { WebIcon(name: .x, size: 18) }.buttonStyle(.plain) }
                                        Text(KnowledgeLogic.locator(segment)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                        Text(segment.text).lineLimit(12).textSelection(.enabled)
                                        Button(copied ? "已复制" : "复制原文与定位") { NSPasteboard.general.clearContents(); copied = NSPasteboard.general.setString(source.document.filename + "\n" + KnowledgeLogic.locator(segment) + "\n" + segment.text, forType: .string) }.buttonStyle(EPButtonStyle())
                                        Text("\(source.document.filename) · \(source.knowledgeBaseName)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            if agentOpen, let chatPanel {
                                HStack { EPText("结合本库提问").font(TypeStyle.ui(17, weight: .medium)); Spacer(); Button { agentOpen = false; onChatVisibilityChange?(nil) } label: { WebIcon(name: .x, size: 18) }.buttonStyle(.plain).accessibilityLabel("收起 Agent") }
                                chatPanel(source.knowledgeBaseId).frame(height: 560)
                            } else {
                            HStack { EPText("知识点").font(TypeStyle.reading(T.textSection)); Spacer(); if !editing && !store.isReadOnly && !["queued", "running"].contains(source.document.knowledgeStatus ?? "queued") { Button { editDraft = LibraryEditorDraft(knowledge: source.document.knowledge); editing = true } label: { WebIcon(name: .pencilSimple, size: 18) }.buttonStyle(.plain).help("编辑知识") } }
                            if editing { KnowledgeEditor(store: store, source: source, draft: $editDraft, onCancel: { editing = false }, onSaved: { editing = false }) }
                            else if let knowledge = source.document.knowledge {
                                ForEach(Array(knowledge.topics.enumerated()), id: \.offset) { _, topic in
                                    VStack(alignment: .leading, spacing: T.space2) {
                                        Button(topic.title) { if let id = topic.segmentIds.first { select(id) } }.buttonStyle(.plain).font(TypeStyle.ui(16, weight: .medium))
                                        Text(topic.summary).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                        evidenceButtons(topic.segmentIds, prefix: "原文")
                                    }.padding(.bottom, T.space3)
                                }
                                if !(knowledge.relations ?? []).isEmpty { Divider(); EPText("知识关系").font(TypeStyle.reading(T.textSection)) }
                                ForEach(Array((knowledge.relations ?? []).enumerated()), id: \.offset) { _, relation in
                                    VStack(alignment: .leading, spacing: T.space2) { Text("\(relation.source) → \(relation.target)").font(TypeStyle.ui(16, weight: .medium)); Text(relation.label).foregroundStyle(.secondary); evidenceButtons(relation.segmentIds, prefix: "依据") }
                                }
                            } else { Text(source.document.knowledgeStatus == "failed" ? "知识整理暂未完成，请到资料详情重试。" : "正在整理知识点，完成后会显示在这里。").foregroundStyle(.secondary) }
                            }
                        }.padding(T.space5)
                    }.frame(minWidth: 280, idealWidth: 340, maxWidth: 430)
                }
            }
        }
            .onExitCommand { searchOpen = false; query = "" }
            .onDisappear { onChatVisibilityChange?(nil) }
            .task { await store.monitor() }
    }
    private var outline: some View {
        VStack(alignment: .leading, spacing: T.space2) {
            EPText("章节").font(TypeStyle.ui(16, weight: .medium))
            let headings = source.segments.filter { $0.kind == "heading" || !$0.locator.sectionPath.isEmpty }
            if headings.isEmpty { EPText("这份资料没有章节目录。").foregroundStyle(.secondary) }
            ForEach(headings, id: \.segmentId) { segment in Button(segment.locator.sectionPath.last ?? KnowledgeLogic.locator(segment)) { select(segment.segmentId) }.buttonStyle(EPGhostButtonStyle()) }
        }
    }
    private func select(_ id: String) { query = ""; store.selectedSegmentId = id; if !panelOpen && agentOpen { onChatVisibilityChange?(source.knowledgeBaseId) }; panelOpen = true; copied = false; if let index = source.segments.firstIndex(where: { $0.segmentId == id }) { page = index / pageSize } }
    private func locate(_ id: String?, proxy: ScrollViewProxy) { guard let id, let index = source.segments.firstIndex(where: { $0.segmentId == id }) else { return }; query = ""; page = index / pageSize; proxy.scrollTo(id, anchor: .center) }
    private func evidenceButtons(_ ids: [String], prefix: String) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 72))], alignment: .leading) { ForEach(Array(ids.enumerated()), id: \.offset) { index, id in Button("\(prefix) \(index + 1)") { select(id) }.buttonStyle(KnowledgeTagStyle(selected: store.selectedSegmentId == id)) } }
    }
}

private struct KnowledgeEditor: View {
    @ObservedObject var store: KnowledgeStore
    let source: SharedDocumentSourceResponse
    @Binding var draft: LibraryEditorDraft
    let onCancel: () -> Void
    let onSaved: () -> Void
    @State private var expandedEvidenceId: UUID?
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            EPText("修改整理结果，保留每个知识点与关系的原文依据。").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: T.space4) {
                    EPText("资料摘要"); TextEditor(text: $draft.summary).frame(height: 90).border(.quaternary)
                    HStack { EPText("知识点").font(TypeStyle.ui(T.textHeading, weight: .medium)); Spacer(); Button { draft.topics.append(LibraryTopicDraft(value: .init(segmentIds: [], summary: "", title: ""))) } label: { WebIcon(name: .plus, size: 17) }.buttonStyle(EPGhostButtonStyle()).accessibilityLabel("添加知识点") }
                    ForEach(Array(draft.topics.enumerated()), id: \.element.id) { index, topic in
                        LibraryEditorFieldset(title: "知识点 \(index + 1)") {
                            EPText("名称")
                            TextField("名称", text: Binding(get: { draft.topics.first { $0.id == topic.id }?.value.title ?? "" }, set: { draft.renameTopic(topic.id, title: $0) })).textFieldStyle(.roundedBorder)
                            EPText("说明")
                            TextEditor(text: topicBinding(topic.id).summary).frame(height: 88).border(.quaternary)
                            sourcePicker(ids: topicBinding(topic.id).segmentIds, rowId: topic.id, label: "知识点 \(index + 1) 原文依据")
                            EPButton("删除知识点", role: .destructive) { draft.removeTopic(topic.id) }.buttonStyle(EPGhostButtonStyle())
                        }.zIndex(expandedEvidenceId == topic.id ? 100 : 0)
                    }
                    HStack { EPText("关系").font(TypeStyle.ui(T.textHeading, weight: .medium)); Spacer(); Button { draft.relations.append(LibraryRelationDraft(value: .init(label: "", segmentIds: [], source: "", target: ""))) } label: { WebIcon(name: .plus, size: 17) }.buttonStyle(EPGhostButtonStyle()).accessibilityLabel("添加关系").disabled(draft.topics.count < 2) }
                    ForEach(Array(draft.relations.enumerated()), id: \.element.id) { index, relation in
                        LibraryEditorFieldset(title: "关系 \(index + 1)") {
                            HStack(alignment: .top, spacing: T.space2) {
                                VStack(alignment: .leading, spacing: T.space2) { EPText("起点"); WebSelect(label: "起点", selection: relationBinding(relation.id).source, options: topicOptions) }
                                VStack(alignment: .leading, spacing: T.space2) { EPText("终点"); WebSelect(label: "终点", selection: relationBinding(relation.id).target, options: topicOptions) }
                            }.zIndex(2)
                            EPText("关系说明")
                            TextField("关系说明", text: relationBinding(relation.id).label).textFieldStyle(.roundedBorder)
                            sourcePicker(ids: relationBinding(relation.id).segmentIds, rowId: relation.id, label: "关系 \(index + 1) 原文依据")
                            EPButton("删除关系", role: .destructive) { draft.relations.removeAll { $0.id == relation.id } }.buttonStyle(EPGhostButtonStyle())
                        }.zIndex(expandedEvidenceId == relation.id ? 100 : 0)
                    }
            }
            if let error = store.error { InlineMessage(text: error, isError: true) }
            HStack { EPButton("保存知识") { let input = draft.request; store.performUserAction { if await store.saveKnowledge(input) { onSaved() } } }.buttonStyle(EPButtonStyle(primary: true)).disabled(store.busy || draft.topics.isEmpty); EPButton("取消", action: onCancel).buttonStyle(EPGhostButtonStyle()); Spacer() }
        }.disabled(store.busy)
    }
    private var topicOptions: [(String, String)] { [("", epLocalized("选择知识点"))] + draft.topics.map { ($0.value.title, $0.value.title.isEmpty ? epLocalized("未命名") : $0.value.title) } }
    private func topicBinding(_ id: UUID) -> Binding<UpdateKnowledgeTopic> {
        Binding(get: { draft.topics.first { $0.id == id }?.value ?? .init(segmentIds: [], summary: "", title: "") }, set: { draft.updateTopic(id, value: $0) })
    }
    private func relationBinding(_ id: UUID) -> Binding<UpdateKnowledgeRelation> {
        Binding(get: { draft.relations.first { $0.id == id }?.value ?? .init(label: "", segmentIds: [], source: "", target: "") }, set: { draft.updateRelation(id, value: $0) })
    }
    private func sourcePicker(ids: Binding<[String]>, rowId: UUID, label: String) -> some View {
        VStack(alignment: .leading, spacing: T.space2) {
            Text("原文依据 · \(ids.wrappedValue.count) 段").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            EPText("选择原文")
            LibraryEvidenceSelect(label: label, selection: ids, options: source.segments.map { segment in (segment.segmentId, (segment.locator.page.map { "第 \($0) 页" } ?? "第 \(segment.ordinal + 1) 段") + " · " + String(segment.text.prefix(60))) }, onExpansionChange: { open in if open { expandedEvidenceId = rowId } else if expandedEvidenceId == rowId { expandedEvidenceId = nil } })
            EPText("可选择多段原文，再次选择可取消。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
        }.zIndex(expandedEvidenceId == rowId ? 100 : 0)
    }
}
private struct LibraryEditorFieldset<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: T.space3) {
            HStack { EPText(title).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 1) }
            content.font(TypeStyle.ui(T.textControl))
        }.padding(.top, T.space3)
    }
}

struct PersonalGraphView: View {
    @ObservedObject var store: KnowledgeStore
    var onLibrary: (() -> Void)? = nil
    var onChat: ((String?) -> Void)? = nil
    var onSharing: (() -> Void)? = nil
    @State private var localLibrary = false
    @State private var graphOpen = true
    private var graph: NativeKnowledgeGraph { store.projection }
    private var searching: String { store.graphQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    var body: some View {
        Group {
            if localLibrary { AnyView(LibraryWorkspaceView(store: store, onGraph: { localLibrary = false }, onChat: onChat, onSharing: onSharing)) }
            else {
                VStack(alignment: .leading, spacing: T.space4) {
                    KnowledgeHeader(store: store, graph: true, onSwitch: openLibrary, onSharing: onSharing)
                    HStack {
                        KnowledgeViewSwitch(graph: true, action: openLibrary)
                        LibrarySegmentedControl(label: "知识的呈现方式", selection: Binding(get: { store.graphMode.rawValue }, set: { if let value = KnowledgeStore.GraphMode(rawValue: $0) { store.graphMode = value } }), options: KnowledgeStore.GraphMode.allCases.map { ($0.rawValue, $0.rawValue) }).fixedSize(horizontal: true, vertical: false)
                        if store.graphMode == .points { KnowledgeSearch(placeholder: "知识点、概念或方法", label: "搜索知识", text: $store.graphQuery) }
                        Spacer()
                    }
                    if let error = store.error { InlineMessage(text: error, isError: true) }
                    if let error = store.graphError { KnowledgeRetry(message: error) { store.performUserAction { await store.loadGraph() } } }
                    if store.graphMode == .points { points }
                    else {
                        HStack {
                            KnowledgeSearch(placeholder: store.selectedLibraryId == nil ? "找一个节点" : "知识点、概念或方法", label: "搜索我的图谱", text: $store.graphQuery).frame(maxWidth: 340)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack { ForEach(graph.nodes.filter { $0.kind == "topic" }) { node in Button(node.label) { if store.selectedNodeId == node.id { store.closeGraphDetail() } else { store.performUserAction { await store.selectNode(node.id) } } }.buttonStyle(KnowledgeTagStyle(selected: store.selectedNodeId == node.id)) } }
                            }
                        }
                        HStack {
                            Text(caption).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                            Spacer()
                            if store.selectedLibraryId == nil { Button(store.busy ? "正在更新…" : "更新图谱") { store.performUserAction { await store.refreshGraph() } }.buttonStyle(EPGhostButtonStyle()).disabled(store.busy) }
                            else { Button(graphOpen ? "收起知识导图" : "展开知识导图") { graphOpen.toggle() }.buttonStyle(EPGhostButtonStyle()) }
                            if let onChat { Button("和 \(store.personalGraph?.name ?? "Agent") 聊聊 →") { onChat(store.selectedLibraryId ?? store.personalGraph?.sources[store.selectedNodeId ?? ""]?.libraryId) }.buttonStyle(EPGhostButtonStyle()) }
                        }
                        if (store.graphLoading && store.selectedLibrary == nil) || (store.loading && store.selectedLibraryId != nil) { ProgressView("正在展开你的知识图谱").frame(maxWidth: .infinity, maxHeight: .infinity) }
                        else if let library = store.selectedLibrary, graph.points.isEmpty {
                            KnowledgeEmpty(title: "知识尚未整理完成", detail: (library.documents ?? []).isEmpty ? "上传资料后，将在这里生成知识点和知识导图。" : "资料仍可打开阅读，处理状态可在资料页中查看。").frame(maxHeight: .infinity)
                        } else if graphOpen {
                            ZStack(alignment: .center) {
                                KnowledgeGraphCanvas(graph: graph, selectedNodeId: store.selectedNodeId, selectedEdgeId: store.selectedEdgeId, avatarId: store.personalGraph?.avatarId, avatarColor: store.personalGraph?.color, ownerRevision: store.ownerRevision, edgeDirections: store.selectedLibraryId == nil ? Dictionary((store.personalGraph?.edges ?? []).map { ($0.id, $0.direction) }, uniquingKeysWith: { first, _ in first }) : [:], onNode: { id in store.performUserAction { await store.selectNode(id) } }, onEdge: { id in store.closeGraphDetail(); store.selectedEdgeId = id })
                                if store.selectedLibraryId == nil && store.personalGraph?.documentCount == 0 {
                                    VStack(spacing: T.space3) { EPText("每个想法，都可以从这里开始。").font(TypeStyle.reading(24)); EPText("导入几份收藏或笔记，慢慢长出你的知识图谱。").foregroundStyle(.secondary); EPButton("带来第一份资料 ↗") { store.showAdd() }.buttonStyle(EPButtonStyle()) }.padding(T.space6).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                                }
                                if showDetail { HStack { Spacer(minLength: 180); graphDetail.frame(width: 340).padding(T.space3) } }
                                VStack { Spacer(); HStack { EPText("我   主题   资料   知识点").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(T.space3); Spacer(); if (store.personalGraph?.pendingCount ?? 0) > 0 && store.selectedLibraryId == nil { Text("\(store.personalGraph?.pendingCount ?? 0) 份资料等待归类\(store.personalGraph?.mode == "semantic" ? "，需要完成语义索引" : "")").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(T.space3) } } }
                            }.frame(minHeight: 390).clipped()
                        } else { points }
                        if store.selectedLibraryId == nil && store.personalGraph?.mode == "mock" { EPText("当前为本地演示归类；接入专用模型后可进行语义归类与主题命名。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                        if store.selectedLibrary != nil { EPText("同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    }
                }.padding(T.space8).modifier(KnowledgeAddSheet(store: store, onOpenLibrary: openLibrary))
                    .onChange(of: store.graphQuery) { value in if !value.isEmpty { store.closeGraphDetail() } }
                    .onChange(of: store.graphMode) { _ in store.graphQuery = ""; store.closeGraphDetail() }
                    .task { async let catalog: Void = store.load(); async let graph: Void = store.loadGraph(); _ = await (catalog, graph); await store.monitor() }
            }
        }.id(store.ownerRevision)
    }
    private func openLibrary() { if let onLibrary { onLibrary() } else { localLibrary = true } }
    private var caption: String {
        if let library = store.selectedLibrary { return "\(library.name ?? "知识库") · \(graph.points.count) 个知识点 · \(library.documents?.count ?? 0) 份资料" }
        return "\(store.personalGraph?.documentCount ?? 0) 份资料 · \(store.personalGraph?.topicCount ?? 0) 个主题 · \(graph.nodes.count) 节点 · \(graph.edges.count) 关系"
    }
    private var showDetail: Bool { !searching.isEmpty || store.selectedNodeId != nil || store.selectedEdgeId != nil }
    private var points: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: T.space6) {
                let count = store.pointsLibraries.reduce(0) { $0 + KnowledgeLogic.points($1, query: store.graphQuery).count }
                Text("\(count) 个知识点 · \(store.materials.count) 份资料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                if store.loading { ProgressView("正在读取知识…") }
                if let error = store.partialError { KnowledgeRetry(message: error) { store.performUserAction { await store.load() } } }
                ForEach(store.pointsLibraries, id: \.id) { library in
                    if store.selectedLibraryId == nil { Button(library.name ?? "知识库") { store.selectLibrary(library.id) }.font(TypeStyle.reading(T.textSection)).buttonStyle(.plain) }
                    ForEach(KnowledgeLogic.points(library, query: store.graphQuery)) { point in
                        VStack(alignment: .leading, spacing: T.space3) { Text(point.title).font(TypeStyle.reading(22)); ForEach(point.evidence) { evidence in evidenceView(evidence) } }.padding(.vertical, T.space3)
                        Divider()
                    }
                    ForEach((library.documents ?? []).filter { $0.knowledgeStatus == "failed" }, id: \.id) { document in InlineMessage(text: document.filename + "：知识整理失败，可在资料页重试。", isError: true) }
                }
                if count == 0 && !store.loading {
                    KnowledgeEmpty(title: searching.isEmpty ? "知识尚未整理完成" : "没有找到相关知识点", detail: searching.isEmpty ? "资料仍可打开阅读，处理状态可在资料页中查看。" : "换一个关键词，或清除搜索。")
                    if !searching.isEmpty { EPButton("清除搜索") { store.graphQuery = "" }.buttonStyle(EPButtonStyle()) }
                    else { EPButton("添加资料") { store.showAdd() }.buttonStyle(EPButtonStyle()) }
                }
                EPText("同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var graphDetail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: T.space4) {
                HStack { Text(!searching.isEmpty ? "搜索结果" : "节点详情").foregroundStyle(.secondary); Spacer(); Button { store.closeGraphDetail(); store.graphQuery = "" } label: { WebIcon(name: .x, size: 18) }.buttonStyle(.plain).accessibilityLabel("关闭节点面板") }
                if let record = store.personalGraph?.sources[store.selectedNodeId ?? ""], store.selectedLibraryId == nil {
                    Text(record.title).font(TypeStyle.reading(22))
                    if record.assetUrl != nil {
                        Group { if let data = store.images[record.documentId], let image = NSImage(data: data) { Image(nsImage: image).resizable().scaledToFit() } }.task { await store.loadImage(documentId: record.documentId) }
                    }
                    if store.graphSourceLoading { ProgressView("正在读取原文…") }
                    if let error = store.graphSourceError { KnowledgeRetry(message: error) { if let id = store.selectedNodeId { store.performUserAction { await store.selectNode(id) } } } }
                    if let source = store.graphSource { ForEach(source.segments, id: \.segmentId) { segment in Text(segment.text).textSelection(.enabled).padding(T.space2).background(segment.segmentId == record.segmentId ? Color.accentColor.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 8)) } }
                    EPButton("在资料库中打开 ↗") { openSource(libraryId: record.libraryId, documentId: record.documentId, segmentId: record.segmentId) }.buttonStyle(EPButtonStyle(primary: true))
                    if let url = KnowledgeLogic.safeWebURL(record.sourceUrl) { EPButton("访问来源网页 ↗") { NSWorkspace.shared.open(url) }.buttonStyle(EPGhostButtonStyle()) }
                } else if let edge = graph.edges.first(where: { $0.id == store.selectedEdgeId }), let evidence = edge.evidence {
                    Text((graph.nodes.first { $0.id == edge.source }?.label ?? "") + " → " + (graph.nodes.first { $0.id == edge.target }?.label ?? "")).font(TypeStyle.reading(22)); Text(edge.label); evidenceView(evidence)
                } else if let id = store.selectedNodeId, let point = graph.points.first(where: { "topic:" + $0.id == id }) {
                    Text(point.title).font(TypeStyle.reading(22)); ForEach(point.evidence) { evidenceView($0) }
                } else if let library = store.selectedLibrary, let id = store.selectedNodeId, let document = library.documents?.first(where: { "document:" + $0.id == id }) {
                    Text(document.filename).font(TypeStyle.reading(22)); Text(document.knowledge?.summary ?? ""); EPButton("阅读原文 ↗") { openSource(libraryId: library.id, documentId: document.id, segmentId: nil) }.buttonStyle(EPButtonStyle(primary: true))
                } else {
                    if let selected = graph.nodes.first(where: { $0.id == store.selectedNodeId }) { Text(selected.label).font(TypeStyle.reading(22)) }
                    let neighbors = store.selectedNodeId.map { KnowledgeLogic.neighbors($0, in: graph) } ?? []
                    let results = graph.nodes.filter { $0.kind != "self" && (!searching.isEmpty ? $0.label.lowercased().contains(searching) : neighbors.contains($0.id)) }
                    if !searching.isEmpty { Text("找到 \(results.count) 个结果").font(TypeStyle.ui(T.textMeta)) }
                    ForEach(Array(results.prefix(80))) { node in Button { store.performUserAction { await store.selectNode(node.id) } } label: { HStack { WebIcon(name: .fileText, size: 18); VStack(alignment: .leading) { Text(node.label); Text(node.kind == "topic" ? "主题" : ["category", "document"].contains(node.kind) ? "资料" : "知识点").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }; Spacer(); WebIcon(name: .arrowUpRight, size: 18) } }.buttonStyle(.plain).padding(.vertical, T.space2) }
                    if results.isEmpty { Text(searching.isEmpty ? "这个节点暂时还没有关联资料。" : "换一个词试试看。").foregroundStyle(.secondary) }
                }
            }.padding(T.space5)
        }.background(.regularMaterial, in: RoundedRectangle(cornerRadius: T.radiusCard)).overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(.quaternary)).padding(.bottom, 38)
    }
    private func evidenceView(_ evidence: KnowledgeEvidence) -> some View {
        VStack(alignment: .leading, spacing: T.space2) {
            Text(evidence.summary).textSelection(.enabled); Text(evidence.filename).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            ForEach(Array(evidence.segmentIds.enumerated()), id: \.offset) { index, segment in Button("阅读原文\(evidence.segmentIds.count > 1 ? " \(index + 1)" : "") ↗") { openSource(libraryId: evidence.libraryId, documentId: evidence.documentId, segmentId: segment) }.buttonStyle(EPGhostButtonStyle()) }
        }
    }
    private func openSource(libraryId: String, documentId: String, segmentId: String?) { store.performUserAction { await store.openDocument(libraryId: libraryId, documentId: documentId, segmentId: segmentId); if store.source != nil { openLibrary() } } }
}

private struct KnowledgeGraphCanvas: View {
    let graph: NativeKnowledgeGraph
    let selectedNodeId: String?
    let selectedEdgeId: String?
    let avatarId: String?
    let avatarColor: String?
    let ownerRevision: UUID
    let edgeDirections: [String: String]
    let onNode: (String) -> Void
    let onEdge: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @StateObject private var layout = KnowledgeGraphLayoutState()
    @State private var positions: [String: KnowledgePosition] = [:]
    @State private var nodeStyles: [String: KnowledgeGraphNodeAppearance] = [:]
    @State private var edgeStyles: [String: KnowledgeGraphEdgeAppearance] = [:]
    @State private var fittedCenter: KnowledgePosition?
    @State private var fittedZoom: Double?
    @State private var useFallback = false
    @State private var zoom = 1.0
    @State private var offset = CGSize.zero
    @State private var dragStart = CGSize.zero
    @State private var lastMagnification = 1.0
    @State private var seed = 0
    @State private var hovered: String?
    @State private var hoveredEdge: String?
    @State private var dragBegan = false
    @State private var draggedNode: String?
    @State private var nodeDragStart = KnowledgePosition(x: 0, y: 0)
    private var signature: String { graph.nodes.map { $0.id + ":" + $0.kind + ":" + String($0.level) }.joined(separator: "|") + graph.edges.map { $0.id + ":" + $0.source + ":" + $0.target + ":" + (edgeDirections[$0.id] ?? "directed") }.joined(separator: "|") }
    private var dark: Bool { scheme == .dark }
    var body: some View {
        GeometryReader { geometry in
            let p = Palette(dark: dark)
            let baseScale = fitScale(geometry.size)
            let scale = baseScale * zoom
            let key = ownerRevision.uuidString + ":" + signature + ":" + (selectedNodeId ?? "") + ":" + String(Int(geometry.size.width)) + ":" + String(Int(geometry.size.height)) + ":" + String(seed)
            ZStack {
                interactiveCanvas(size: geometry.size, scale: scale, baseScale: baseScale)
                if let node = graph.nodes.first(where: { $0.kind == "self" }), let position = positions[node.id] {
                    KnowledgeGraphAvatar(id: avatarId ?? "sprout", color: avatarColor ?? "#a1b48b", dark: dark)
                        .opacity(nodeStyles[node.id]?.opacity ?? 1).scaleEffect(scale).position(point(position, size: geometry.size, scale: scale)).allowsHitTesting(false)
                }
                if layout.loading && !useFallback { ProgressView("正在展开你的知识图谱").padding(T.space4).background(p.surface, in: Capsule()) }
                if let error = layout.error, !useFallback {
                    VStack(spacing: T.space3) {
                        InlineMessage(text: error, isError: true)
                        HStack { EPButton("重试原图布局") { seed += 1 }; EPButton("临时使用简化布局") { positions = KnowledgeLogic.layout(graph, seed: seed); nodeStyles = [:]; edgeStyles = [:]; useFallback = true; resetViewport() } }.buttonStyle(EPButtonStyle())
                    }.padding(T.space5).frame(maxWidth: 540).background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                }
                if useFallback { VStack { Spacer(); EPText("临时简化布局 · 与 Web 原图算法不同").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(T.space3) }.padding(.bottom, 34) }
                VStack {
                    HStack {
                        Spacer()
                        HStack(spacing: 2) {
                            Button { changeZoom(1.2, base: baseScale) } label: { WebIcon(name: .plus, size: 18) }.help("放大")
                            Button { changeZoom(1 / 1.2, base: baseScale) } label: { WebIcon(name: .minus, size: 18) }.help("缩小")
                            Button { fitCurrentViewport(geometry.size) } label: { WebIcon(name: .cornersOut, size: 18) }.help("适应画布")
                            Button { useFallback = false; seed += 1; resetViewport() } label: { WebIcon(name: .shuffle, size: 18) }.help("重新布局")
                        }.buttonStyle(EPIconButtonStyle()).padding(5).background(p.surface, in: Capsule()).overlay(Capsule().stroke(p.rule))
                    }; Spacer()
                }.padding(T.space3)
            }.background(p.surface).clipShape(RoundedRectangle(cornerRadius: T.radiusCard)).contentShape(Rectangle())
                .accessibilityElement(children: .contain).accessibilityLabel("知识关系画布，可拖动节点、移动、缩放，也可通过搜索选择节点")
                .task(id: key) {
                    useFallback = false; positions = [:]; nodeStyles = [:]; edgeStyles = [:]; fittedCenter = nil; fittedZoom = nil; resetViewport()
                    await layout.load(.init(graph: graph, focusNodeId: selectedNodeId, edgeDirections: edgeDirections, width: geometry.size.width, height: geometry.size.height))
                    guard !Task.isCancelled, let result = layout.result else { return }
                    positions = result.positions
                    nodeStyles = Dictionary(result.nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                    edgeStyles = Dictionary(result.edges.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                }
                .onDisappear { layout.clear(); positions = [:]; nodeStyles = [:]; edgeStyles = [:] }
        }
    }
    private func interactiveCanvas(size: CGSize, scale: Double, baseScale: Double) -> some View {
        Canvas { context, canvasSize in draw(context: &context, size: canvasSize, scale: scale) }
            .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                    if !dragBegan {
                        dragBegan = true; draggedNode = closestNode(value.startLocation, size: size, scale: scale)?.id
                        if let draggedNode, let position = positions[draggedNode] { nodeDragStart = position }
                    }
                    if hypot(value.translation.width, value.translation.height) > 4 {
                        if let id = draggedNode { positions[id] = .init(x: nodeDragStart.x + value.translation.width / scale, y: nodeDragStart.y + value.translation.height / scale) }
                        else { offset = CGSize(width: dragStart.width + value.translation.width, height: dragStart.height + value.translation.height) }
                    }
                }.onEnded { value in
                    if hypot(value.translation.width, value.translation.height) < 4 { select(at: value.location, size: size, scale: scale) }
                    dragStart = offset; dragBegan = false; draggedNode = nil
                })
                .simultaneousGesture(MagnificationGesture().onChanged { value in changeZoom(value / lastMagnification, base: baseScale); lastMagnification = value }.onEnded { _ in lastMagnification = 1 })
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let location): hovered = closestNode(location, size: size, scale: scale)?.id; hoveredEdge = hovered == nil ? closestEdge(location, size: size, scale: scale)?.id : nil
                    case .ended: hovered = nil; hoveredEdge = nil
                    }
                }
    }
    private func draw(context: inout GraphicsContext, size: CGSize, scale: Double) {
        let p = Palette(dark: dark), nodes = nodeStyles, edges = edgeStyles
        let hoverNeighbors = hovered.map { KnowledgeLogic.neighbors($0, in: graph) } ?? []
        for edge in graph.edges {
            guard let a = positions[edge.source], let b = positions[edge.target] else { continue }
            let start = point(a, size: size, scale: scale), end = point(b, size: size, scale: scale), style = edges[edge.id]
            let active = selectedEdgeId == edge.id || hoveredEdge == edge.id
            let dimmed = hovered != nil && edge.source != hovered && edge.target != hovered
            let opacity = dimmed ? 0.08 : active ? 1 : style?.opacity ?? 0.42
            let width = (active ? 2.2 : style?.width ?? 0.8) * scale
            let color = style?.color.color(dark: dark) ?? p.faint
            var line = Path(); line.move(to: start); line.addLine(to: end)
            context.stroke(line, with: .color(color.opacity(opacity)), style: StrokeStyle(lineWidth: width, dash: (style?.dashed ?? edge.candidate) ? [6 * scale, 3 * scale] : []))
            if let style {
                if style.targetArrow { arrow(context: &context, start: start, end: end, radius: nodeRadius(edge.target) * scale, size: style.arrowSize * scale, color: style.targetArrowColor.color(dark: dark).opacity(opacity)) }
                if style.sourceArrow { arrow(context: &context, start: end, end: start, radius: nodeRadius(edge.source) * scale, size: style.arrowSize * scale, color: style.sourceArrowColor.color(dark: dark).opacity(opacity)) }
            }
            if active {
                let text = Text(style?.label ?? edge.label).font(TypeStyle.ui(9 * scale)).foregroundColor(graphToken(T.colorInkSoft(dark: false)))
                let resolved = context.resolve(text), measured = resolved.measure(in: size)
                let center = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
                context.fill(Path(roundedRect: CGRect(x: center.x - measured.width / 2 - 3 * scale, y: center.y - measured.height / 2 - 3 * scale, width: measured.width + 6 * scale, height: measured.height + 6 * scale), cornerRadius: 2), with: .color(graphToken(T.colorSurface(dark: false)).opacity(0.92)))
                context.draw(resolved, at: center)
            }
        }
        for node in graph.nodes {
            guard let modelPoint = positions[node.id] else { continue }
            let point = self.point(modelPoint, size: size, scale: scale), style = nodes[node.id]
            let width = (style?.width ?? nodeRadius(node.id) * 2) * scale, height = (style?.height ?? nodeRadius(node.id) * 2) * scale
            let hoveredNode = hovered == node.id || hoverNeighbors.contains(node.id)
            let dimmed = hovered != nil && !hoveredNode
            let opacity = dimmed ? 0.12 : hoveredNode ? 1 : style?.opacity ?? 0.92
            let ellipse = Path(ellipseIn: CGRect(x: point.x - width / 2, y: point.y - height / 2, width: width, height: height))
            if let style, style.underlayOpacity > 0 {
                let padding = style.underlayPadding * scale
                context.fill(Path(ellipseIn: CGRect(x: point.x - width / 2 - padding, y: point.y - height / 2 - padding, width: width + 2 * padding, height: height + 2 * padding)), with: .color(style.underlay.color(dark: dark).opacity(style.underlayOpacity * opacity)))
            }
            if node.kind != "self" {
                context.fill(ellipse, with: .color((hoveredNode ? graphToken(T.colorInk(dark: false)) : style?.background.color(dark: dark) ?? p.faint).opacity(opacity * (style?.backgroundOpacity ?? 1))))
                context.stroke(ellipse, with: .color((hoveredNode ? graphToken(T.colorRuleStrong(dark: false)) : style?.border.color(dark: dark) ?? p.surface).opacity(opacity)), lineWidth: (hoveredNode ? 4 : style?.borderWidth ?? 1.5) * scale)
            }
            let fontSize = (style?.fontSize ?? 10) * scale
            guard fontSize >= (style?.minZoomedFontSize ?? 8), hoveredNode || (style?.textOpacity ?? 1) > 0 else { continue }
            let labelPoint = CGPoint(x: point.x, y: point.y - height / 2 + (style?.textMarginY ?? -8) * scale)
            let font = graphFont(fontSize).weight((style?.fontWeight == "700" || style?.fontWeight == "bold") ? .bold : .regular)
            let labelOpacity = opacity * (hoveredNode ? 1 : style?.textOpacity ?? 1)
            if let style, style.outlineWidth > 0 {
                let outline = Text(node.label).font(font).foregroundColor(style.outline.color(dark: dark).opacity(style.outlineOpacity * labelOpacity))
                let stroke = style.outlineWidth * scale
                for dx in [-stroke, 0, stroke] { for dy in [-stroke, 0, stroke] where dx != 0 || dy != 0 { context.draw(outline, at: CGPoint(x: labelPoint.x + dx, y: labelPoint.y + dy), anchor: .bottom) } }
            }
            context.draw(Text(node.label).font(font).foregroundColor((style?.ink.color(dark: dark) ?? p.ink).opacity(labelOpacity)), at: labelPoint, anchor: .bottom)
        }
    }
    private func graphToken(_ color: EverplainColor) -> Color { KnowledgeGraphRGBA(red: color.red, green: color.green, blue: color.blue, alpha: color.alpha).color(dark: dark) }
    private func graphFont(_ size: Double) -> Font { for name in ["Songti SC", "Noto Serif CJK SC", "Georgia"] { if let font = NSFont(name: name, size: size) { return Font(font) } }; return TypeStyle.reading(size) }
    private func nodeRadius(_ id: String) -> Double {
        if !useFallback, let style = nodeStyles[id] { return style.width / 2 + style.borderWidth / 2 }
        guard let node = graph.nodes.first(where: { $0.id == id }) else { return 5 }
        return node.kind == "self" ? 35 : node.kind == "topic" ? 9 : node.kind == "knowledge" ? 3 : node.kind == "dimension" ? 10 : node.kind == "category" ? 6 : 5
    }
    private func fitScale(_ size: CGSize) -> Double {
        if let fittedZoom { return fittedZoom }
        if !useFallback, let result = layout.result { return max(0.16, min(3.2, result.zoom)) }
        let maxX = positions.values.map { abs($0.x) }.max() ?? 100, maxY = positions.values.map { abs($0.y) }.max() ?? 100
        return max(0.16, min(3.2, min(Double(max(100, size.width - 160)) / (maxX * 2 + 70), Double(max(100, size.height - 160)) / (maxY * 2 + 70))))
    }
    private func point(_ position: KnowledgePosition, size: CGSize, scale: Double) -> CGPoint {
        let base = fitScale(size)
        let centerX = fittedCenter?.x ?? (!useFallback ? (Double(size.width) / 2 - (layout.result?.pan.x ?? Double(size.width) / 2)) / base : 0)
        let centerY = fittedCenter?.y ?? (!useFallback ? (Double(size.height) / 2 - (layout.result?.pan.y ?? Double(size.height) / 2)) / base : 0)
        return CGPoint(x: Double(size.width) / 2 + (position.x - centerX) * scale + offset.width, y: Double(size.height) / 2 + (position.y - centerY) * scale + offset.height)
    }
    private func fitCurrentViewport(_ size: CGSize) {
        guard !positions.isEmpty else { resetViewport(); return }
        let minX = positions.map { $0.value.x - nodeRadius($0.key) }.min() ?? 0
        let maxX = positions.map { $0.value.x + nodeRadius($0.key) }.max() ?? 1
        let minY = positions.map { $0.value.y - nodeRadius($0.key) }.min() ?? 0
        let maxY = positions.map { $0.value.y + nodeRadius($0.key) }.max() ?? 1
        if let id = selectedNodeId, let focus = positions[id] {
            let halfWidth = max(focus.x - minX, maxX - focus.x, 1), halfHeight = max(focus.y - minY, maxY - focus.y, 1)
            fittedCenter = focus
            fittedZoom = max(0.16, 0.8, min(3.2, (size.width - 144) / (halfWidth * 2), (size.height - 144) / (halfHeight * 2)))
        } else {
            let padding = min(size.width, size.height) * 0.22
            fittedCenter = .init(x: (minX + maxX) / 2, y: (minY + maxY) / 2)
            fittedZoom = max(0.16, min(3.2, (size.width - padding * 2) / max(1, maxX - minX), (size.height - padding * 2) / max(1, maxY - minY)))
        }
        resetViewport()
    }
    private func resetViewport() { zoom = 1; offset = .zero; dragStart = .zero; lastMagnification = 1 }
    private func changeZoom(_ multiplier: Double, base: Double) { zoom = max(0.16, min(3.2, base * zoom * multiplier)) / base }
    private func closestNode(_ location: CGPoint, size: CGSize, scale: Double) -> NativeKnowledgeNode? {
        graph.nodes.compactMap { node -> (NativeKnowledgeNode, Double)? in guard let position = positions[node.id] else { return nil }; let p = point(position, size: size, scale: scale); let distance = hypot(p.x - location.x, p.y - location.y); return distance <= max(10, nodeRadius(node.id) * scale + 4) ? (node, distance) : nil }.min { $0.1 < $1.1 }?.0
    }
    private func closestEdge(_ location: CGPoint, size: CGSize, scale: Double) -> NativeKnowledgeEdge? {
        graph.edges.first { edge in
            guard let a = positions[edge.source], let b = positions[edge.target] else { return false }
            let start = point(a, size: size, scale: scale), end = point(b, size: size, scale: scale)
            let dx = end.x - start.x, dy = end.y - start.y, denominator = dx * dx + dy * dy
            guard denominator > 0 else { return false }
            let t = max(0, min(1, ((location.x - start.x) * dx + (location.y - start.y) * dy) / denominator))
            return hypot(location.x - start.x - t * dx, location.y - start.y - t * dy) < 6
        }
    }
    private func select(at location: CGPoint, size: CGSize, scale: Double) {
        if let node = closestNode(location, size: size, scale: scale) { onNode(node.id) }
        else if let edge = closestEdge(location, size: size, scale: scale), edge.evidence != nil { onEdge(edge.id) }
    }
    private func arrow(context: inout GraphicsContext, start: CGPoint, end: CGPoint, radius: Double, size: Double, color: Color) {
        let distance = hypot(end.x - start.x, end.y - start.y)
        guard distance > 0 else { return }
        let dx = (end.x - start.x) / distance, dy = (end.y - start.y) / distance
        let tip = CGPoint(x: end.x - dx * radius, y: end.y - dy * radius)
        var path = Path(); path.move(to: tip)
        path.addLine(to: CGPoint(x: tip.x - dx * size * 0.3 - dy * size * 0.15, y: tip.y - dy * size * 0.3 + dx * size * 0.15))
        path.addLine(to: CGPoint(x: tip.x - dx * size * 0.3 + dy * size * 0.15, y: tip.y - dy * size * 0.3 - dx * size * 0.15)); path.closeSubpath()
        context.fill(path, with: .color(color))
    }
}

private struct KnowledgeAddSheet: ViewModifier {
    @ObservedObject var store: KnowledgeStore
    var onOpenLibrary: (() -> Void)? = nil
    func body(content: Content) -> some View { content.sheet(item: $store.addSource) { source in KnowledgeAddDialog(store: store, initialSource: source, onOpenLibrary: onOpenLibrary) } }
}
private struct KnowledgeAddDialog: View {
    @ObservedObject var store: KnowledgeStore
    let initialSource: KnowledgeImportSource
    var onOpenLibrary: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var selected = KnowledgeImportSource.extensionGuide
    @State private var destination = ""
    @State private var uid = ""
    @State private var over = false
    @State private var guide = false
    @State private var download = false
    @State private var downloadSystem = ""
    var body: some View {
        VStack(spacing: 0) {
            HStack { EPText("添加资料").font(TypeStyle.reading(26)); Spacer(); Button { dismiss() } label: { WebIcon(name: .x, size: 18) }.buttonStyle(EPIconButtonStyle()).disabled(store.busy).accessibilityLabel("关闭添加资料") }.padding(T.space5)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: T.space2) {
                        EPText("随手收").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        sourceButton(.extensionGuide)
                        EPText("上传").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.top, T.space3)
                        sourceButton(.file); sourceButton(.image)
                        EPText("从其他应用导入").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.top, T.space3)
                        ForEach([KnowledgeImportSource.chrome, .obsidian, .appleNotes, .enex, .notion, .flomo, .keep, .bilibili]) { sourceButton($0) }
                        Divider().padding(.vertical, T.space3); sourceButton(.records)
                    }.padding(T.space4)
                }.frame(width: 225)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: T.space5) {
                        if let error = store.error { InlineMessage(text: error, isError: true) }
                        if let notice = store.notice { InlineMessage(text: notice) }
                        if selected == .extensionGuide { extensionContent }
                        else if selected == .records { records }
                        else { uploadContent }
                    }.padding(T.space6).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.frame(width: 960, height: 680).interactiveDismissDisabled(store.busy)
            .onAppear { selected = initialSource; destination = store.selectedLibrary?.viewerAccess == "owner" ? store.selectedLibraryId ?? "" : store.ownedLibraries.first?.id ?? "" }
            .task { await store.loadSupplementary(); await store.monitor() }
            .sheet(isPresented: $download) { downloadContent }
    }
    private func sourceButton(_ source: KnowledgeImportSource) -> some View {
        Button { selected = source; store.error = nil; store.notice = nil } label: {
            HStack(spacing: 10) { ImportSourceIcon(source: source, size: 20); Text(source.title); if source == .extensionGuide { EPText("推荐").font(TypeStyle.ui(10)).foregroundStyle(.secondary) }; Spacer() }.font(TypeStyle.ui(T.textControl)).padding(.horizontal, T.space3).padding(.vertical, 10).background(selected == source ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
        }.buttonStyle(.plain).disabled(store.busy)
    }
    private var uploadContent: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            Button { if selected != .bilibili { chooseFiles() } } label: {
                VStack(spacing: T.space5) {
                    HStack(spacing: 28) {
                        VStack { ImportSourceIcon(source: selected, size: 36); Text(selected.formats).font(TypeStyle.ui(T.textMeta)) }.frame(width: 175, height: 110).background(.background, in: RoundedRectangle(cornerRadius: 14)).rotationEffect(.degrees(-5))
                        WebIcon(name: .arrowRight, size: 24).foregroundStyle(.secondary)
                        VStack { WebIcon(name: .books, size: 36); Text(selected == .file ? destinationName : "我的资料").font(TypeStyle.ui(17, weight: .medium)); EPText("Everplain 知识库").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    }
                    Text(selected == .bilibili ? "读取公开收藏夹里的视频，转成可检索的笔记" : store.busy ? "正在上传…" : over ? "松手就放进来" : "把文件拖到这里").font(TypeStyle.ui(18, weight: .medium))
                    if selected != .bilibili { Text("或点击选择 · \(selected.formats)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity).padding(.vertical, T.space8).background(Color.primary.opacity(over ? 0.08 : 0.03), in: RoundedRectangle(cornerRadius: 20)).overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.quaternary, style: StrokeStyle(lineWidth: 1, dash: [6, 5])))
            }.buttonStyle(.plain).disabled(store.busy || store.ownerId == nil || selected == .bilibili)
                .onDrop(of: [UTType.fileURL], isTargeted: $over) { providers in guard !store.busy, selected != .bilibili else { return false }; dropped(providers); return true }
            if selected == .bilibili {
                HStack { TextField("公开账户 UID，例如 123456", text: $uid).textFieldStyle(.roundedBorder); Button(store.busy ? "正在读取…" : "读取公开收藏") { store.performUserAction { await store.importBilibili(uid) } }.buttonStyle(EPButtonStyle(primary: true)).disabled(store.busy || !KnowledgeImportSource.validPublicUID(uid.trimmingCharacters(in: .whitespacesAndNewlines))) }
            }
            HStack(alignment: .top, spacing: T.space6) {
                VStack(alignment: .leading, spacing: T.space2) { ForEach(Array(steps.enumerated()), id: \.offset) { index, text in Text("\(index + 1). \(text)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) } }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: T.space3) {
                    if selected == .file {
                        if !store.ownedLibraries.isEmpty { VStack(alignment: .leading, spacing: T.space2) { EPText("放进").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); WebSelect(label: "放进哪个知识库", selection: $destination, options: store.ownedLibraries.map { ($0.id, $0.name ?? "未命名知识库") }) }.frame(width: 180) }
                        else { EPText("上传时将创建「我的资料」知识库").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    } else { EPText("统一放进「我的资料」，重复的自动跳过。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    if selected == .obsidian { EPButton("选择整个文件夹") { chooseFiles(folder: true) }.buttonStyle(EPButtonStyle()).disabled(store.busy) }
                }.frame(maxWidth: 210)
            }
            if selected == .file && !store.uploadQueue.isEmpty {
                VStack(alignment: .leading, spacing: T.space3) {
                    EPText("上传队列").font(TypeStyle.ui(17, weight: .medium))
                    ForEach(store.uploadQueue) { entry in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) { Text(entry.filename); Text(knowledgeSize(entry.bytes.count)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); if let error = entry.error { Text(error).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.red) } };
                            Spacer()
                            if entry.state == "uploading" { ProgressView().controlSize(.small) }
                            Text(["done": "已上传", "uploading": "上传中", "failed": "失败", "queued": "排队中"][entry.state] ?? entry.state).font(TypeStyle.ui(T.textMeta))
                            if entry.state == "failed" { Button(entry.document == nil ? "重试上传" : "重新上传") { store.performUserAction { await store.retryUpload(entry.id) } }.disabled(store.busy) }
                            if let document = entry.document { Button(document.status == "ready" ? "打开" : "查看处理状态") { store.performUserAction { if document.status == "ready" { await store.openDocument(libraryId: entry.libraryId, documentId: document.id) } else { store.selectLibrary(entry.libraryId) }; onOpenLibrary?(); dismiss() } }.disabled(store.busy) }
                        }.padding(T.space3).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            Group {
            if selected == .file {
                Text(store.storage.map { "单份不超过 \(knowledgeSize($0.maxFileBytes))，每个知识库最多 \($0.maxDocumentsPerLibrary) 份。扫描版 PDF 需先转为可选取文字的文档。" } ?? "正在读取上传限制。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            } else if selected != .bilibili { EPText("单个文件最多 16 MB，每批最多 64 MB。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if selected == .image { EPText("图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if selected == .chrome { EPText("逐个读取网页正文，需要登录的页面会显示失败原因，可单独重试。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            if selected == .bilibili { EPText("只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            quota
            }
            Divider()
            HStack { WebIcon(name: .puzzlePiece, size: 24); VStack(alignment: .leading) { EPText("读到哪，收到哪").font(TypeStyle.ui(17, weight: .medium)); EPText("装个浏览器扩展，在网页上点一下，整篇就进了「我的资料」。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }; Spacer(); EPButton("了解扩展") { selected = .extensionGuide }.buttonStyle(EPButtonStyle()) }
        }
    }
    private var quota: some View {
        Group {
            if let quota = store.storage { Text("已用 \(knowledgeSize(quota.usedBytes)) / \(knowledgeSize(quota.maxBytes)) · \(quota.libraryCount) / \(quota.maxLibraries) 个知识库\(quota.usedBytes >= quota.maxBytes ? " · 存储空间已满" : "")").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            else { HStack { Text(store.storageError ?? "暂未读取到存储用量。").font(TypeStyle.ui(T.textMeta)); EPButton("重试读取用量") { store.performUserAction { await store.loadSupplementary() } } } }
        }
    }
    private var records: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            HStack { EPText("导入记录").font(TypeStyle.reading(25)); Spacer(); EPButton("刷新") { store.performUserAction { await store.loadSupplementary() } }.buttonStyle(EPGhostButtonStyle()).disabled(store.busy) }
            if store.supplementaryLoading { ProgressView("正在读取记录…") }
            if let error = store.importError { KnowledgeRetry(message: error) { store.performUserAction { await store.loadSupplementary() } } }
            if store.batches.isEmpty && !store.supplementaryLoading && store.importError == nil { EPText("还没有导入记录。").foregroundStyle(.secondary) }
            ForEach(store.batches, id: \.id) { batch in
                Card {
                    VStack(alignment: .leading, spacing: T.space3) {
                        HStack { Text(KnowledgeImportSource(rawValue: batch.sourceType)?.title ?? batch.sourceType).font(TypeStyle.ui(17, weight: .medium)); Spacer(); Text("\(batch.finished) / \(batch.total)").foregroundStyle(.secondary); EPButton("打开资料库 ↗") { store.selectLibrary(batch.libraryId); onOpenLibrary?(); dismiss() }.disabled(store.busy) }
                        ProgressView(value: Double(batch.finished), total: Double(max(batch.total, 1)))
                        Text("\(batch.imported) 条已入库 · \(batch.duplicates) 条重复\(batch.failed > 0 ? " · \(batch.failed) 条待重试" : "")").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        DisclosureGroup("查看条目") {
                            ForEach(batch.items, id: \.id) { item in HStack { VStack(alignment: .leading) { Text(item.title); Text(item.error ?? ["imported": "已入库", "duplicate": "已存在", "queued": "等待处理", "running": "正在处理", "failed": "失败"][item.status] ?? item.status).font(TypeStyle.ui(T.textMeta)).foregroundStyle(item.status == "failed" ? Color.red : .secondary) }; Spacer(); if item.status == "failed" { EPButton("重试") { store.performUserAction { await store.retryImport(batchId: batch.id, itemId: item.id) } }.disabled(store.busy) } }.padding(.vertical, T.space2) }
                        }
                    }
                }
            }
        }
    }
    private var extensionContent: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            HStack(spacing: 32) { WebIcon(name: .fileText, size: 18); WebIcon(name: .arrowRight, size: 18); WebIcon(name: .books, size: 18) }.font(.system(size: 42)).frame(maxWidth: .infinity).padding(.vertical, T.space8)
            EPText("看到好网页，点一下就收进来").font(TypeStyle.reading(27))
            EPText("不用复制链接，也不用定期导出书签。收进来的网页会读取正文，和其他资料一样整理出知识点。").foregroundStyle(.secondary)
            EPText("收下当前页").font(TypeStyle.ui(17, weight: .medium)); EPText("点工具栏上的 Everplain 按钮").foregroundStyle(.secondary)
            EPText("搬走全部书签").font(TypeStyle.ui(17, weight: .medium)); EPText("在扩展里一键导入，不用先导出文件").foregroundStyle(.secondary)
            HStack { EPButton("下载扩展 →") { download = true }.buttonStyle(EPButtonStyle(primary: true)); EPButton("安装教程") { guide.toggle() }.buttonStyle(EPButtonStyle()) }
            EPText("适用于电脑上的 Chrome。当前提供 ZIP 安装包，尚未上架 Chrome 应用商店，需要手动加载已解压的扩展程序。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            if guide { VStack(alignment: .leading, spacing: T.space3) { EPText("安装教程").font(TypeStyle.ui(18, weight: .medium)); EPText("1. 下载扩展 ZIP 并解压。\n2. 打开 Chrome 或 Edge 的扩展程序管理页。\n3. 打开“开发者模式”，点击“加载已解压的扩展程序”。\n4. 选择解压后的扩展文件夹，在工具栏固定 Everplain。").font(TypeStyle.ui(T.textBody)); EPButton("收起教程") { guide = false } } }
        }
    }
    private var downloadContent: some View {
        VStack(alignment: .leading, spacing: T.space5) {
            EPText("下载 Everplain 收藏助手").font(TypeStyle.reading(25))
            EPText("选择你的电脑系统。准备工具会下载并校验扩展、整理到固定文件夹，再打开扩展管理页。").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: T.space2) { EPText("电脑系统").font(TypeStyle.ui(T.textHeading, weight: .medium)); HStack(spacing: T.space2) { LibraryDownloadSystemButton(system: "macos", selected: downloadSystem == "macos") { downloadSystem = "macos" }; LibraryDownloadSystemButton(system: "windows", selected: downloadSystem == "windows") { downloadSystem = "windows" } } }
            if !downloadSystem.isEmpty { Text(downloadSystem == "macos" ? "全部解压后，双击 everplain-clipper-macos.command。" : "全部解压后，双击 everplain-clipper-windows.cmd；请保留同目录的 .ps1 文件。") }
            EPText("按工具提示选择 Chrome 或 Edge。接下来需要你在扩展管理页打开“开发者模式”，点击“加载已解压的扩展程序”，选择脚本打开的固定文件夹。").foregroundStyle(.secondary)
            HStack { EPText("系统若拦截脚本，请").font(TypeStyle.ui(T.textMeta)); EPButton("手动下载 ZIP") { openDownload("everplain-clipper.zip") } }
            EPText("不要关闭系统保护或绕过管理限制。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            HStack { EPButton("取消") { download = false }; Spacer(); Button(downloadSystem.isEmpty ? "请先选择系统" : "下载 \(downloadSystem == "macos" ? "macOS" : "Windows") 准备工具 →") { openDownload("everplain-clipper-\(downloadSystem).zip") }.disabled(downloadSystem.isEmpty) }.buttonStyle(EPButtonStyle())
        }.padding(T.space8).frame(width: 520)
    }
    private func openDownload(_ filename: String) { guard let origin = store.serviceOrigin, let url = KnowledgeLogic.safeWebURL(origin.appendingPathComponent("downloads").appendingPathComponent(filename).absoluteString) else { return }; NSWorkspace.shared.open(url) }
    private var destinationName: String { store.ownedLibraries.first { $0.id == destination }?.name ?? "我的资料" }
    private var steps: [String] {
        switch selected {
        case .file: return ["可以一次选好几份", "上传完就能读原文", "知识点稍后自动整理好"]
        case .image: return ["选择截图、照片或拍下的书页", "保留原图，提取图里的文字", "之后按图里的字也能搜到"]
        case .chrome: return ["打开 Chrome 或 Edge 的书签管理器", "在菜单里选择「导出书签」", "把得到的 HTML 拖进来"]
        case .obsidian: return ["找到 Vault 所在的文件夹", "选择整个文件夹，或先压成 ZIP", "保留目录结构和双链"]
        case .appleNotes: return ["选中要带走的笔记", "导出为 Markdown 文件", "把导出的文件拖进来"]
        case .enex: return ["在印象笔记里选中笔记本", "导出为 ENEX 文件", "把导出的文件拖进来"]
        case .notion: return ["在 Notion 设置里导出全部内容", "格式选择 HTML 或 Markdown", "把下载的导出包拖进来"]
        case .flomo: return ["在 flomo 里导出全部笔记", "得到 HTML 文件", "把导出的文件拖进来"]
        case .keep: return ["打开 Google Takeout", "只勾选 Keep 并导出", "把下载的文件拖进来"]
        case .bilibili: return ["填写公开账户 UID", "先读取视频字幕", "没有字幕时按配置转写"]
        default: return []
        }
    }
    private func symbol(_ source: KnowledgeImportSource) -> String { switch source { case .extensionGuide: return "puzzlepiece.extension"; case .file: return "square.and.arrow.up"; case .image: return "photo"; case .chrome: return "bookmark"; case .obsidian: return "folder"; case .bilibili: return "play.circle"; case .records: return "arrow.clockwise"; default: return "note.text" } }
    private func chooseFiles(folder: Bool = false) {
        let revision = store.ownerRevision, selectedSource = selected, target = destination
        let panel = NSOpenPanel(); panel.canChooseDirectories = folder; panel.canChooseFiles = !folder; panel.allowsMultipleSelection = !folder; panel.prompt = folder ? "选择文件夹" : "选择文件"
        if !folder { panel.allowedContentTypes = selected.extensions.compactMap { UTType(filenameExtension: $0) } }
        panel.begin { result in if result == .OK { Task { @MainActor in guard revision == store.ownerRevision else { return }; await receiveURLs(panel.urls, importSource: selectedSource, target: target) } } }
    }
    private func receiveURLs(_ urls: [URL], importSource: KnowledgeImportSource, target: String) async {
        var scoped: [URL] = [], files: [URL] = [], names: [URL: String] = [:]
        defer { for url in scoped { url.stopAccessingSecurityScopedResource() } }
        for root in urls {
            if root.startAccessingSecurityScopedResource() { scoped.append(root) }
            let values = try? root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values?.isSymbolicLink == true { store.error = "不能上传符号链接。"; return }
            if values?.isDirectory == true {
                guard importSource == .obsidian else { store.error = "请选择文件；Obsidian 导入支持整个文件夹。"; return }
                guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { store.error = "无法读取此文件夹。"; return }
                for case let url as URL in enumerator {
                    let value = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                    if value?.isSymbolicLink == true { enumerator.skipDescendants() }
                    if value?.isRegularFile == true && value?.isSymbolicLink != true {
                        guard url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") else { continue }
                        files.append(url)
                        names[url] = root.lastPathComponent + "/" + String(url.standardizedFileURL.path.dropFirst((root.standardizedFileURL.path + "/").count))
                    }
                }
            } else { files.append(root) }
        }
        if files.isEmpty { store.error = "没有找到可导入的文件。"; return }
        await store.upload(urls: files, source: importSource, targetLibraryId: target.isEmpty ? nil : target, relativeNames: names)
    }
    private func dropped(_ providers: [NSItemProvider]) {
        let revision = store.ownerRevision, source = selected, target = destination
        Task { @MainActor in
            var urls: [URL] = []
            for provider in providers {
                let url: URL? = await withCheckedContinuation { continuation in provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, _ in
                    if let data = value as? Data { continuation.resume(returning: URL(dataRepresentation: data, relativeTo: nil)) }
                    else { continuation.resume(returning: value as? URL) }
                } }
                if let url, url.isFileURL { urls.append(url) }
            }
            guard revision == store.ownerRevision else { return }
            await receiveURLs(urls, importSource: source, target: target)
        }
    }
}

private struct KnowledgeViewSwitch: View {
    let graph: Bool
    let action: () -> Void
    var body: some View { HStack(spacing: 0) { Button { if graph { action() } } label: { WebIcon(name: .squaresFour, size: 18) }.help("资料卡片").background(!graph ? Color.primary.opacity(0.07) : .clear, in: Capsule()); Button { if !graph { action() } } label: { WebIcon(name: .graph, size: 18) }.help("图谱").background(graph ? Color.primary.opacity(0.07) : .clear, in: Capsule()) }.buttonStyle(EPIconButtonStyle()).padding(3).overlay(Capsule().stroke(.quaternary)).accessibilityLabel("知识库视图") }
}
private struct KnowledgeSearch: View {
    let placeholder: String
    let label: String
    @Binding var text: String
    var body: some View { HStack(spacing: T.space3) { WebIcon(name: .magnifyingGlass, size: 18).foregroundStyle(.secondary); TextField(placeholder, text: $text).textFieldStyle(.plain).accessibilityLabel(label); if !text.isEmpty { Button { text = "" } label: { WebIcon(name: .x, size: 18).foregroundStyle(.secondary) }.buttonStyle(.plain).accessibilityLabel("清除搜索") } }.padding(.horizontal, T.space4).frame(height: 42).background(Color.primary.opacity(0.035), in: Capsule()).overlay(Capsule().stroke(.quaternary)) }
}
private struct KnowledgeTagStyle: ButtonStyle {
    var selected = false
    func makeBody(configuration: Configuration) -> some View { configuration.label.font(TypeStyle.ui(T.textMeta)).padding(.horizontal, 12).padding(.vertical, 7).background(selected ? Color.primary.opacity(0.09) : Color.clear, in: Capsule()).overlay(Capsule().stroke(selected ? Color.clear : Color.primary.opacity(0.13))).opacity(configuration.isPressed ? 0.6 : 1) }
}
private struct KnowledgeRetry: View {
    let message: String
    let retry: () -> Void
    var body: some View { HStack { InlineMessage(text: message, isError: true); EPButton("重新读取", action: retry).buttonStyle(EPGhostButtonStyle()) } }
}
private struct KnowledgeEmpty: View {
    let title: String
    let detail: String
    var body: some View { VStack(spacing: T.space3) { Text(title).font(TypeStyle.reading(T.textSection)); Text(detail).foregroundStyle(.secondary) }.multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 50) }
}
private func knowledgeSize(_ bytes: Int) -> String { let formatter = ByteCountFormatter(); formatter.countStyle = .file; return formatter.string(fromByteCount: Int64(bytes)) }
#endif
