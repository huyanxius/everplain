#if os(macOS)
import SwiftUI
import EverplainCore

struct HomeStatusSummary: View {
    @EnvironmentObject private var store: AppStore
    var body: some View { HomeStatusContent(research: store.research, knowledge: store.knowledge) }
}
private struct HomeStatusContent: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var research: ResearchStore
    @ObservedObject var knowledge: KnowledgeStore
    var body: some View {
        Group {
            if store.profileError != nil || research.error != nil || knowledge.graphError != nil {
                EPButton("重新读取伙伴设置") { Task { await store.refreshProfile(); await research.load(); await knowledge.loadGraph() } }.buttonStyle(.plain)
            } else if research.loading || knowledge.graphLoading || knowledge.personalGraph == nil {
                EPText("正在读取你的近况…")
            } else if let project = research.projects.first {
                VStack(alignment: .leading, spacing: T.space1) {
                    Button("上次停在《\(ResearchStore.title(project))》") { research.openWorkspace(project.taskId) }.buttonStyle(.plain)
                    if let graph = knowledge.personalGraph, graph.pendingCount > 0 { Button("还有 \(graph.pendingCount) 份资料没整理。") { store.openLibraryImport() }.buttonStyle(.plain) }
                }
            } else if let graph = knowledge.personalGraph, graph.pendingCount > 0 {
                Button("\(graph.pendingCount) 份资料没整理。") { store.openLibraryImport() }.buttonStyle(.plain)
            } else { EPText("这里还空着。丢一份资料，或者问一个你想弄清楚的问题。") }
        }.font(TypeStyle.ui(T.textBody))
            .lineSpacing(statusLeading).padding(.vertical,statusLeading / 2)
            .foregroundStyle(Palette(dark:scheme == .dark).muted).frame(maxWidth: .infinity, alignment: .leading)
    }
    private var statusLeading: CGFloat { max(0,CGFloat(T.textBody * 1.7) - NSLayoutManager().defaultLineHeight(for:TypeStyle.nativeUI(T.textBody))) }
}

