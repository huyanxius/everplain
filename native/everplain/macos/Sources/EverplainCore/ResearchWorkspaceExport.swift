import Foundation
import Markdown
#if canImport(FoundationXML)
import FoundationXML
#endif

public enum ResearchWorkspaceExportFormat: String, Sendable { case pdf, docx }
public struct ResearchExportRun: Equatable, Sendable {
    public var text: String
    public var bold = false
    public var italic = false
    public var code = false
    public var strike = false
    public var vertical = 0
    public var link: String?
    public init(_ text: String, bold: Bool = false, italic: Bool = false) { self.text = text; self.bold = bold; self.italic = italic }
}
public struct ResearchExportBlock: Equatable, Sendable {
    public var kind = "paragraph"
    public var runs: [ResearchExportRun] = []
    public var heading = 0
    public var indent = 0
    public var quoteDepth = 0
    public var marker: String?
    public var rows: [[[ResearchExportRun]]] = []
    public var alignments: [String] = []
    public var imageSource: String?
    public init(kind: String = "paragraph", runs: [ResearchExportRun] = []) { self.kind = kind; self.runs = runs }
}
public struct ResearchExportSection: Equatable, Sendable {
    public let id: String
    public let title: String
    public let markdown: String
    public init(id: String, title: String, markdown: String) { self.id = id; self.title = title; self.markdown = markdown }
}
public struct ResearchExportCitation: Equatable, Sendable, Codable {
    public let citationId: String
    public let sourceId: String
    public let sourceVersion: String?
    public let state: String
    public let csl: [String: JSONValue]?
    public init(citationId: String, sourceId: String, sourceVersion: String? = nil, state: String, csl: [String: JSONValue]? = nil) {
        self.citationId = citationId; self.sourceId = sourceId; self.sourceVersion = sourceVersion
        self.state = state == "verified" && csl == nil ? "needs_verification" : state; self.csl = csl
    }
}
public struct ResearchExportBibliography: Equatable, Sendable {
    public let htmlEntries: [String]
    public let textEntries: [String]
    public let hangingIndent: Bool
    public let entrySpacing: Double
    public let lineSpacing: Double
    public init(htmlEntries: [String] = [], textEntries: [String] = [], hangingIndent: Bool = false, entrySpacing: Double = 0, lineSpacing: Double = 1) {
        self.htmlEntries = htmlEntries; self.textEntries = textEntries; self.hangingIndent = hangingIndent; self.entrySpacing = entrySpacing; self.lineSpacing = lineSpacing
    }
    public var richEntries: [[ResearchExportRun]] { textEntries.enumerated().map { index, fallback in
        guard htmlEntries.indices.contains(index), var parsed = ResearchExportHTML.runs(htmlEntries[index]), !parsed.isEmpty else { return [ResearchExportRun(fallback.trimmingCharacters(in: .whitespacesAndNewlines))] }
        while parsed.first?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true { parsed.removeFirst() }
        while parsed.last?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true { parsed.removeLast() }
        if !parsed.isEmpty { parsed[0].text = String(parsed[0].text.drop(while: \.isWhitespace)); let last = parsed.count - 1; parsed[last].text = String(parsed[last].text.reversed().drop(while: \.isWhitespace).reversed()) }; return parsed
    } }
}
public struct ResearchExportDocument: Sendable {
    public let title: String
    public let sections: [ResearchExportSection]
    public let formatting: ResearchDocumentFormattingContract
    public let citations: [ResearchExportCitation]
    public let manifest: ResearchDocumentExportManifest
    public let filename: String
    public var warnings: [ResearchExportCitation] { citations.filter { $0.state != "verified" || $0.csl == nil } }
    public init(exported: ResearchDocumentExportResponse, literature: [LiteratureEntryResponse] = []) {
        let formal = exported.manifest.formalDocument
        title = formal["title"]?.exportString ?? exported.filename
        sections = (formal["sections"]?.exportArray ?? []).enumerated().compactMap { index, value in
            guard let object = value.exportObject else { return nil }
            return ResearchExportSection(id: object["section_id"]?.exportString ?? "section_\(index + 1)", title: object["title"]?.exportString ?? "", markdown: object["content"]?.exportString ?? "")
        }
        formatting = exported.manifest.formatting; manifest = exported.manifest; filename = exported.filename
        citations = exported.manifest.citationAudit.map { audit in
            // Literature entries are unversioned in the actual API. Never substitute present metadata for a historical citation.
            var csl: [String: JSONValue]?
            if audit.sourceVersion == nil, let entry = literature.first(where: { $0.literatureId == audit.sourceId || $0.cslData["id"]?.exportString == audit.sourceId }), !entry.cslData.isEmpty {
                csl = entry.cslData; csl?["id"] = .string(audit.sourceId)
            }
            return ResearchExportCitation(citationId: audit.citationId, sourceId: audit.sourceId, sourceVersion: audit.sourceVersion, state: audit.state, csl: csl)
        }
    }
}
private extension JSONValue {
    var exportString: String? { if case .string(let value) = self { return value }; return nil }
    var exportArray: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var exportObject: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
}

