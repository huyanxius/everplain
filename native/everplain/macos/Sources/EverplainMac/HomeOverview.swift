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
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        VStack(alignment: .leading, spacing: T.space3) {
            HStack { EPText("接着研究"); Spacer(); if open == "hand" { EPButton("收起") { toggle(nil) } }; Button { Task { await store.navigate(.research) } } label: { HStack(spacing:T.space1) { EPText("全部"); WebIcon(name:.arrowRight,size:14) } } }
                .font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).buttonStyle(.plain)
            if research.loading { homeLoading("正在读取最近研究") }
            else if let message = research.error { Card { VStack(alignment: .leading) { Text(message); EPButton("重新加载研究") { Task { await research.load() } }.buttonStyle(EPGhostButtonStyle()) } } }
            else if research.projects.isEmpty {
                Button { research.openWorkspace(nil) } label: {
                    VStack(spacing: T.space2) {
                        WebIcon(name:.plus,size:24)
                        EPText("开始第一项研究").font(TypeStyle.reading(T.textTitle).weight(.medium)).foregroundStyle(p.ink)
                        EPText("还没有研究项目"); Text("问 \(store.agentName) 一个问题，或者从一份资料出发")
                    }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).frame(maxWidth: .infinity).frame(height: 212)
                        .background(p.surface, in: RoundedRectangle(cornerRadius: T.radiusCard)).rotationEffect(.degrees(-1.5))
                        .shadow(color: T.shadowCard(dark: scheme == .dark).last!.color.color, radius: 12, y: 4)
                }.buttonStyle(.plain).padding(.trailing, 44).frame(height: 236, alignment: .top)
            } else { researchPile }
            HStack {
                EPText("我的资料"); Spacer()
                if open == "deck" { Button("\(knowledge.personalGraph?.pendingCount ?? 0) 份待整理") { store.openLibraryImport() }; EPButton("收起") { toggle(nil) } }
                Button { Task { await store.navigate(.library) } } label: { HStack(spacing:T.space1) { EPText("知识库"); WebIcon(name:.arrowRight,size:14) } }
            }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).buttonStyle(.plain).padding(.top, T.space6)
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
        let items = Array(research.projects.prefix(3)); let expanded = open == "hand"
        return GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                ForEach(Array(items.enumerated()), id: \.element.taskId) { index, project in
                    Button { if expanded { research.openWorkspace(project.taskId) } else { toggle("hand") } } label: {
                        VStack(alignment: .leading, spacing: T.space2) {
                            Text(project.stageLabel).font(TypeStyle.ui(T.textMeta)).padding(.horizontal, T.space2).padding(.vertical, T.space1).background(Color.primary.opacity(0.05), in: Capsule())
                            Text(ResearchStore.title(project)).font(TypeStyle.reading(T.textTitle)).lineLimit(2)
                            if let phenomenon = project.phenomenonSummary?.phenomenon, phenomenon != ResearchStore.title(project) { Text(phenomenon).font(TypeStyle.ui(T.textControl)).foregroundStyle(.secondary).lineLimit(expanded ? 1 : 2) }
                            if let blocker = project.blocker { Text(blocker.message).font(TypeStyle.ui(T.textMeta)).foregroundStyle(Palette(dark: scheme == .dark).danger) }
                            Spacer(minLength: 0)
                            HStack { Text("更新于 \(project.updatedAt.prefix(10))"); Spacer(); Text((project.nextActionLabel.isEmpty ? "继续研究" : project.nextActionLabel) + " →") }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        }.opacity(expanded || index == 0 ? 1 : 0).padding(T.space5)
                            .frame(width: max(0, geometry.size.width - (expanded ? 0 : 44)), height: expanded ? 196 : 212, alignment: .topLeading)
                            .background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                            .shadow(color: T.shadowCard(dark: scheme == .dark).last!.color.color, radius: 12, y: 4)
                    }.buttonStyle(.plain).rotationEffect(.degrees(expanded ? 0 : Double(index) * 2.5), anchor: UnitPoint(x: 0.3, y: 1))
                        .offset(x: expanded ? 0 : CGFloat(index) * 22, y: CGFloat(index) * (expanded ? 208 : 10))
                        .zIndex(Double(10 - index))
                }
            }
        }.frame(height: expanded ? CGFloat(items.count * 208 - 12) : 236)
    }
    private func documentPile(_ graph: PersonalGraphResponse) -> some View {
        let documents = Array(graph.nodes.filter { $0.nodeType == "document" && graph.sources[$0.id] != nil }.prefix(3))
        let expanded = open == "deck"
        return VStack(alignment: .leading, spacing: T.space3) {
            if !expanded {
                Button { toggle("deck") } label: {
                    VStack(alignment: .leading, spacing: T.space2) {
                        Text("\(graph.documentCount) 份资料 · \(graph.topicCount) 个主题").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        ForEach(documents.prefix(2), id: \.id) { Text($0.label).lineLimit(1).font(TypeStyle.ui(T.textControl)) }
                        if graph.pendingCount > 0 { Text("\(graph.pendingCount) 份待整理").font(TypeStyle.ui(T.textMeta)).underline() }
                    }.padding(.vertical, T.space4).padding(.horizontal, T.space5).frame(maxWidth: .infinity, alignment: .leading).frame(height: 138)
                        .background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                        .background(RoundedRectangle(cornerRadius: T.radiusCard).fill(Palette(dark: scheme == .dark).surface).shadow(radius: 0.5).offset(x: 6, y: 6))
                        .background(RoundedRectangle(cornerRadius: T.radiusCard).fill(Palette(dark: scheme == .dark).surface).shadow(radius: 0.5).offset(x: 12, y: 12))
                }.buttonStyle(.plain).padding(.trailing, 44).frame(height: 152, alignment: .top)
            } else {
                ForEach(documents, id: \.id) { node in
                    if let source = graph.sources[node.id] {
                        Button { Task { await store.navigate(.library); if store.route == .library { await knowledge.openDocument(libraryId: source.libraryId, documentId: source.documentId) } } } label: {
                            VStack(alignment: .leading, spacing: T.space2) {
                                Text(source.sourceUrl == nil ? "我的笔记" : "网页收藏").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                                Text(node.label).font(TypeStyle.reading(T.textTitle)).lineLimit(2)
                                if let raw = source.sourceUrl, let host = URL(string: raw)?.host { Text(host).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                            }.padding(.vertical, T.space4).padding(.horizontal, T.space5).frame(maxWidth: .infinity, alignment: .leading).frame(height: 112)
                                .background(Palette(dark: scheme == .dark).surface, in: RoundedRectangle(cornerRadius: T.radiusCard))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }
    private func toggle(_ value: String?) { withAnimation(reduceMotion ? nil : .timingCurve(0.22, 1.28, 0.36, 1, duration: 0.6)) { open = value } }
    private func homeLoading(_ label: String) -> some View {
        EPText(label).font(TypeStyle.ui(T.textMeta)).foregroundStyle(Palette(dark:scheme == .dark).muted)
            .padding(T.space5).frame(maxWidth:.infinity,minHeight:152,alignment:.leading)
            .background(Palette(dark:scheme == .dark).mutedSurface,in:RoundedRectangle(cornerRadius:T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius:T.radiusCard).stroke(T.shadowCard(dark:scheme == .dark)[0].color.color,lineWidth:1))
            .shadow(color:T.shadowCard(dark:scheme == .dark)[1].color.color,radius:4,y:2)
    }
}
#endif
