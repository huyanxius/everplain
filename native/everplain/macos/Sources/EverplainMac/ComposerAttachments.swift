#if os(macOS)
import SwiftUI
import EverplainCore

struct ComposerTools: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let home: Bool
    let busy: Bool
    let close: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            if home {
                ComposerToolRow(title: "导入资料", icon: .uploadSimple) { close(); store.openLibraryImport() }
            } else {
                ComposerToolRow(title: "上传文件", icon: .filePlus) { close(); store.chooseComposerFiles() }.disabled(busy)
                ComposerToolRow(title: "从研究材料添加", icon: .folderOpen) { close(); store.openMaterialPicker() }.disabled(busy)
                if store.route == .chat { ComposerKnowledgeSelector(knowledge: store.knowledge, busy: busy, close: close) }
            }
        }.padding(6).frame(width: 240)
            .background(Palette(dark: scheme == .dark).raised, in: RoundedRectangle(cornerRadius: T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: T.radiusCard).stroke(Palette(dark: scheme == .dark).ring, lineWidth: 1))
    }
}
private struct ComposerKnowledgeSelector: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject var knowledge: KnowledgeStore
    let busy: Bool
    let close: () -> Void
    private var selected: String { store.conversation?.referenceKnowledgeBaseId ?? store.selectedReferenceKnowledgeBaseId ?? "" }
    var body: some View {
        VStack(alignment: .leading, spacing: T.space1) {
            HStack(spacing: T.space2) { WebIcon(name: .books, size: 17); EPText("知识来源") }.font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, T.space3)
            option("", "不使用个人知识库")
            if !selected.isEmpty, !knowledge.ownedLibraries.contains(where: { $0.id == selected }) { option(selected, knowledge.error == nil ? "当前知识库" : "当前知识库暂不可用") }
            ForEach(knowledge.ownedLibraries, id: \.id) { library in option(library.id, library.name ?? "知识库不可用") }
            if store.conversation != nil { EPText("切换将开启新对话").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.horizontal, 10) }
            else if !selected.isEmpty { EPText("本次对话将使用所选知识库").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary).padding(.horizontal, 10) }
            if knowledge.error != nil { EPButton("查看知识库") { close(); Task { await store.navigate(.library) } }.buttonStyle(EPGhostButtonStyle()) }
        }.task { await knowledge.load() }
    }
    private func option(_ id: String, _ label: String) -> some View {
        Button { close(); store.openLibraryChat(id.isEmpty ? nil : id) } label: {
            HStack { Text(label); Spacer(); if selected == id { WebIcon(name: .check, size: 15) } }.font(TypeStyle.ui(T.textControl)).padding(.horizontal, 10).frame(minHeight: 36)
        }.buttonStyle(WebRowStyle()).disabled(busy).accessibilityAddTraits(selected == id ? .isSelected : [])
    }
}
struct ComposerToolRow: View {
    @Environment(\.colorScheme) private var scheme
    @State private var hovered = false
    let title: String
    let icon: WebIconName
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                WebIcon(name: icon, size: 18)
                Text(title).font(TypeStyle.ui(T.textControl))
                Spacer(minLength: 0)
            }.padding(.horizontal, 10).frame(minHeight: 36)
                .background(hovered ? Palette(dark: scheme == .dark).strong : .clear, in: RoundedRectangle(cornerRadius: T.radiusItem))
        }.buttonStyle(.plain).onHover { hovered = $0 }
    }
}
struct ComposerAttachments: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let busy: Bool
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if store.materialPickerOpen { ComposerMaterialPicker(busy: busy) }
                ForEach(store.attachedMaterials, id: \.materialId) { material in
                    HStack(spacing: 6) {
                        WebIcon(name: .fileText, size: 14)
                        Text(material.filename).lineLimit(1)
                        Text(status(material)).foregroundStyle(Palette(dark: scheme == .dark).faint)
                        Button { store.removeComposerAttachment(id: material.materialId) } label: { WebIcon(name: .x, size: 12) }
                            .buttonStyle(.plain).frame(width: 22, height: 22).disabled(busy).accessibilityLabel("移除附件 \(material.filename)")
                    }.font(TypeStyle.ui(T.textMeta)).padding(.leading, 10).padding(.trailing, 4).frame(height: 32)
                        .background(Palette(dark: scheme == .dark).mutedSurface, in: RoundedRectangle(cornerRadius: T.radiusItem))
                        .frame(maxWidth: 260, alignment: .leading)
                }
                if store.materialUploading { EPText("正在上传…").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            }.padding(.horizontal, 4)
        }.frame(maxHeight: 220).fixedSize(horizontal: false, vertical: true)
    }
    private func status(_ material: ResearchMaterialResponse) -> String {
        if material.status == "ready" { return "已添加" }
        if material.status == "failed" { return "解析失败" }
        if material.ingestionStatus == "queued" { return "等待解析" }
        return "解析中"
    }
}
private struct ComposerMaterialPicker: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var query = ""
    let busy: Bool
    private var items: [ResearchMaterialResponse] {
        store.availableMaterials.filter { query.isEmpty || $0.filename.localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                EPText("选择研究材料").font(TypeStyle.reading(T.textTitle))
                Spacer()
                Button { store.materialPickerOpen = false } label: { WebIcon(name: .x) }.buttonStyle(EPIconButtonStyle()).accessibilityLabel("关闭")
            }
            TextField("搜索文件名", text: $query).textFieldStyle(.plain).font(TypeStyle.ui(T.textControl))
                .padding(10).background(Palette(dark: scheme == .dark).mutedSurface, in: Capsule()).accessibilityLabel("搜索文件")
            if store.materialPickerLoading { EPText("正在加载文件…").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary) }
            else if items.isEmpty {
                Text(query.isEmpty ? "还没有文件，可以直接上传。" : "没有找到匹配的文件。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
            } else {
                ForEach(items, id: \.materialId) { material in
                    Toggle(isOn: Binding(get: { store.attachedMaterials.contains { $0.materialId == material.materialId } }, set: { _ in store.toggleComposerMaterial(material) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(material.filename).font(TypeStyle.ui(T.textControl, weight: .medium))
                            Text(material.status == "ready" ? "可检索" : unavailable(material)).font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                        }
                    }.toggleStyle(.checkbox).disabled(busy || material.status != "ready")
                }
            }
            HStack {
                Text("已选择 \(store.attachedMaterials.count) 份").font(TypeStyle.ui(T.textMeta)).foregroundStyle(.secondary)
                Spacer()
                EPButton("完成") { store.materialPickerOpen = false }.buttonStyle(EPButtonStyle(primary: true))
            }
        }.padding(8).onExitCommand { store.materialPickerOpen = false }
    }
    private func unavailable(_ material: ResearchMaterialResponse) -> String {
        switch material.unavailableReason {
        case "ocr_required": return "需要 OCR，当前未配置，暂不可检索"
        case "transcription_unavailable": return "转写服务未配置，暂不可检索"
        case "transcription_required": return "需要先完成转写"
        default:
            if material.ingestionStatus == "queued" { return "等待解析，暂时不能附加" }
            if ["processing", "uploaded"].contains(material.status) { return "正在解析，暂时不能附加" }
            return material.status == "failed" ? "解析失败，请先在材料库重试" : "当前不可附加"
        }
    }
}
#endif