/// Shared portable CommonMark/GFM parsing for native PDF and editable OOXML exports.
public enum ResearchExportMarkdown {
    public static func blocks(_ source: String) -> [ResearchExportBlock] {
        let parsed = Document(parsing: source); var result: [ResearchExportBlock] = []
        func walk(_ node: any Markup, indent: Int = 0, quote: Int = 0, marker: String? = nil) {
            if let list = node as? OrderedList { for (index, item) in list.children.enumerated() { walk(item, indent: indent, quote: quote, marker: "\(Int(list.startIndex) + index).") } }
            else if node is UnorderedList { for item in node.children { walk(item, indent: indent, quote: quote, marker: "•") } }
            else if let item = node as? ListItem {
                let label = item.checkbox.map { $0 == .checked ? "☑" : "☐" } ?? marker
                for (index, child) in item.children.enumerated() { let nested = child is OrderedList || child is UnorderedList; walk(child, indent: indent + (nested ? 1 : 0), quote: quote, marker: index == 0 && !nested ? label : nil) }
            } else if node is BlockQuote { for child in node.children { walk(child, indent: indent, quote: quote + 1, marker: marker) } }
            else if let table = node as? Table {
                var block = ResearchExportBlock(kind: "table")
                let rows: [any Markup] = [table.head] + table.body.rows.map { $0 as any Markup }
                block.rows = rows.map { row in row.children.map { inlines($0) } }
                block.alignments = table.columnAlignments.map { switch $0 { case .center?: return "center"; case .right?: return "right"; default: return "left" } }
                block.indent = indent; block.quoteDepth = quote; result.append(block)
            } else if let code = node as? CodeBlock {
                var run = ResearchExportRun(code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code); run.code = true
                var block = ResearchExportBlock(kind: "code", runs: [run]); block.indent = indent; block.quoteDepth = quote; result.append(block)
            } else if node is ThematicBreak { result.append(ResearchExportBlock(kind: "rule")) }
            else if let heading = node as? Heading {
                var block = ResearchExportBlock(runs: inlines(heading)); block.heading = heading.level; block.indent = indent; block.quoteDepth = quote; block.marker = marker; result.append(block)
            } else if node is Paragraph {
                var block = ResearchExportBlock(runs: inlines(node)); block.indent = indent; block.quoteDepth = quote; block.marker = marker
                if node.childCount == 1, let image = node.child(at: 0) as? Markdown.Image { block.kind = "image"; block.imageSource = image.source }
                result.append(block)
            } else if let html = node as? HTMLBlock { result.append(ResearchExportBlock(runs: [ResearchExportRun(html.rawHTML)])) }
            else { for child in node.children { walk(child, indent: indent, quote: quote, marker: marker) } }
        }
        for child in parsed.children { walk(child) }; return result
    }
    public static func inlines(_ node: any Markup) -> [ResearchExportRun] {
        func visit(_ node: any Markup, style: ResearchExportRun) -> [ResearchExportRun] {
            var style = style
            if let text = node as? Markdown.Text { style.text = text.string; return [style] }
            if let code = node as? InlineCode { style.text = code.code; style.code = true; return [style] }
            if let html = node as? InlineHTML { style.text = html.rawHTML; return [style] }
            if node is LineBreak { style.text = "\n"; return [style] }
            if node is SoftBreak { style.text = " "; return [style] }
            if node is Strong { style.bold = true }; if node is Emphasis { style.italic = true }; if node is Strikethrough { style.strike = true }
            if let link = node as? Markdown.Link, let destination = link.destination, safeLink(destination) { style.link = destination }
            if let image = node as? Markdown.Image { style.text = "[图像：\(image.plainText)]" + (image.source.flatMap { safeLink($0) ? " (\($0))" : nil } ?? ""); return [style] }
            return node.children.flatMap { visit($0, style: style) }
        }
        return visit(node, style: ResearchExportRun(""))
    }
    public static func safeLink(_ value: String) -> Bool { guard let scheme = URL(string: value)?.scheme?.lowercased() else { return false }; return ["http", "https", "mailto"].contains(scheme) }
}