struct HomeOverview: View {
    @EnvironmentObject private var store: AppStore
    var body: some View { HomeOverviewContent(research: store.research, knowledge: store.knowledge) }
}
private struct HomeOverviewContent: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject var research: ResearchStore
    @ObservedObject var knowledge: KnowledgeStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var open: String?
    @State private var blankHovered = false
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        VStack(alignment: .leading, spacing: T.space3) {
            HStack { EPText("接着研究").font(TypeStyle.ui(T.textMeta,weight:.medium)).foregroundStyle(p.ink); Spacer(); if open == "hand" { EPButton("收起") { toggle(nil) } }; Button { Task { await store.navigate(.research) } } label: { HStack(spacing:T.space1) { EPText("全部"); WebIcon(name:.arrowRight,size:14) } } }
                .font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).buttonStyle(.plain).frame(minHeight:T.controlHeight)
            if research.loading { homeLoading("正在读取最近研究") }
            else if let message = research.error { Card { VStack(alignment: .leading) { Text(message); EPButton("重新加载研究") { Task { await research.load() } }.buttonStyle(EPGhostButtonStyle()) } } }
            else if research.projects.isEmpty {
                Button { research.openWorkspace(nil) } label: {
                    VStack(spacing: T.space2) {
                        WebIcon(name:.plus,size:24)
                        EPText("开始第一项研究").font(TypeStyle.reading(T.textTitle).weight(.medium)).foregroundStyle(p.ink)
                        EPText("还没有研究项目"); Text("问 \(store.agentName) 一个问题，或者从一份资料出发")
                    }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).frame(maxWidth: .infinity).frame(height: 212)
                        .modifier(HomePileSurface(lifted:blankHovered,shadowDuration:0.2))
                        .rotationEffect(.degrees(blankHovered ? 0 : -1.5),anchor:UnitPoint(x:0.3,y:1)).offset(y:blankHovered ? -3 : 0)
                        .animation(reduceMotion ? nil : .timingCurve(0.34,1.3,0.64,1,duration:0.35),value:blankHovered)
                }.buttonStyle(.plain).onHover { blankHovered = $0 }.padding(.trailing, 44).frame(height: 236, alignment: .top)
            } else { researchPile }
            HStack {
                EPText("我的资料").font(TypeStyle.ui(T.textMeta,weight:.medium)).foregroundStyle(p.ink); Spacer()
                if open == "deck" { Button("\(knowledge.personalGraph?.pendingCount ?? 0) 份待整理") { store.openLibraryImport() }; EPButton("收起") { toggle(nil) } }
                Button { Task { await store.navigate(.library) } } label: { HStack(spacing:T.space1) { EPText("知识库"); WebIcon(name:.arrowRight,size:14) } }
            }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).buttonStyle(.plain).frame(minHeight:T.controlHeight).padding(.top, T.space6)
            if knowledge.graphLoading || (knowledge.personalGraph == nil && knowledge.graphError == nil) { homeLoading("正在读取资料") }
            else if let message = knowledge.graphError { Card { VStack(alignment: .leading) { Text(message); EPButton("重试") { Task { await knowledge.loadGraph() } }.buttonStyle(EPGhostButtonStyle()) } } }
            else if let graph = knowledge.personalGraph, graph.documentCount > 0 { documentPile(graph) }
            else {
                Button { store.openLibraryImport() } label: {
                    HStack(spacing: T.space3) {
                        WebIcon(name:.uploadSimple,size:22)
                        VStack(alignment: .leading) { EPText("把第一份资料，放进来。").font(TypeStyle.ui(T.textControl,weight:.medium)).foregroundStyle(p.ink); EPText("浏览器收藏、Obsidian、Markdown 或 PDF").font(TypeStyle.ui(T.textMeta)) }
                    }.padding(.vertical, T.space4).padding(.horizontal, T.space5).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(p.rule, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                }.buttonStyle(.plain).foregroundStyle(p.muted).padding(.trailing, 44)
            }
        }.frame(maxWidth: 400, alignment: .leading).onExitCommand { toggle(nil) }
    }
    private var researchPile: some View {
        let items = Array(research.projects.prefix(3))
        return HomePile(kind:.hand,expanded:pileBinding("hand"),items:items.map { project in
            HomePileItem(id:project.taskId,label:"\(project.nextActionLabel.isEmpty ? "继续研究" : project.nextActionLabel)：\(ResearchStore.title(project))",action:{ research.openWorkspace(project.taskId) },content:AnyView(researchCard(project)))
        })
    }
    private func researchCard(_ project: ResearchTaskNavigationResponse) -> some View {
        let p = Palette(dark:scheme == .dark)
        return VStack(alignment:.leading,spacing:T.space2) {
            Text(project.stageLabel).font(TypeStyle.ui(T.textMeta)).padding(.horizontal,T.space2).padding(.vertical,T.space1).background(p.strong,in:Capsule())
            Text(ResearchStore.title(project)).font(TypeStyle.reading(T.textTitle).weight(.medium)).fixedSize(horizontal:false,vertical:true)
            if let phenomenon = project.phenomenonSummary?.phenomenon, phenomenon != ResearchStore.title(project) { Text(phenomenon).font(TypeStyle.ui(T.textControl)).foregroundStyle(p.muted).lineLimit(open == "hand" ? 1 : 2) }
            if let blocker = project.blocker { Text(blocker.message).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.danger) }
            Spacer(minLength:0)
            HStack {
                Text(Self.updatedAt(project.updatedAt)).foregroundStyle(p.faint)
                Spacer(minLength:0)
                HStack(spacing:T.space1) { Text(project.nextActionLabel.isEmpty ? "继续研究" : project.nextActionLabel); WebIcon(name:.arrowRight,size:14) }.foregroundStyle(T.colorInkSoft(dark:scheme == .dark).color)
            }.font(TypeStyle.ui(T.textMeta))
        }.foregroundStyle(p.ink).frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
    }
    private func documentPile(_ graph: PersonalGraphResponse) -> some View {
        let documents = Array(graph.nodes.filter { $0.nodeType == "document" && graph.sources[$0.id] != nil }.prefix(3))
        let p = Palette(dark:scheme == .dark)
        let cover = AnyView(VStack(alignment:.leading,spacing:T.space2) {
            HStack(alignment:.firstTextBaseline,spacing:0) {
                Text("\(graph.documentCount)").font(TypeStyle.reading(T.textTitle).weight(.medium)).foregroundStyle(p.ink)
                Text(" 份资料 · \(graph.topicCount) 个主题").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
            }
            VStack(alignment:.leading,spacing:2) { ForEach(documents.prefix(2),id:\.id) { Text($0.label).font(TypeStyle.ui(T.textControl)).lineLimit(1) } }.foregroundStyle(T.colorInkSoft(dark:scheme == .dark).color)
            if graph.pendingCount > 0 { Text("\(graph.pendingCount) 份待整理").font(TypeStyle.ui(T.textMeta)).underline().foregroundStyle(T.colorInkSoft(dark:scheme == .dark).color) }
        }.frame(maxWidth:.infinity,alignment:.leading))
        let items = documents.compactMap { node -> HomePileItem? in
            guard let source = graph.sources[node.id] else { return nil }
            let card = AnyView(VStack(alignment:.leading,spacing:T.space2) {
                HStack(spacing:T.space1) { WebIcon(name:source.sourceUrl == nil ? .fileText : .globe,size:14); EPText(source.sourceUrl == nil ? "我的笔记" : "网页收藏") }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                Text(node.label).font(TypeStyle.reading(T.textControl).weight(.medium)).lineLimit(1)
                if let raw = source.sourceUrl { Text(URL(string:raw)?.host ?? raw).font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.faint).lineLimit(1) }
            }.frame(maxWidth:.infinity,alignment:.leading))
            return HomePileItem(id:node.id,label:node.label,action:{ Task { await store.navigate(.library); if store.route == .library { await knowledge.openDocument(libraryId:source.libraryId,documentId:source.documentId) } } },content:card)
        }
        return HomePile(kind:.deck,expanded:pileBinding("deck"),cover:cover,items:items)
    }
    private func pileBinding(_ value: String) -> Binding<Bool> { Binding(get:{ open == value },set:{ open = $0 ? value : nil }) }
    private func toggle(_ value: String?) { open = value }
    private static func updatedAt(_ raw: String) -> String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let date = parser.date(from:raw) ?? ISO8601DateFormatter().date(from:raw)
        guard let date else { return "最近更新" }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier:"zh_CN"); formatter.dateFormat = "M/d"
        return "更新于 " + formatter.string(from:date)
    }
    private func homeLoading(_ label: String) -> some View {
        EPText(label).font(TypeStyle.ui(T.textMeta)).foregroundStyle(Palette(dark:scheme == .dark).muted)
            .padding(T.space5).frame(maxWidth:.infinity,minHeight:152,alignment:.leading)
            .background(Palette(dark:scheme == .dark).mutedSurface,in:RoundedRectangle(cornerRadius:T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius:T.radiusCard).stroke(T.shadowCard(dark:scheme == .dark)[0].color.color,lineWidth:1))
            .shadow(color:T.shadowCard(dark:scheme == .dark)[1].color.color,radius:4,y:2)
    }
}
#endif
