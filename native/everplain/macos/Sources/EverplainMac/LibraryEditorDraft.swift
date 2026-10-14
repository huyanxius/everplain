import Foundation
import EverplainCore

/// UI-only identities keep an open editor control attached to the same draft row.
/// The request remains the generated HTTP contract; these IDs never go over the wire.
struct LibraryTopicDraft: Identifiable {
    let id: UUID
    var value: UpdateKnowledgeTopic
    init(value: UpdateKnowledgeTopic, id: UUID = UUID()) { self.id = id; self.value = value }
}
struct LibraryRelationDraft: Identifiable {
    let id: UUID
    var value: UpdateKnowledgeRelation
    init(value: UpdateKnowledgeRelation, id: UUID = UUID()) { self.id = id; self.value = value }
}
struct LibraryEditorDraft {
    var summary: String
    var topics: [LibraryTopicDraft]
    var relations: [LibraryRelationDraft]
    init(knowledge: CourseKnowledgeResponse? = nil) {
        summary = knowledge?.summary ?? ""
        topics = (knowledge?.topics ?? []).map { LibraryTopicDraft(value: .init(segmentIds: $0.segmentIds, summary: $0.summary, title: $0.title)) }
        relations = (knowledge?.relations ?? []).map { LibraryRelationDraft(value: .init(label: $0.label, segmentIds: $0.segmentIds, source: $0.source, target: $0.target)) }
    }
    mutating func renameTopic(_ id: UUID, title: String) {
        guard let index = topics.firstIndex(where: { $0.id == id }) else { return }
        let previous = topics[index].value.title
        topics[index].value.title = title
        for index in relations.indices {
            if relations[index].value.source == previous { relations[index].value.source = title }
            if relations[index].value.target == previous { relations[index].value.target = title }
        }
    }
    mutating func removeTopic(_ id: UUID) {
        guard let topic = topics.first(where: { $0.id == id }) else { return }
        topics.removeAll { $0.id == id }
        relations.removeAll { $0.value.source == topic.value.title || $0.value.target == topic.value.title }
    }
    mutating func updateTopic(_ id: UUID, value: UpdateKnowledgeTopic) {
        guard let index = topics.firstIndex(where: { $0.id == id }) else { return }
        topics[index].value = value
    }
    mutating func updateRelation(_ id: UUID, value: UpdateKnowledgeRelation) {
        guard let index = relations.firstIndex(where: { $0.id == id }) else { return }
        relations[index].value = value
    }
    var request: UpdateDocumentKnowledgeRequest {
        func trim(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
        return .init(relations: relations.map { .init(label: trim($0.value.label), segmentIds: $0.value.segmentIds, source: trim($0.value.source), target: trim($0.value.target)) }, summary: trim(summary), topics: topics.map { .init(segmentIds: $0.value.segmentIds, summary: trim($0.value.summary), title: trim($0.value.title)) })
    }
}