/// Citeproc emits XHTML fragments. Parse text/formatting only; no HTML engine, resource loading or script execution.
public enum ResearchExportHTML {
    public static func runs(_ html: String) -> [ResearchExportRun]? {
        let source = "<root>" + html.replacingOccurrences(of: "&nbsp;", with: "&#160;") + "</root>"
        guard !source.localizedCaseInsensitiveContains("<!DOCTYPE"), !source.localizedCaseInsensitiveContains("<!ENTITY"), let data = source.data(using: .utf8) else { return nil }
        let reader = BibliographyXMLReader(), parser = XMLParser(data: data); parser.delegate = reader; parser.shouldResolveExternalEntities = false
        return parser.parse() ? reader.result : nil
    }
}
private final class BibliographyXMLReader: NSObject, XMLParserDelegate {
    var result: [ResearchExportRun] = []; private var stack: [ResearchExportRun] = [ResearchExportRun("")]; private var skipping = 0
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        var style = stack.last ?? ResearchExportRun(""); style.text = ""
        if skipping > 0 || ["script", "style", "iframe", "object"].contains(name.lowercased()) { skipping += 1 }
        if ["i", "em"].contains(name) { style.italic = true }; if ["b", "strong"].contains(name) { style.bold = true }; if name == "sup" { style.vertical = 1 }; if name == "sub" { style.vertical = -1 }
        let css = (attributes["style"] ?? "").lowercased(); if css.contains("font-style: italic") || css.contains("font-style:italic") { style.italic = true }; if css.contains("font-weight: bold") || css.contains("font-weight:bold") { style.bold = true }
        if name == "a", let href = attributes["href"], ResearchExportMarkdown.safeLink(href) { style.link = href }
        if name == "br", skipping == 0 { var line = style; line.text = "\n"; result.append(line) }; stack.append(style)
    }
    func parser(_ parser: XMLParser, foundCharacters value: String) { guard skipping == 0 else { return }; var run = stack.last ?? ResearchExportRun(""); run.text = value; result.append(run) }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) { if skipping > 0 { skipping -= 1 }; if stack.count > 1 { stack.removeLast() } }
}

