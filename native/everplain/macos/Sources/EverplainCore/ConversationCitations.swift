import Foundation

/// Native equivalent of citationPresentation/remarkAgentCitations: only returned, unambiguous,
/// nondeleted sources get a number. Unknown/unfinished model markers never become links.
public enum ConversationCitations {
    public static func displayText(_ source: String) -> String {
        source.replacingOccurrences(of: "\\[(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]+\\]|【(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]+】", with: "", options: .regularExpression)
            .replacingOccurrences(of: "(?:\\[|【)(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]*$", with: "", options: .regularExpression)
    }
    public struct Prepared: Equatable, Sendable {
        public var text: String
        public var sourceOffsets: [Int]
        public var citationAtOffset: [Int: Int]
        public init(text: String, sourceOffsets: [Int], citationAtOffset: [Int: Int]) {
            self.text = text; self.sourceOffsets = sourceOffsets; self.citationAtOffset = citationAtOffset
        }
    }
    public static func prepare(_ source: String, citations: [AgentCitationResponse]) -> Prepared {
        var aliases: [String: Int] = [:]
        for (index, citation) in citations.enumerated() {
            var keys = [citation.citationId.replacingOccurrences(of: "^citation_id:", with: "", options: .regularExpression)]
            if let material = citation.materialId, let segment = citation.segmentId { keys.append("material:\(material):\(segment)") }
            if let knowledge = citation.knowledgeId { keys.append("knowledge:\(knowledge)") }
            if let id = citation.sourceId { keys.append("\(citation.sourceKind == "web" ? "web" : "source"):\(id)") }
            for key in Set(keys) { aliases[key] = aliases[key] != nil || citation.deleted == true ? -1 : index }
        }
        let raw = source as NSString
        let patterns = ["`+[^`]*`+", "\\[[^\\]\\n]*\\]\\([^)]*\\)", "<[^>]+>"]
        let protected = patterns.flatMap { pattern in
            (try? NSRegularExpression(pattern: pattern).matches(in: source, range: NSRange(location: 0, length: raw.length)).map(\.range)) ?? []
        }
        let pattern = "\\[(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]+\\]|【(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]+】|(?:\\[|【)(?:citation_id|knowledge|source|material|web):[^\\s\\[\\]【】]*$"
        let matches = (try? NSRegularExpression(pattern: pattern).matches(in: source, range: NSRange(location: 0, length: raw.length))) ?? []
        var result = Prepared(text: "", sourceOffsets: [], citationAtOffset: [:]), cursor = 0
        func append(_ range: NSRange) {
            guard range.length > 0 else { return }
            result.text += raw.substring(with: range)
            result.sourceOffsets += Array(range.location..<(range.location + range.length))
        }
        for match in matches {
            let range = match.range
            if protected.contains(where: { NSIntersectionRange($0, range).length > 0 }) { continue }
            let end = range.location + range.length
            if raw.substring(with: range).hasSuffix("]"), end < raw.length,
               ["(", "["].contains(raw.substring(with: NSRange(location: end, length: 1))) { continue }
            append(NSRange(location: cursor, length: range.location - cursor))
            let marker = raw.substring(with: range)
            if marker.hasSuffix("]") || marker.hasSuffix("】") {
                let key = String(marker.dropFirst().dropLast()).replacingOccurrences(of: "^citation_id:", with: "", options: .regularExpression)
                if let index = aliases[key], index >= 0 {
                    result.citationAtOffset[result.text.utf16.count] = index
                    result.text += "\u{FFFC}"
                    result.sourceOffsets.append(end - 1)
                }
            }
            cursor = end
        }
        append(NSRange(location: cursor, length: raw.length - cursor))
        return result
    }
}
