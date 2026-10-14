import Foundation
import EverplainCore
@main struct LibraryEditorDraftChecks {
    static func main() throws {
        let knowledge = CourseKnowledgeResponse(relations: [.init(label: "supports", segmentIds: ["s1"], source: "A", target: "B"), .init(label: "contrasts", segmentIds: ["s3"], source: "B", target: "C")], summary: "Synthetic draft", topics: [.init(segmentIds: ["s1"], summary: "Source A", title: "A"), .init(segmentIds: ["s2"], summary: "Source B", title: "B"), .init(segmentIds: ["s3"], summary: "Source C", title: "C")])
        var draft = LibraryEditorDraft(knowledge: knowledge)
        let a = draft.topics[0].id, b = draft.topics[1].id, c = draft.topics[2].id
        let oldRelation = draft.relations[0].id
        draft.renameTopic(b, title: " B revised ")
        precondition(draft.relations[0].value.target == " B revised " && draft.relations[1].value.source == " B revised ")
        precondition(draft.topics[1].value.segmentIds == ["s2"])
        precondition(draft.request.topics[1].title == "B revised" && draft.request.relations?[0].target == "B revised")
        print("PASS renaming retains evidence and updates relation endpoints consistently")
        draft.removeTopic(a)
        precondition(draft.topics.map(\.id) == [b,c] && draft.relations.count == 1)
        draft.updateTopic(b, value: .init(segmentIds: ["s2"], summary: "Updated B after A was removed", title: " B revised "))
        precondition(draft.topics[0].id == b && draft.topics[0].value.summary == "Updated B after A was removed" && draft.topics[1].id == c && draft.topics[1].value.summary == "Source C")
        print("PASS stable row binding updates the same topic after preceding row deletion")
        draft.updateTopic(a, value: .init(segmentIds: [], summary: "stale", title: "stale"))
        draft.updateRelation(oldRelation, value: .init(label: "stale", segmentIds: [], source: "A", target: "C"))
        precondition(draft.topics.count == 2 && draft.relations.count == 1 && draft.relations[0].value.label == "contrasts")
        print("PASS late callbacks from deleted topic and relation controls cannot alter surviving rows")
        let request = draft.request
        precondition(KnowledgeLogic.validateKnowledge(request, segments: ["s1","s2","s3"]) == nil)
        let json = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
        precondition(!json.contains(b.uuidString) && !json.contains(c.uuidString))
        print("PASS generated request keeps provenance and excludes private UI identifiers")
    }
}