public struct ResearchExportPageStyle: Equatable, Sendable {
    public var width: Double
    public var height: Double
    public var top: Double
    public var right: Double
    public var bottom: Double
    public var left: Double
    public var font: String
    public var docxFont: String
    public var titleFont: String
    public var isASA: Bool
    public var fontSize: Double = 12
    public var lineHeight: Double
    public var firstLineIndent: Double
    public var titleSize: Double
    public var sectionSize: Double
    public var headingSizes: [Double]
    public var alignment: String
    public var color = "171717"
    public var backgroundColor = "FFFFFF"
    public var warnings: [String] = []
    public init(template: String, customCSS: String? = nil) {
        let asa = template == "asa"; isASA = asa; titleFont = asa ? "Times New Roman" : "Heiti SC"
        width = asa ? 612 : 210 * 72 / 25.4; height = asa ? 792 : 297 * 72 / 25.4
        top = asa ? 72 : 25 * 72 / 25.4; right = asa ? 72 : 24 * 72 / 25.4; bottom = right; left = right
        font = asa ? "Times New Roman" : "Songti SC"; docxFont = asa ? "Times New Roman" : "宋体"
        lineHeight = asa ? 2 : 1.8; firstLineIndent = asa ? 36 : 24; titleSize = asa ? 16 : 20; sectionSize = asa ? 12 : 16; headingSizes = asa ? [16, 12, 12] : [20, 16, 14]; alignment = asa ? "left" : "justify"
        if let customCSS, !customCSS.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { apply(css: customCSS) }
    }
    public var contentWidth: Double { max(72, width - left - right) }
    public var contentHeight: Double { max(72, height - top - bottom) }
    public var widthTwips: Int { Int((width * 20).rounded()) }
    public var heightTwips: Int { Int((height * 20).rounded()) }
    private mutating func apply(css: String) {
        guard css.utf8.count <= 1_000_000 else { warnings.append("自定义 CSS 超出本机导出处理上限，已使用论文模板。"); return }
        let cleaned = css.replacingOccurrences(of: #"/\*[\s\S]*?\*/"#, with: "", options: .regularExpression)
        guard let regex = try? NSRegularExpression(pattern: #"([^{}]+)\{([^{}]*)\}"#) else { return }
        var unsupported = Set<String>()
        for match in regex.matches(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)) {
            guard let selectorRange = Range(match.range(at: 1), in: cleaned), let bodyRange = Range(match.range(at: 2), in: cleaned) else { continue }
            let selectors = cleaned[selectorRange].split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            for declaration in cleaned[bodyRange].split(separator: ";") {
                let parts = declaration.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }; guard parts.count == 2 else { continue }
                let property = parts[0].lowercased(), value = parts[1].replacingOccurrences(of: "!important", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                for selector in selectors {
                    if selector == "@page" {
                        if property == "size" { let tokens = value.lowercased().split(separator: " ").map(String.init); if tokens.first == "a4" { width = 210 * 72 / 25.4; height = 297 * 72 / 25.4 } else if tokens.first == "letter" { width = 612; height = 792 } else if tokens.count == 2, let w = Self.length(tokens[0]), let h = Self.length(tokens[1]) { width = w; height = h } else { unsupported.insert(property); continue }; if tokens.contains("landscape") { swap(&width, &height) } }
                        else if property == "margin", let values = Self.lengths(value) { switch values.count { case 1: top = values[0]; right = values[0]; bottom = values[0]; left = values[0]; case 2: top = values[0]; bottom = values[0]; right = values[1]; left = values[1]; case 3: top = values[0]; right = values[1]; left = values[1]; bottom = values[2]; case 4: top = values[0]; right = values[1]; bottom = values[2]; left = values[3]; default: unsupported.insert(property) } }
                        else if let size = Self.length(value) { switch property { case "margin-top": top = size; case "margin-right": right = size; case "margin-bottom": bottom = size; case "margin-left": left = size; default: unsupported.insert(property) } } else { unsupported.insert(property) }
                    } else if selector == "body" || selector == "p" {
                        switch property {
                        case "font-family": font = value.split(separator: ",").first.map(String.init)?.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")) ?? font; docxFont = font
                        case "font-size": if let size = Self.length(value), size > 0 { fontSize = size } else { unsupported.insert(property) }
                        case "line-height": if let multiple = Double(value), multiple > 0 { lineHeight = multiple } else if let size = Self.length(value) { lineHeight = size / fontSize } else { unsupported.insert(property) }
                        case "text-indent": if value.hasSuffix("em"), let number = Double(value.dropLast(2)) { firstLineIndent = number * fontSize } else if let size = Self.length(value) { firstLineIndent = size } else { unsupported.insert(property) }
                        case "text-align": if ["left", "center", "right", "justify"].contains(value) { alignment = value } else { unsupported.insert(property) }
                        case "color": if let hex = Self.color(value) { color = hex } else { unsupported.insert(property) }
                        case "background", "background-color": if let hex = Self.color(value) { backgroundColor = hex } else { unsupported.insert(property) }
                        default: unsupported.insert(property)
                        }
                    } else if selector == "h1", property == "font-family" { titleFont = value.split(separator: ",").first.map(String.init)?.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")) ?? titleFont }
                    else if ["h1", "h2", "h3"].contains(selector), property == "font-size", let size = Self.length(value), let number = Int(selector.suffix(1)), size > 0 { headingSizes[number - 1] = size; if number == 1 { titleSize = size }; if number == 2 { sectionSize = size } }
                    else { unsupported.insert("\(selector): \(property)") }
                }
            }
        }
        if cleaned.contains("<") { unsupported.insert("HTML 标记") }
        if width < 144 || height < 144 || left + right >= width - 72 || top + bottom >= height - 72 || fontSize > 96 || lineHeight > 6 { warnings.append("自定义页面尺寸或排版参数超出可打印范围，已使用论文模板。"); let messages = warnings; let fallback = isASA ? "asa" : "chinese-social-science"; self = ResearchExportPageStyle(template: fallback); warnings = messages }
        if !unsupported.isEmpty { warnings.append("以下自定义 CSS 属性无法由本机排版应用：" + unsupported.sorted().joined(separator: "、")) }
    }
    private static func lengths(_ text: String) -> [Double]? { let values = text.split(whereSeparator: \.isWhitespace).map { length(String($0)) }; guard values.allSatisfy({ $0 != nil }) else { return nil }; return values.compactMap { $0 } }
    private static func length(_ value: String) -> Double? {
        let text = value.lowercased().trimmingCharacters(in: .whitespacesAndNewlines); if text == "0" { return 0 }
        for (suffix, scale) in [("pt", 1.0), ("px", 0.75), ("in", 72.0), ("mm", 72.0 / 25.4), ("cm", 72.0 / 2.54)] where text.hasSuffix(suffix) { if let number = Double(text.dropLast(suffix.count)), number.isFinite, number >= 0 { return number * scale } }
        return nil
    }
    private static func color(_ value: String) -> String? { let colors = ["black":"000000", "white":"FFFFFF", "red":"FF0000", "blue":"0000FF", "gray":"808080"]; if let named = colors[value.lowercased()] { return named }; let raw = value.trimmingCharacters(in: CharacterSet(charactersIn: "#")); if raw.count == 6, UInt32(raw, radix: 16) != nil { return raw.uppercased() }; if raw.count == 3, UInt32(raw, radix: 16) != nil { return raw.map { "\($0)\($0)" }.joined().uppercased() }; return nil }
}

public enum ResearchExportFailure: Error, LocalizedError {
    case invalidPackage, missingResource(String), bibliography(String), rendering(String)
    public var errorDescription: String? { switch self { case .invalidPackage: return "文稿导出包超出支持范围。"; case .missingResource(let value): return "导出组件缺失：\(value)。请使用完整安装包。"; case .bibliography(let message): return "参考文献格式处理失败：\(message)"; case .rendering(let message): return "文稿排版失败：\(message)" } }
}

/// ZIP STORE is valid OOXML, deterministic and needs no shell, package manager, or compression dependency.
public enum ResearchExportZIP {
    public static func archive(_ parts: [(String, Data)]) throws -> Data {
        guard parts.count <= Int(UInt16.max), Set(parts.map(\.0)).count == parts.count else { throw ResearchExportFailure.invalidPackage }
        var data = Data(), directory = Data()
        for (name, body) in parts {
            let filename = Data(name.utf8); guard filename.count <= Int(UInt16.max), body.count <= Int(UInt32.max), data.count <= Int(UInt32.max), !name.hasPrefix("/"), !name.split(separator: "/").contains("..") else { throw ResearchExportFailure.invalidPackage }
            let crc = crc32(body), offset = UInt32(data.count), size = UInt32(body.count)
            data.le32(0x04034b50); data.le16(20); data.le16(0x0800); data.le16(0); data.le16(0); data.le16(0x21); data.le32(crc); data.le32(size); data.le32(size); data.le16(UInt16(filename.count)); data.le16(0); data.append(filename); data.append(body)
            directory.le32(0x02014b50); directory.le16(20); directory.le16(20); directory.le16(0x0800); directory.le16(0); directory.le16(0); directory.le16(0x21); directory.le32(crc); directory.le32(size); directory.le32(size); directory.le16(UInt16(filename.count)); directory.le16(0); directory.le16(0); directory.le16(0); directory.le16(0); directory.le32(0); directory.le32(offset); directory.append(filename)
        }
        guard data.count <= Int(UInt32.max), directory.count <= Int(UInt32.max) else { throw ResearchExportFailure.invalidPackage }; let offset = UInt32(data.count); data.append(directory)
        data.le32(0x06054b50); data.le16(0); data.le16(0); data.le16(UInt16(parts.count)); data.le16(UInt16(parts.count)); data.le32(UInt32(directory.count)); data.le32(offset); data.le16(0); return data
    }
    private static func crc32(_ bytes: Data) -> UInt32 { var crc = UInt32.max; for byte in bytes { crc ^= UInt32(byte); for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb88320 : crc >> 1 } }; return crc ^ UInt32.max }
}
private extension Data {
    mutating func le16(_ value: UInt16) { append(UInt8(truncatingIfNeeded: value)); append(UInt8(truncatingIfNeeded: value >> 8)) }
    mutating func le32(_ value: UInt32) { le16(UInt16(truncatingIfNeeded: value)); le16(UInt16(truncatingIfNeeded: value >> 16)) }
}

public enum ResearchExportDOCX {
    public static func data(document: ResearchExportDocument, bibliography: ResearchExportBibliography, modifiedAt: Date = Date()) throws -> Data {
        let style = ResearchExportPageStyle(template: document.formatting.templateId, customCSS: document.formatting.customCss)
        var links: [(String, String)] = []; var body = ""
        func runXML(_ run: ResearchExportRun) -> String {
            var properties = ""; if run.bold { properties += "<w:b/>" }; if run.italic { properties += "<w:i/>" }; if run.strike { properties += "<w:strike/>" }; if run.code { properties += "<w:rFonts w:ascii=\"Menlo\" w:hAnsi=\"Menlo\"/><w:shd w:fill=\"F3F3F3\"/>" }; if run.vertical != 0 { properties += "<w:vertAlign w:val=\"\(run.vertical > 0 ? "superscript" : "subscript")\"/>" }
            var segments = "", current = ""
            func flush() { if !current.isEmpty { segments += "<w:t xml:space=\"preserve\">\(xml(current))</w:t>"; current = "" } }
            for char in run.text { if char == "\n" { flush(); segments += "<w:br/>" } else if char == "\t" { flush(); segments += "<w:tab/>" } else { current.append(char) } }; flush()
            var result = "<w:r>\(properties.isEmpty ? "" : "<w:rPr>\(properties)</w:rPr>")\(segments)</w:r>"
            if let link = run.link, ResearchExportMarkdown.safeLink(link) { let id: String; if let old = links.first(where: { $0.1 == link }) { id = old.0 } else { id = "link\(links.count + 1)"; links.append((id, link)) }; result = "<w:hyperlink r:id=\"\(id)\" w:history=\"1\">\(result)</w:hyperlink>" }
            return result
        }
        func paragraph(_ block: ResearchExportBlock, extra: String = "", bookmark: Int? = nil) -> String {
            var properties = extra
            if block.heading > 0 { properties += "<w:pStyle w:val=\"Heading\(min(3, block.heading))\"/><w:keepNext/>" }
            let indent = (block.indent + block.quoteDepth) * 360
            if indent > 0 || block.marker != nil { properties += "<w:ind w:left=\"\(indent + (block.marker == nil ? 0 : 360))\" w:hanging=\"\(block.marker == nil ? 0 : 360)\"/>" }
            if block.quoteDepth > 0 { properties += "<w:pBdr><w:left w:val=\"single\" w:sz=\"12\" w:color=\"AAAAAA\" w:space=\"8\"/></w:pBdr>" }
            if block.kind == "code" { properties += "<w:shd w:fill=\"F3F3F3\"/><w:spacing w:line=\"240\" w:lineRule=\"auto\"/>" }
            let start = bookmark.map { "<w:bookmarkStart w:id=\"\($0)\" w:name=\"section_\($0)\"/>" } ?? "", end = bookmark.map { "<w:bookmarkEnd w:id=\"\($0)\"/>" } ?? ""
            var runs = block.runs; if let marker = block.marker { runs.insert(ResearchExportRun(marker + "\t"), at: 0) }
            return "<w:p><w:pPr>\(properties)</w:pPr>\(start)\(runs.map(runXML).joined())\(end)</w:p>"
        }
        var title = ResearchExportBlock(runs: [ResearchExportRun(document.title, bold: true)])
        title.runs[0].text = document.title
        body += paragraph(title, extra: "<w:pStyle w:val=\"Title\"/><w:jc w:val=\"center\"/><w:spacing w:after=\"720\"/>")
        for (index, section) in document.sections.enumerated() {
            var heading = ResearchExportBlock(runs: [ResearchExportRun(section.title)]); heading.heading = 1; body += paragraph(heading, bookmark: index + 1)
            for block in ResearchExportMarkdown.blocks(section.markdown) {
                if block.kind == "table" {
                    let columns = max(1, block.rows.map(\.count).max() ?? 1), cellWidth = Int(style.contentWidth * 20 / Double(max(1, block.rows.map(\.count).max() ?? 1)))
                    body += "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders>" + ["top", "left", "bottom", "right", "insideH", "insideV"].map { "<w:\($0) w:val=\"single\" w:sz=\"6\" w:color=\"777777\"/>" }.joined() + "</w:tblBorders></w:tblPr><w:tblGrid>" + Array(repeating: "<w:gridCol w:w=\"\(cellWidth)\"/>", count: columns).joined() + "</w:tblGrid>"
                    for (rowIndex, row) in block.rows.enumerated() {
                        body += "<w:tr>" + (rowIndex == 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : "")
                        for column in 0..<columns { var runs = row.indices.contains(column) ? row[column] : []; if rowIndex == 0 { runs = runs.map { var copy = $0; copy.bold = true; return copy } }; let alignment = block.alignments.indices.contains(column) ? block.alignments[column] : "left"
                            body += "<w:tc><w:tcPr><w:tcW w:w=\"\(cellWidth)\" w:type=\"dxa\"/></w:tcPr>" + paragraph(ResearchExportBlock(runs: runs), extra: "<w:jc w:val=\"\(alignment)\"/><w:ind w:firstLine=\"0\"/>") + "</w:tc>"
                        }; body += "</w:tr>"
                    }; body += "</w:tbl>"
                } else if block.kind == "rule" { body += paragraph(block, extra: "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:color=\"AAAAAA\"/></w:pBdr>") }
                else { body += paragraph(block) }
            }
        }
        var heading = ResearchExportBlock(runs: [ResearchExportRun("参考文献")]); heading.heading = 1; body += paragraph(heading)
        for runs in bibliography.richEntries { body += paragraph(ResearchExportBlock(runs: runs), extra: bibliography.hangingIndent ? "<w:ind w:left=\"360\" w:hanging=\"360\"/>" : "<w:ind w:firstLine=\"0\"/>") }
        if !document.warnings.isEmpty { heading.runs = [ResearchExportRun("引用异常")]; body += paragraph(heading); for warning in document.warnings { body += paragraph(ResearchExportBlock(runs: [ResearchExportRun("\(warning.sourceId) · \(warning.state)")])) } }
        if !style.warnings.isEmpty { heading.runs = [ResearchExportRun("导出提示")]; body += paragraph(heading); for warning in style.warnings { body += paragraph(ResearchExportBlock(runs: [ResearchExportRun(warning)])) } }
        body += "<w:sectPr><w:pgSz w:w=\"\(style.widthTwips)\" w:h=\"\(style.heightTwips)\"/><w:pgMar w:top=\"\(Int((style.top * 20).rounded()))\" w:right=\"\(Int((style.right * 20).rounded()))\" w:bottom=\"\(Int((style.bottom * 20).rounded()))\" w:left=\"\(Int((style.left * 20).rounded()))\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr>"
        let documentXML = declaration + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><w:background w:color=\"\(style.backgroundColor)\"/><w:body>\(body)</w:body></w:document>"
        let font = xml(style.docxFont), size = Int((style.fontSize * 2).rounded()), line = Int((style.lineHeight * 240).rounded())
        var styles = declaration + "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"\(font)\" w:hAnsi=\"\(font)\" w:eastAsia=\"\(font)\"/><w:sz w:val=\"\(size)\"/><w:color w:val=\"\(style.color)\"/><w:lang w:val=\"\(xml(document.formatting.locale))\" w:eastAsia=\"\(xml(document.formatting.locale))\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line=\"\(line)\" w:lineRule=\"auto\"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>"
        styles += "<w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:rPr><w:b/><w:sz w:val=\"\(Int(style.titleSize * 2))\"/></w:rPr></w:style>"
        for level in 1...3 { styles += "<w:style w:type=\"paragraph\" w:styleId=\"Heading\(level)\"><w:name w:val=\"heading \(level)\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:outlineLvl w:val=\"\(level - 1)\"/><w:spacing w:before=\"240\" w:after=\"120\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"\(Int(style.headingSizes[level - 1] * 2))\"/></w:rPr></w:style>" }; styles += "</w:styles>"
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; let manifestJSON = String(decoding: try encoder.encode(document.manifest), as: UTF8.self)
        let custom = declaration + "<everplain:research-export xmlns:everplain=\"https://everplain.app/research-export/v1\"><everplain:manifest>\(xml(manifestJSON))</everplain:manifest></everplain:research-export>"
        let relationships = declaration + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"styles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"provenance\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml\" Target=\"../customXml/item1.xml\"/>" + links.map { "<Relationship Id=\"\($0.0)\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"\(xml($0.1))\" TargetMode=\"External\"/>" }.joined() + "</Relationships>"
        let types = declaration + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/><Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/></Types>"
        let rootRels = declaration + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"document\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/><Relationship Id=\"core\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"app\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/></Relationships>"
        let date = ISO8601DateFormatter().string(from: modifiedAt)
        let core = declaration + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>\(xml(document.title))</dc:title><cp:revision>\(document.manifest.documentIdentity.version)</cp:revision><dcterms:modified xsi:type=\"dcterms:W3CDTF\">\(date)</dcterms:modified></cp:coreProperties>"
        let app = declaration + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>Everplain</Application></Properties>"
        return try ResearchExportZIP.archive([("[Content_Types].xml", Data(types.utf8)), ("_rels/.rels", Data(rootRels.utf8)), ("word/document.xml", Data(documentXML.utf8)), ("word/styles.xml", Data(styles.utf8)), ("word/_rels/document.xml.rels", Data(relationships.utf8)), ("docProps/core.xml", Data(core.utf8)), ("docProps/app.xml", Data(app.utf8)), ("customXml/item1.xml", Data(custom.utf8))])
    }
    private static let declaration = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
    public static func xml(_ text: String) -> String { String(String.UnicodeScalarView(text.unicodeScalars.filter { $0.value == 9 || $0.value == 10 || $0.value == 13 || ($0.value >= 32 && $0.value != 0xFFFE && $0.value != 0xFFFF) })).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&apos;") }
}

/// Only exact documented image download routes may use the owner's authenticated API session.
public enum ResearchExportImagePolicy {
    public static func sameOrigin(_ first: URL, _ second: URL) -> Bool {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : url.scheme?.lowercased() == "http" ? 80 : nil) }
        return first.scheme?.lowercased() == second.scheme?.lowercased() && first.host?.lowercased() == second.host?.lowercased() && port(first) == port(second)
    }
    public static func ownerPath(source: String, origin: URL) -> String? {
        guard let url = URL(string: source, relativeTo: origin)?.absoluteURL, sameOrigin(url, origin), url.user == nil, url.password == nil, url.query == nil, !url.path.contains("..") else { return nil }
        let path = url.path
        let pattern = #"^/api/(imports/assets/[A-Za-z0-9_-]+|research-tasks/[A-Za-z0-9_-]+/materials/[A-Za-z0-9_-]+/content)$"#
        return path.range(of: pattern, options: .regularExpression) == nil ? nil : path
    }
}
