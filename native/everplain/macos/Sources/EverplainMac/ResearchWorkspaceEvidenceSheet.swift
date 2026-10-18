#if os(macOS)
import SwiftUI
import EverplainCore

struct ResearchWorkspaceEvidenceSheet: View {
    @ObservedObject var workspace: ResearchWorkspaceStore
    let reference: ResearchDocumentEvidenceRefContract
    @Environment(\.dismiss) private var dismiss
    @State private var material: ResearchMaterialResponse?
    @State private var loading = true
    var body: some View {
        VStack(alignment: .leading, spacing: T.space4) {
            HStack { Text(material?.filename ?? "研究依据").font(TypeStyle.reading(T.textHeading)); Spacer(); EPButton("关闭") { dismiss() } }
            Text("\(reference.evidenceRefId) · \(reference.sourceId)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).textSelection(.enabled)
            if loading { ProgressView() }
            else if let material {
                if !material.isCurrentParse { InlineMessage(text: "这是文稿所引用的历史解析版本。") }
                ScrollView { VStack(alignment: .leading, spacing: T.space4) {
                    ForEach((material.segments ?? []).filter { reference.segmentId == nil || $0.segmentId == reference.segmentId }, id: \.segmentId) { segment in
                        Text("片段 \(segment.ordinal + 1) · 解析 \(segment.parseId)").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary); Text(segment.text).font(TypeStyle.reading(T.textBody)).textSelection(.enabled); Divider()
                    }
                    if (material.segments ?? []).filter({ reference.segmentId == nil || $0.segmentId == reference.segmentId }).isEmpty { InlineMessage(text: material.unavailableReason ?? "这段引用的原文暂不可用，引用标识仍保留。", isError: true) }
                } }
            } else { InlineMessage(text: workspace.error ?? "这份依据暂时无法读取。", isError: true); EPButton("重试") { Task { await load() } } }
        }.padding(T.space6).frame(width: 650, height: 520).task(id: reference.evidenceRefId) { await load() }
    }
    private func load() async { loading = true; material = nil; material = await workspace.readEvidenceMaterial(reference); loading = false }
}
#endif
