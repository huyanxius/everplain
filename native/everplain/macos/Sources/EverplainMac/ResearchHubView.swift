#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchHubView: View {
    @ObservedObject var store: ResearchStore
    @Environment(\.colorScheme) private var scheme
    @State private var projectQuery = ""
    @State private var query = ""
    @State private var category = "all"
    @State private var ownerFilter = ""
    @State private var sort = "updated"
    @State private var uploadOpen = false
    @State private var uploadTaskId = ""
    @State private var deleting: ResearchMaterialResponse?
    private var visibleProjects: [ResearchTaskNavigationResponse] { store.projects.filter { projectQuery.isEmpty || ResearchStore.title($0).localizedCaseInsensitiveContains(projectQuery) } }
    private var visibleMaterials: [ResearchMaterialResponse] {
        store.materials.filter { item in
            let media = item.mediaType.hasPrefix("audio/") || item.mediaType.hasPrefix("video/")
            let owner = store.projects.first { $0.taskId == item.taskId }
            let target = store.selectedTaskId ?? (ownerFilter.isEmpty ? nil : ownerFilter)
            return (category == "all" || (category == "media" ? media : !media)) && (target == nil || item.taskId == target) &&
                (query.isEmpty || (item.filename + " " + (owner.map(ResearchStore.title) ?? "")).localizedCaseInsensitiveContains(query))
        }.sorted { sort == "name" ? $0.filename.localizedStandardCompare($1.filename) == .orderedAscending : $0.updatedAt > $1.updatedAt }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: T.space6) {
                if store.selectedTaskId != nil { Button { store.selectProject(nil) } label: { Label { EPText("研究") } icon: { WebIcon(name: .arrowLeft) } }.buttonStyle(EPGhostButtonStyle()) }
                HStack {
                    Text(store.selectedProject.map(ResearchStore.title) ?? "研究").font(TypeStyle.reading(T.textSection))
                    Spacer()
                    Button { store.openWorkspace(store.selectedTaskId) } label: {
                        Label { Text(store.selectedTaskId == nil ? "新建研究" : "继续研究") } icon: { WebIcon(name: store.selectedTaskId == nil ? .plus : .arrowUpRight, size: 18) }
                    }.buttonStyle(EPButtonStyle(primary: store.selectedTaskId == nil))
                }
                if let project = store.selectedProject { HStack { ResearchStageView(project: project); Text(fileCount(project.taskId)).foregroundStyle(.secondary) }.font(TypeStyle.ui(T.textMeta)) }
                HStack {
                    HStack(spacing: T.space1) {
                        if store.selectedTaskId == nil { tab("projects", "研究项目") }
                        tab("files", store.selectedTaskId == nil ? "全部文件" : "研究材料")
                        tab("memory", store.selectedTaskId == nil ? "个人记忆" : "项目记忆")
                    }.padding(T.space1).background(Palette(dark: scheme == .dark).mutedSurface, in: Capsule()).frame(maxWidth: 420)
                    Spacer()
                    if store.tab == "projects" { search("搜索研究", value: $projectQuery).frame(maxWidth: 280) }
                }
                if let error = store.error { InlineMessage(text: error, isError: true); EPButton("重新读取研究") { Task { await store.load(includeMaterials: true) } }.buttonStyle(EPButtonStyle()) }
                if store.tab == "projects" { projectGrid }
                if store.tab == "files" { files }
                if store.tab == "memory" { ResearchMemoryView(store: store.memory, projectName: store.selectedProject.map(ResearchStore.title)) }
            }.padding(T.space8).frame(maxWidth: 1200, alignment: .leading).frame(maxWidth: .infinity)
        }.font(TypeStyle.ui(T.textControl)).task { if store.projects.isEmpty { await store.load(includeMaterials: true) } else { await store.loadMaterials() } }
            .alert("删除这个文件？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                EPButton("取消", role: .cancel) { deleting = nil }
                EPButton("删除", role: .destructive) { if let value = deleting { Task { await store.removeMaterial(value) } }; deleting = nil }
            } message: { Text("确定删除“\(deleting?.filename ?? "")”？删除后，Agent 将不能再检索或引用它。") }
    }
    private var projectGrid: some View {
        VStack(alignment: .leading, spacing: T.space6) {
            if store.loading { AgentLiquid().frame(maxWidth: .infinity); EPText("正在读取研究项目…").foregroundStyle(.secondary) }
            else {
                if visibleProjects.isEmpty, store.error == nil {
                    VStack(spacing: T.space2) { Text(projectQuery.isEmpty ? "开始你的第一项研究" : "没有找到这个项目").font(TypeStyle.ui(T.textHeading, weight: .semibold)); Text(projectQuery.isEmpty ? "从一个问题或一份材料开始。" : "换一个项目名称试试。").foregroundStyle(.secondary) }.frame(maxWidth: .infinity).padding(.vertical, T.space8)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: T.space4)], spacing: T.space4) {
                    ForEach(visibleProjects, id: \.taskId) { project in
                        Button { query = ""; category = "all"; uploadTaskId = project.taskId; store.selectProject(project.taskId) } label: {
                            Card {
                                VStack(alignment: .leading, spacing: T.space3) {
                                    ResearchStageView(project: project)
                                    Text(ResearchStore.title(project)).font(TypeStyle.reading(T.textTitle)).lineLimit(2)
                                    Text(project.phenomenonSummary?.phenomenon ?? (project.nextActionLabel.isEmpty ? "从一个问题开始，逐步整理研究。" : project.nextActionLabel)).lineLimit(3).foregroundStyle(.secondary)
                                    Spacer(minLength: T.space3)
                                    Text("\(fileCount(project.taskId)) · \(project.updatedAt.prefix(10))").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, minHeight: 178, alignment: .topLeading)
                            }
                        }.buttonStyle(.plain)
                    }
                    Button { store.openWorkspace(nil) } label: {
                        Card { VStack(spacing: T.space3) { WebIcon(name: .plus, size: 26); EPText("从一个问题开始").font(TypeStyle.ui(T.textHeading)) }.frame(maxWidth: .infinity, minHeight: 178) }
                    }.buttonStyle(.plain)
                }
            }
        }
    }
    private var files: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack {
                search(store.selectedTaskId == nil ? "搜索文件或研究名称" : "搜索项目内的材料", value: $query)
                Spacer()
                Button { if store.projects.isEmpty { store.chooseFiles() } else { uploadTaskId = store.selectedTaskId ?? store.projects.first?.taskId ?? ""; uploadOpen.toggle() } } label: {
                    Label { Text(store.uploading ? "正在导入…" : "添加材料") } icon: { WebIcon(name: .plus) }
                }.buttonStyle(EPButtonStyle(primary: true)).disabled(store.loading || store.uploading)
            }
            if uploadOpen {
                Card {
                    VStack(alignment: .leading, spacing: T.space3) {
                        if store.selectedTaskId == nil { EPText("保存到研究"); WebSelect(label: "材料所属研究", selection: $uploadTaskId, options: store.projects.map { ($0.taskId, ResearchStore.title($0)) }) }
                        else { Text("添加到「\(store.selectedProject.map(ResearchStore.title) ?? "")」") }
                        HStack { EPButton("选择文件") { store.chooseFiles(taskId: uploadTaskId); uploadOpen = false }.buttonStyle(EPButtonStyle(primary: true)); EPButton("取消") { uploadOpen = false }.buttonStyle(EPGhostButtonStyle()) }
                    }
                }.frame(maxWidth: 400).onExitCommand { uploadOpen = false }
            }
            HStack {
                WebSelect(label: "材料类型", selection: $category, options: [("all", "所有类型"), ("documents", "文档与文本"), ("media", "录音与视频")]).frame(width: 165)
                if store.selectedTaskId == nil { WebSelect(label: "按研究筛选材料", selection: $ownerFilter, options: [("", "全部研究")] + store.projects.map { ($0.taskId, ResearchStore.title($0)) }).frame(width: 200) }
                Text("\(store.materialLoading ? "已读取 " : "")\(visibleMaterials.count) 份材料").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                Spacer()
                WebSelect(label: "材料排序", selection: $sort, options: [("updated", "最近修改"), ("name", "文件名称")]).frame(width: 150)
            }
            if !store.materialFailures.isEmpty { InlineMessage(text: "\(store.materialFailures.count) 个项目的文件暂时无法读取。", isError: true); EPButton("重试") { Task { await store.loadMaterials() } }.buttonStyle(EPButtonStyle()) }
            if let error = store.materialError { InlineMessage(text: error, isError: true) }
            if let notice = store.notice { Text(notice).foregroundStyle(.secondary) }
            if store.materialLoading { EPText("正在读取研究材料…").foregroundStyle(.secondary) }
            if !visibleMaterials.isEmpty {
                VStack(spacing: 0) {
                    HStack { EPText("文件名称").frame(maxWidth: .infinity, alignment: .leading); EPText("所属研究").frame(width: 140, alignment: .leading); EPText("最近修改").frame(width: 100); EPText("大小").frame(width: 72); EPText("状态").frame(width: 80); Color.clear.frame(width: 36, height: 1) }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.vertical, T.space3)
                    ForEach(visibleMaterials, id: \.materialId) { item in
                        Divider()
                        HStack(spacing: T.space3) {
                            Button { Task { await store.openMaterial(item); store.openWorkspace(item.taskId) } } label: {
                                HStack(spacing: T.space3) {
                                    WebIcon(name: ResearchMaterialPresentation.icon(item), size: 24)
                                    VStack(alignment: .leading, spacing: T.space1) { Text(item.filename).fontWeight(.medium).lineLimit(1); Text(item.materialFormat.uppercased()).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                                    Spacer(); WebIcon(name: .arrowUpRight, size: 15)
                                }
                            }.buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading)
                            Text(store.projects.first(where: { $0.taskId == item.taskId }).map(ResearchStore.title) ?? "").lineLimit(1).frame(width: 140, alignment: .leading)
                            Text(String(item.updatedAt.prefix(16)).replacingOccurrences(of: "T", with: " ")).font(TypeStyle.ui(T.textMeta)).frame(width: 100)
                            Text(ByteCountFormatter.string(fromByteCount: Int64(item.sizeBytes), countStyle: .file)).font(TypeStyle.ui(T.textMeta)).frame(width: 72)
                            Text(ResearchMaterialPresentation.status(item)).font(TypeStyle.ui(T.textMeta)).frame(width: 80)
                            Button { deleting = item } label: { WebIcon(name: .trash) }.buttonStyle(EPIconButtonStyle()).disabled(store.busy).accessibilityLabel("删除文件 \(item.filename)")
                        }.padding(.vertical, T.space4)
                    }
                }
            } else if !store.loading, !store.materialLoading, store.error == nil, store.materialFailures.isEmpty {
                VStack(spacing: T.space3) {
                    WebIcon(name: .fileText, size: 34)
                    Text(query.isEmpty && category == "all" && ownerFilter.isEmpty ? "从材料开始研究" : "没有匹配的材料").font(TypeStyle.ui(T.textHeading, weight: .semibold))
                    Text(query.isEmpty && category == "all" && ownerFilter.isEmpty ? "导入文档、音频或视频，整理原文并与 Agent 讨论。" : "调整搜索词或分类，材料仍保存在所属研究中。").foregroundStyle(.secondary)
                    if store.projects.isEmpty { Button(store.uploading ? "正在导入…" : "导入研究材料") { store.chooseFiles() }.buttonStyle(EPButtonStyle()).disabled(store.uploading) }
                }.frame(maxWidth: .infinity).padding(.vertical, T.space10)
            }
        }
    }
    private func tab(_ id: String, _ title: String) -> some View { Button(title) { store.tab = id; uploadOpen = false }.buttonStyle(WebSegmentStyle(selected: store.tab == id)) }
    private func search(_ label: String, value: Binding<String>) -> some View { HStack { WebIcon(name: .magnifyingGlass, size: 18); TextField(label, text: value).textFieldStyle(.plain) }.padding(.horizontal, T.space4).frame(height: T.controlHeight).background(Palette(dark: scheme == .dark).strong, in: Capsule()) }
    private func fileCount(_ id: String) -> String { store.materialFailures.contains(id) ? "文件读取失败" : store.materialLoading ? "正在读取文件…" : "\(store.materials.filter { $0.taskId == id }.count) 份文件" }
}

