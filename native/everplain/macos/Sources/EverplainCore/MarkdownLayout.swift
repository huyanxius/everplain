import Foundation
import Markdown

public struct NativeMarkdownCell: Equatable, Sendable {
    public let text: String
    public let sourceOffsets: [Int]
    public let alignment: String
}
public struct NativeMarkdownBlock: Identifiable, Equatable, Sendable {
    public let id: Int
    public let kind: String
    public let text: String
    public let sourceOffsets: [Int]
    public var heading = 0
    public var indent = 0
    public var quoteDepth = 0
    public var marker: String?
    public var language: String?
    public var rows: [[NativeMarkdownCell]] = []
    public var imageSource: String?
    public var alignment = "left"
    public var offset: Int { sourceOffsets.first ?? 0 }
    public init(id: Int, kind: String, text: String, sourceOffsets: [Int]) {
        self.id = id; self.kind = kind; self.text = text; self.sourceOffsets = sourceOffsets
    }
}

/// CommonMark/GFM structure comes from the Swift project's cmark-backed parser.
/// Source offsets remain UTF-16 to match the Web stream pacer and citation ages.
public enum NativeMarkdownLayout {
    public static func parse(_ source: String) -> [NativeMarkdownBlock] {
        let document = Document(parsing: source)
        let lines = source.components(separatedBy: "\n")
        var lineOffsets: [Int] = [], accumulated = 0
        for line in lines { lineOffsets.append(accumulated); accumulated += line.utf16.count + 1 }
        let raw = source as NSString
        func offset(_ location: SourceLocation) -> Int {
            guard !lines.isEmpty else { return 0 }
            let index = max(0, min(lines.count - 1, location.line - 1))
            let prefix = lines[index].utf8.prefix(max(0, location.column - 1))
            return min(raw.length, lineOffsets[index] + String(decoding: prefix, as: UTF8.self).utf16.count)
        }
        func range(_ node: any Markup, inline: Bool) -> Range<Int> {
            var lower = node.range?.lowerBound, upper = node.range?.upperBound
            if inline {
                if let first = Array(node.children).first?.range?.lowerBound { lower = first }
                if let last = Array(node.children).last?.range?.upperBound { upper = last }
            }
            let start = lower.map(offset) ?? 0, end = upper.map(offset) ?? start
            return start..<max(start, end)
        }
        func slice(_ node: any Markup, inline: Bool = true, quoteDepth: Int = 0) -> (String, [Int]) {
            let bounds = range(node, inline: inline)
            let text = raw.substring(with: NSRange(location: bounds.lowerBound, length: bounds.count))
            var result = "", positions: [Int] = [], cursor = bounds.lowerBound
            for (index, line) in text.components(separatedBy: "\n").enumerated() {
                var kept = line, removed = 0
                if index > 0 {
                    // Container prefixes are syntax, not visible text. Retain each
                    // surviving character's original offset instead of retiming it.
                    for _ in 0..<quoteDepth {
                        let leading = kept.prefix(while: { $0 == " " || $0 == "\t" })
                        if kept.dropFirst(leading.count).first == ">" {
                            removed += leading.utf16.count + 1; kept = String(kept.dropFirst(leading.count + 1))
                            if kept.first == " " { kept.removeFirst(); removed += 1 }
                        }
                    }
                    let leading = kept.prefix(while: { $0 == " " || $0 == "\t" })
                    removed += leading.utf16.count; kept = String(kept.dropFirst(leading.count))
                    result += "\n"; positions.append(max(bounds.lowerBound, cursor - 1))
                }
                result += kept; positions += Array((cursor + removed)..<(cursor + line.utf16.count))
                cursor += line.utf16.count + 1
            }
            return (result, positions)
        }
        var blocks: [NativeMarkdownBlock] = []
        func append(kind: String, text: String, offsets: [Int], heading: Int = 0, indent: Int, quote: Int, marker: String? = nil, language: String? = nil, rows: [[NativeMarkdownCell]] = [], image: String? = nil) {
            guard !text.isEmpty || kind == "rule" || kind == "table" || kind == "image" else { return }
            var block = NativeMarkdownBlock(id: blocks.count, kind: kind, text: text, sourceOffsets: offsets)
            block.heading = heading; block.indent = indent; block.quoteDepth = quote; block.marker = marker; block.language = language; block.rows = rows; block.imageSource = image
            blocks.append(block)
        }
        func walk(_ node: any Markup, indent: Int = 0, quote: Int = 0, marker: String? = nil) {
            if let list = node as? OrderedList {
                for (index, item) in list.children.enumerated() { walk(item, indent: indent, quote: quote, marker: "\(Int(list.startIndex) + index).") }
            } else if node is UnorderedList {
                for item in node.children { walk(item, indent: indent, quote: quote, marker: "•") }
            } else if let item = node as? ListItem {
                let label = item.checkbox.map { $0 == .checked ? "☑" : "☐" } ?? marker
                for (index, child) in item.children.enumerated() {
                    let nested = child is OrderedList || child is UnorderedList
                    walk(child, indent: indent + (nested ? 1 : 0), quote: quote, marker: index == 0 && !nested ? label : nil)
                }
            } else if node is BlockQuote {
                for (index, child) in node.children.enumerated() { walk(child, indent: indent, quote: quote + 1, marker: index == 0 ? marker : nil) }
            } else if let table = node as? Table {
                let allRows: [any Markup] = [table.head] + table.body.rows.map { $0 as any Markup }
                let rows: [[NativeMarkdownCell]] = allRows.map { row -> [NativeMarkdownCell] in
                    return row.children.enumerated().map { entry -> NativeMarkdownCell in
                    let (index, cell) = entry
                    // cmark's child span counts decoded escapes in table cells.
                    // Split the original row so an escaped pipe never truncates text.
                    let lineIndex = max(0, min(lines.count - 1, (row.range?.lowerBound.line ?? 1) - 1))
                    let rawLine = lines[lineIndex] as NSString
                    var ranges: [Range<Int>] = [], start = 0, escaped = false
                    for position in 0..<rawLine.length {
                        let unit = rawLine.character(at: position)
                        if unit == 0x7C && !escaped { ranges.append(start..<position); start = position + 1 }
                        if unit == 0x5C { escaped.toggle() } else { escaped = false }
                    }
                    ranges.append(start..<rawLine.length)
                    func trimmed(_ bounds: Range<Int>) -> Range<Int> {
                        var lower = bounds.lowerBound, upper = bounds.upperBound
                        while lower < upper && [UInt16(32), 9].contains(rawLine.character(at: lower)) { lower += 1 }
                        while upper > lower && [UInt16(32), 9].contains(rawLine.character(at: upper - 1)) { upper -= 1 }
                        return lower..<upper
                    }
                    if ranges.first.map({ trimmed($0).isEmpty }) == true { ranges.removeFirst() }
                    if ranges.last.map({ trimmed($0).isEmpty }) == true { ranges.removeLast() }
                    let text: String, offsets: [Int]
                    if ranges.indices.contains(index) {
                        let bounds = trimmed(ranges[index])
                        text = rawLine.substring(with: NSRange(location: bounds.lowerBound, length: bounds.count))
                        offsets = Array((lineOffsets[lineIndex] + bounds.lowerBound)..<(lineOffsets[lineIndex] + bounds.upperBound))
                    } else {
                        let sliced: (String, [Int]) = slice(cell, quoteDepth: quote)
                        text = sliced.0
                        offsets = sliced.1
                    }
                    let alignment: String
                    let columnAlignment: Table.ColumnAlignment? = table.columnAlignments.indices.contains(index) ? table.columnAlignments[index] : nil
                    switch columnAlignment { case .center?: alignment = "center"; case .right?: alignment = "right"; default: alignment = "left" }
                    return NativeMarkdownCell(text: text, sourceOffsets: offsets, alignment: alignment)
                } }
                append(kind: "table", text: "", offsets: [], indent: indent, quote: quote, marker: marker, rows: rows)
            } else if let code = node as? CodeBlock {
                let bounds = range(code, inline: false)
                let codeText = code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code
                let found = raw.range(of: codeText, options: .literal, range: NSRange(location: bounds.lowerBound, length: bounds.count))
                let start = found.location == NSNotFound ? bounds.lowerBound : found.location
                append(kind: "code", text: codeText, offsets: Array(start..<(start + codeText.utf16.count)), indent: indent, quote: quote, marker: marker, language: code.language)
            } else if node is ThematicBreak {
                append(kind: "rule", text: "", offsets: [], indent: indent, quote: quote, marker: marker)
            } else if let heading = node as? Heading {
                let (text, offsets) = slice(heading, quoteDepth: quote)
                append(kind: "heading", text: text, offsets: offsets, heading: heading.level, indent: indent, quote: quote, marker: marker)
            } else if node is Paragraph {
                if node.childCount == 1, let image = node.child(at: 0) as? Markdown.Image {
                    append(kind: "image", text: image.plainText, offsets: [], indent: indent, quote: quote, marker: marker, image: image.source)
                } else {
                    let (text, offsets) = slice(node, quoteDepth: quote)
                    append(kind: "body", text: text, offsets: offsets, indent: indent, quote: quote, marker: marker)
                }
            } else if let html = node as? HTMLBlock {
                let (text, offsets) = slice(html, inline: false, quoteDepth: quote)
                append(kind: "body", text: text, offsets: offsets, indent: indent, quote: quote, marker: marker)
            } else { for child in node.children { walk(child, indent: indent, quote: quote, marker: marker) } }
        }
        for child in document.children { walk(child) }
        return blocks
    }
}
