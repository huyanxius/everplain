#if os(macOS)
import SwiftUI
import AppKit
import UniformTypeIdentifiers
import EverplainCore

struct ResearchWorkspaceExistingEntry: View {
    @EnvironmentObject private var app: AppStore
    @ObservedObject var workspace: ResearchWorkspaceStore
    @Binding var isPresented: Bool
    @State private var title = ""
    @State private var stage = "材料整理"
    @State private var orientation = ""
    @State private var urls: [URL] = []
    @State private var createdTaskId: String?
    @State private var uploaded = Set<URL>()
    @State private var keys: [URL: String] = [:]
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: T.space5) {
            EPText("接入已有研究").font(TypeStyle.reading(T.textSection)); EPText("给正在进行的研究一个位置。导入已有材料，接着往下做。").foregroundStyle(.secondary)
            TextField(epLocalized("项目名称"), text: $title).disabled(busy || createdTaskId != nil)
            WebSelect(label: "当前阶段", selection: $stage, options: ["材料整理", "研究设计", "田野进行中", "资料分析", "写作与修订"].map { ($0, epLocalized($0)) }).disabled(busy || createdTaskId != nil)
            TextField(epLocalized("方法取向（可选）"), text: $orientation).disabled(busy || createdTaskId != nil)
            HStack { Text("初始材料（\(urls.count)）").font(TypeStyle.ui(T.textHeading)); Spacer(); EPButton("选择初始材料") { choose() }.disabled(busy) }
            EPText("PDF、DOCX、TXT 或 Markdown，可一次选择多份").foregroundStyle(.secondary)
            ForEach(urls, id: \.self) { url in HStack { WebIcon(name: .fileText); Text(url.lastPathComponent); Spacer(); if uploaded.contains(url) { EPText("已导入").foregroundStyle(.secondary) }; Button { urls.removeAll { $0 == url } } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).disabled(busy || uploaded.contains(url)) } }
            if let message = error ?? workspace.error { InlineMessage(text: message, isError: true) }
            HStack { EPButton("取消") { isPresented = false }.disabled(busy); Spacer(); Button(busy ? "正在建立并导入…" : createdTaskId == nil ? "建立项目并导入材料" : "重试导入材料") { Task { await establish() } }.buttonStyle(EPButtonStyle(primary: true)).disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 300 || orientation.count > 300 || urls.isEmpty) }
        }.padding(T.space6) }.frame(width: 570, height: 560).interactiveDismissDisabled(busy)
    }
    private func choose() {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = ["pdf", "docx", "txt", "md", "markdown"].compactMap { UTType(filenameExtension: $0) }
        panel.begin { response in if response == .OK { urls = Array(Set(urls + panel.urls)).sorted { $0.lastPathComponent < $1.lastPathComponent }; error = nil } }
    }
    private func establish() async {
        guard !busy else { return }; busy = true; error = nil; let owner = app.session?.user.userId
        defer { busy = false }
        if createdTaskId == nil { createdTaskId = await workspace.createExistingProject(title: title.trimmingCharacters(in: .whitespacesAndNewlines), stage: stage, orientation: orientation.trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard let id = createdTaskId, owner != nil, owner == app.session?.user.userId else { return }
        do {
            for url in urls where !uploaded.contains(url) { let key = keys[url] ?? UUID().uuidString; keys[url] = key; _ = try await app.research.uploadFile(url, taskId: id, key: key); guard owner == app.session?.user.userId else { return }; uploaded.insert(url) }
            await app.navigate(.workspace, newChat: true); guard owner == app.session?.user.userId, app.route == .workspace else { return }
            app.workspaceTaskId = id; workspace.open(taskId: id, conversation: nil); workspace.select(.materials); isPresented = false
        } catch { self.error = error.localizedDescription }
    }
}
#endif