struct ResearchStageView: View {
    let project: ResearchTaskNavigationResponse
    private var stage: Int {
        let label = project.stageLabel
        if label.range(of: "写作|文稿|已完成|成果|交付", options: .regularExpression) != nil { return 3 }
        if label.range(of: "大纲|框架|研究方案|方案确认", options: .regularExpression) != nil { return 2 }
        if label.range(of: "资料|材料|理论|匹配", options: .regularExpression) != nil { return 1 }
        if label.range(of: "提问|现象|问题", options: .regularExpression) != nil { return 0 }
        return -1
    }
    var body: some View {
        HStack(spacing: 4) { ForEach(0..<4) { index in Capsule().fill(Color.primary.opacity(index <= stage ? 0.75 : 0.12)).frame(width: 18, height: 4) }; Text(stage < 0 ? project.stageLabel : ["提问", "找资料", "写大纲", "写作"][stage]).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.leading, T.space2) }.accessibilityLabel("研究进度：\(project.stageLabel)")
    }
}
enum ResearchMaterialPresentation {
    static func status(_ item: ResearchMaterialResponse) -> String { ["ready":"可检索", "processing":"正在解析", "uploaded":"原件已保存", "failed":"解析失败", "deleted":"已删除"][item.status] ?? item.status }
    static func icon(_ item: ResearchMaterialResponse) -> WebIconName { if item.mediaType.hasPrefix("audio/") { return .waveform }; if item.mediaType.hasPrefix("video/") { return .videoCamera }; switch item.filename.lowercased().split(separator: ".").last { case "pdf": return .filePdf; case "docx": return .fileDoc; case "md", "markdown": return .markdownLogo; default: return .fileText } }
}
#endif
