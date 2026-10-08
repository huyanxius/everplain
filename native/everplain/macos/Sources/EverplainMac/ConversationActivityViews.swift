#if os(macOS)
import SwiftUI
import EverplainCore

struct ConversationMoreMenu: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let close: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            EPText("联网搜索").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.horizontal, 10)
            ComposerToolRow(title: store.webSearchEnabled ? "联网已开启" : "联网搜索", icon: .globeHemisphereWest) { store.webSearchEnabled.toggle() }.disabled(store.running)
            ComposerToolRow(title: "研究面板", icon: .sidebarSimple) { close(); store.toggleResearchPanel() }
        }.padding(8).frame(width: 240)
            .background(Palette(dark: scheme == .dark).raised, in: RoundedRectangle(cornerRadius: T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(Palette(dark: scheme == .dark).ring, lineWidth: 1))
    }
}

struct ChatActivityStep: Identifiable {
    let source: NativeToolStep
    var id: String { source.id }
    var label: String { source.label }
    var status: String { source.status }
    var detail: String? { source.detail }
    init(_ step: NativeToolStep) { source = step }
    static func persisted(_ traces: [AgentToolTraceResponse]) -> [Self] { NativeToolStep.fromTraces(traces).map(Self.init) }
}
struct NativeConversationActivity: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var expanded = false
    let steps: [ChatActivityStep]
    private var label: String {
        if steps.contains(where: { $0.status == "running" }) { return "Agent 正在调用工具" }
        if steps.contains(where: { $0.status == "failed" }) { return "工具调用未完成" }
        return "Agent 已完成工具调用"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button { expanded.toggle() } label: {
                    HStack(spacing: 8) {
                        WebIcon(name: .caretRight).rotationEffect(.degrees(expanded ? 90 : 0))
                            .animation(reducedMotion ? nil : .easeOut(duration: 0.240), value: expanded)
                        Text(label)
                        Text("\(steps.count) 个实际步骤")
                    }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                }.buttonStyle(.plain).accessibilityLabel("\(label)，\(steps.count) 个实际步骤")
                Spacer(minLength: 0)
                EPButton("查看活动") { store.researchPanelOpen = true }.buttonStyle(.plain).font(TypeStyle.ui(T.textMeta))
            }
            if expanded {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(steps) { step in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top) {
                                Text(step.label).font(TypeStyle.ui(T.textMeta, weight: .medium))
                                Spacer()
                                HStack(spacing: 4) {
                                    if step.status == "running" {
                                        TimelineView(.animation(minimumInterval: 1 / 30, paused: reducedMotion)) { time in
                                            Circle().trim(from: 0.12, to: 0.96).stroke(style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
                                                .rotationEffect(.degrees(reducedMotion ? 0 : time.date.timeIntervalSinceReferenceDate / 1.1 * 360))
                                        }.frame(width: 13, height: 13)
                                    } else { WebIcon(name: step.status == "completed" ? .checkCircle : .x, size: 13) }
                                    Text(step.status == "running" ? "进行中" : step.status == "completed" ? "已完成" : "失败")
                                }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(step.status == "failed" ? Palette(dark: scheme == .dark).danger : Palette(dark: scheme == .dark).muted)
                            }
                            if let detail = step.detail, !detail.isEmpty { Text(detail).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).textSelection(.enabled) }
                            EPButton("查看这一步") { store.selectToolStep(step.source) }.buttonStyle(.plain).font(TypeStyle.ui(T.textMeta))
                        }
                    }
                }.padding(.leading, 16).overlay(alignment: .leading) { Rectangle().fill(Palette(dark: scheme == .dark).rule).frame(width: 1) }
            }
        }.accessibilityElement(children: .contain).accessibilityLabel("Agent 工作过程")
    }
}

struct NativeResearchFlow: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var custom = ""
    @State private var customOpen = false
    @State private var chosen: String?
    @State private var dismissed = false
    let progress: NativeResearchProgress
    private var busy: Bool { store.running || store.isCurrentStopPending }
    private var label: String {
        switch progress.stage {
        case "clarifying": return "确认研究意图"
        case "planning": return "研究计划"
        case "completed": return "研究结论"
        default: return "研究进度"
        }
    }
    var body: some View {
        if !dismissed {
            VStack(alignment: .leading, spacing: 16) {
                Text(progress.question.isEmpty ? label : progress.question).font(TypeStyle.reading(T.textTitle).weight(.medium))
                if progress.stage == "clarifying" {
                    ForEach(progress.options.filter { $0 != "更多自定义" }, id: \.self) { option in
                        Button(option) { choose(option) }.buttonStyle(EPGhostButtonStyle()).disabled(busy || chosen != nil)
                    }
                    if chosen == nil {
                        EPButton("更多自定义") { customOpen.toggle() }.buttonStyle(EPGhostButtonStyle()).disabled(busy)
                        if customOpen {
                            HStack(alignment: .bottom, spacing: 8) {
                                VStack(alignment: .leading, spacing: 4) {
                                    EPText("补充方向").font(TypeStyle.ui(T.textMeta))
                                    TextField("", text: $custom).textFieldStyle(EPFieldStyle()).onSubmit { choose(custom) }
                                }
                                EPButton("继续") { choose(custom) }.buttonStyle(EPButtonStyle(primary: true)).disabled(busy || custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }
                        EPButton("跳过") { chosen = "skip"; store.continueDeepResearch("skip") }.buttonStyle(EPGhostButtonStyle()).disabled(busy)
                    } else { EPText("正在根据你的选择继续讨论。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                } else if progress.stage == "planning" {
                    ForEach(Array(progress.steps.enumerated()), id: \.offset) { step in
                        Text("\(step.offset + 1). \(step.element)").font(TypeStyle.reading(T.textReading))
                    }
                    HStack {
                        EPButton("开始深入研究") { store.continueDeepResearch("confirm") }.buttonStyle(EPButtonStyle(primary: true)).disabled(busy)
                        EPButton("返回修改") { dismissed = true; store.focusComposer = UUID() }.buttonStyle(EPGhostButtonStyle()).disabled(busy)
                    }
                } else {
                    if let step = progress.currentStep { Text(step).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
                    if progress.stage == "completed" {
                        Text(progress.conclusion ?? "本轮没有可摘录的结论，完整回答见对话正文。").font(TypeStyle.reading(T.textReading)).textSelection(.enabled)
                        HStack {
                            if let count = progress.knowledgeCount { Text("知识库 \(count) 条") }
                            if let count = progress.webCount { Text("网页资料 \(count) 条") }
                        }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                    }
                }
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(Palette(dark: scheme == .dark).rule, lineWidth: 1))
                .onChange(of: progress.stage) { _ in chosen = nil; custom = ""; customOpen = false; dismissed = false }
                .onChange(of: progress.question) { _ in chosen = nil; custom = ""; customOpen = false; dismissed = false }
                .onChange(of: store.error) { error in if error != nil { chosen = nil } }
        }
    }
    private func choose(_ option: String) {
        let value = option.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !busy, chosen == nil else { return }
        chosen = value; store.continueDeepResearch("clarify", selection: value)
    }
}
#endif
