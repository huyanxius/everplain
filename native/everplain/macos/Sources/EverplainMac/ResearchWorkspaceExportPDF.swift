#if os(macOS)
import AppKit
import CoreGraphics
import ImageIO
import EverplainCore

/// TextKit/CoreGraphics pagination. No HTML import, hidden web view, or external resource fetching.
@MainActor enum ResearchWorkspaceExportPDF {
    private struct Layout {
        let storage: NSTextStorage
        let manager: NSLayoutManager
        let containers: [NSTextContainer]
        let ranges: [NSRange]
    }
    static func data(document: ResearchExportDocument, bibliography: ResearchExportBibliography, images: [String: NSImage] = [:], imageWarnings: [String] = []) throws -> Data {
        let style = ResearchExportPageStyle(template: document.formatting.templateId, customCSS: document.formatting.customCss)
        let body = NSMutableAttributedString(string: "")
        for section in document.sections {
            body.append(paragraph([ResearchExportRun(section.title, bold: true)], style: style, heading: 2))
            for block in ResearchExportMarkdown.blocks(section.markdown) { append(block, to: body, style: style, images: images) }
        }
        if !document.warnings.isEmpty {
            body.append(paragraph([ResearchExportRun("引用异常", bold: true)], style: style, heading: 2))
            for warning in document.warnings { body.append(paragraph([ResearchExportRun("\(warning.sourceId) · \(warning.state)")], style: style, color: NSColor(calibratedRed: 0.44, green: 0.11, blue: 0.11, alpha: 1))) }
        }
        if !(style.warnings + imageWarnings).isEmpty {
            body.append(paragraph([ResearchExportRun("导出提示", bold: true)], style: style, heading: 2))
            for warning in style.warnings + imageWarnings { body.append(paragraph([ResearchExportRun(warning)], style: style)) }
        }
        let references = NSMutableAttributedString(string: "")
        references.append(paragraph([ResearchExportRun("参考文献", bold: true)], style: style, heading: 2))
        for entry in bibliography.richEntries {
            let value = paragraph(entry, style: style, bibliography: bibliography)
            references.append(value)
        }
        let bodyLayout = try paginate(body, style: style), referenceLayout = try paginate(references, style: style)
        let output = NSMutableData()
        guard let consumer = CGDataConsumer(data: output as CFMutableData) else { throw ResearchExportFailure.rendering("无法建立 PDF 数据流。") }
        var bounds = CGRect(x: 0, y: 0, width: style.width, height: style.height)
        let metadata = [kCGPDFContextTitle as String: document.title, kCGPDFContextCreator as String: "Everplain · TextKit · citeproc-js", kCGPDFContextSubject as String: "\(document.manifest.documentIdentity.documentId) · v\(document.manifest.documentIdentity.version)"] as CFDictionary
        guard let context = CGContext(consumer: consumer, mediaBox: &bounds, metadata) else { throw ResearchExportFailure.rendering("无法建立 PDF 页面。") }
        var pageNumber = 1
        context.beginPDFPage(nil)
        withPage(context, style: style) {
            let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center; paragraph.lineBreakMode = .byWordWrapping
            let font = font(style, size: style.titleSize, bold: true, headingLevel: 1)
            let title = NSAttributedString(string: document.title, attributes: [.font: font, .foregroundColor: color(style.color), .paragraphStyle: paragraph])
            let maxSize = CGSize(width: style.contentWidth, height: style.contentHeight)
            let size = title.boundingRect(with: maxSize, options: [.usesLineFragmentOrigin, .usesFontLeading]).size
            title.draw(in: CGRect(x: style.left, y: style.top + max(0, (style.contentHeight - size.height) / 2), width: style.contentWidth, height: min(style.contentHeight, size.height + 4)))
            footer(pageNumber, context: context, style: style)
        }
        context.endPDFPage(); pageNumber += 1
        for layout in [bodyLayout, referenceLayout] {
            for (index, container) in layout.containers.enumerated() {
                context.beginPDFPage(nil)
                withPage(context, style: style) {
                    layout.manager.drawBackground(forGlyphRange: layout.ranges[index], at: CGPoint(x: style.left, y: style.top))
                    layout.manager.drawGlyphs(forGlyphRange: layout.ranges[index], at: CGPoint(x: style.left, y: style.top))
                    footer(pageNumber, context: context, style: style)
                }
                addLinks(layout: layout, container: container, glyphs: layout.ranges[index], context: context, style: style)
                context.endPDFPage(); pageNumber += 1
            }
        }
        context.closePDF(); return output as Data
    }
    static func loadImages(document: ResearchExportDocument, api: APIClient) async throws -> ([String: NSImage], [String]) {
        let sources = Set(document.sections.flatMap { ResearchExportMarkdown.blocks($0.markdown).compactMap(\.imageSource) }).sorted()
        guard !sources.isEmpty else { return ([:], []) }
        let configuration = URLSessionConfiguration.ephemeral; configuration.httpShouldSetCookies = false; configuration.urlCache = nil; configuration.timeoutIntervalForRequest = 15
        let delegate = ResearchExportImageSessionDelegate(), session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var images: [String: NSImage] = [:], warnings: [String] = [], decodedPixels = 0
        for (index, source) in sources.enumerated() {
            if Task.isCancelled { break }
            do {
                guard index < 32 else { throw ResearchExportFailure.rendering("图像数量超过 32 张。") }
                let data: Data
                if let path = ResearchExportImagePolicy.ownerPath(source: source, origin: api.endpoint.origin) {
                    let downloaded = try await api.download(path, maximumBytes: 20_000_000)
                    guard downloaded.mimeType.hasPrefix("image/"), downloaded.data.count <= 20_000_000 else { throw ResearchExportFailure.rendering("私有图像不可用或超过大小限制。") }; data = downloaded.data
                } else if source.hasPrefix("data:image/"), let comma = source.firstIndex(of: ","), source[..<comma].hasSuffix(";base64"), source.utf8.count <= 28_000_000, let decoded = Data(base64Encoded: String(source[source.index(after: comma)...])) { data = decoded }
                else {
                    guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil else { throw ResearchExportFailure.rendering("图像地址不受支持。") }
                    var request = URLRequest(url: url); request.setValue("image/*", forHTTPHeaderField: "Accept")
                    let (bytes, response) = try await session.bytes(for: request)
                    defer { bytes.task.cancel() }
                    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), response.mimeType?.hasPrefix("image/") == true, response.expectedContentLength <= 20_000_000 else { throw ResearchExportFailure.rendering("图像来源不可用或超过 20 MB。") }
                    var downloaded = Data(); for try await byte in bytes { try Task.checkCancellation(); guard downloaded.count < 20_000_000 else { throw ResearchExportFailure.rendering("图像超过 20 MB。") }; downloaded.append(byte) }; data = downloaded
                }
                guard data.count <= 20_000_000, let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 4096, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { throw ResearchExportFailure.rendering("图像格式无法解码。") }
                guard image.width * image.height <= 64_000_000 - decodedPixels else { throw ResearchExportFailure.rendering("图像解码总量超过限制。") }; decodedPixels += image.width * image.height
                images[sources[index]] = NSImage(cgImage: image, size: NSSize(width: CGFloat(image.width), height: CGFloat(image.height)))
            } catch ClientError.authenticationRequired { throw ClientError.authenticationRequired } catch is CancellationError { throw CancellationError() } catch { warnings.append("第 \(index + 1) 张图像未能嵌入（可能已失效、无权读取或超出限制）；已保留图像说明与来源。") }
        }
        return (images, warnings)
    }
    private static func paginate(_ text: NSAttributedString, style: ResearchExportPageStyle) throws -> Layout {
        let storage = NSTextStorage(attributedString: text), manager = NSLayoutManager(); storage.addLayoutManager(manager); manager.allowsNonContiguousLayout = false
        var containers: [NSTextContainer] = [], ranges: [NSRange] = [], end = 0
        guard storage.length > 0 else { return Layout(storage: storage, manager: manager, containers: [], ranges: []) }
        while end < manager.numberOfGlyphs {
            let container = NSTextContainer(size: CGSize(width: style.contentWidth, height: style.contentHeight)); container.lineFragmentPadding = 0; manager.addTextContainer(container); manager.ensureLayout(for: container)
            let range = manager.glyphRange(for: container)
            guard range.length > 0, NSMaxRange(range) > end, containers.count < 10_000 else { throw ResearchExportFailure.rendering("段落或表格超出可打印区域，请调整字号或页边距。") }
            containers.append(container); ranges.append(range); end = NSMaxRange(range)
        }
        return Layout(storage: storage, manager: manager, containers: containers, ranges: ranges)
    }
    private static func withPage(_ context: CGContext, style: ResearchExportPageStyle, draw: () -> Void) {
        context.saveGState(); context.setFillColor(color(style.backgroundColor).cgColor); context.fill(CGRect(x: 0, y: 0, width: style.width, height: style.height)); context.translateBy(x: 0, y: style.height); context.scaleBy(x: 1, y: -1)
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        draw(); NSGraphicsContext.restoreGraphicsState(); context.restoreGState()
    }
    private static func footer(_ number: Int, context: CGContext, style: ResearchExportPageStyle) {
        let text = NSAttributedString(string: String(number), attributes: [.font: font(style, size: 10), .foregroundColor: NSColor(calibratedWhite: 0.25, alpha: 1)])
        text.draw(at: CGPoint(x: (style.width - text.size().width) / 2, y: style.height - style.bottom / 2 - text.size().height / 2))
    }
    private static func addLinks(layout: Layout, container: NSTextContainer, glyphs: NSRange, context: CGContext, style: ResearchExportPageStyle) {
        let characters = layout.manager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        layout.storage.enumerateAttribute(.link, in: characters) { value, range, _ in
            guard let url = value as? URL else { return }
            let linkGlyphs = NSIntersectionRange(layout.manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil), glyphs)
            layout.manager.enumerateLineFragments(forGlyphRange: linkGlyphs) { _, _, lineContainer, lineRange, _ in
                guard lineContainer === container else { return }; let intersection = NSIntersectionRange(lineRange, linkGlyphs); guard intersection.length > 0 else { return }
                let rect = layout.manager.boundingRect(forGlyphRange: intersection, in: container)
                let pdfRect = CGRect(x: style.left + rect.minX, y: style.height - style.top - rect.maxY, width: rect.width, height: rect.height)
                context.setURL(url as CFURL, for: pdfRect)
            }
        }
    }
    private static func append(_ block: ResearchExportBlock, to output: NSMutableAttributedString, style: ResearchExportPageStyle, images: [String: NSImage]) {
        if block.kind == "image", let source = block.imageSource, let image = images[source], image.size.width > 0, image.size.height > 0 {
            let scale = min(1, min(style.contentWidth / image.size.width, (style.contentHeight - 32) / image.size.height))
            let attachment = NSTextAttachment(); attachment.image = image; attachment.bounds = CGRect(x: 0, y: 0, width: image.size.width * scale, height: image.size.height * scale)
            let attributed = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
            let layout = NSMutableParagraphStyle(); layout.alignment = .center; layout.paragraphSpacing = 8
            attributed.addAttribute(.paragraphStyle, value: layout, range: NSRange(location: 0, length: attributed.length)); attributed.append(NSAttributedString(string: "\n", attributes: [.paragraphStyle: layout])); output.append(attributed); return
        }
        if block.kind == "table" {
            let table = NSTextTable(); table.numberOfColumns = max(1, block.rows.map(\.count).max() ?? 1); table.layoutAlgorithm = .fixedLayoutAlgorithm; table.collapsesBorders = true
            for (rowIndex, row) in block.rows.enumerated() {
                for column in 0..<table.numberOfColumns {
                    let cell = NSTextTableBlock(table: table, startingRow: rowIndex, rowSpan: 1, startingColumn: column, columnSpan: 1)
                    cell.setWidth(1, type: .absoluteValueType, for: .border); cell.setBorderColor(NSColor(calibratedWhite: 0.47, alpha: 1)); cell.setWidth(4, type: .absoluteValueType, for: .padding)
                    cell.setValue(CGFloat(style.contentWidth / Double(table.numberOfColumns)), type: .absoluteValueType, for: .width)
                    if rowIndex == 0 { cell.backgroundColor = NSColor(calibratedWhite: 0.96, alpha: 1) }
                    var runs = row.indices.contains(column) ? row[column] : []
                    if rowIndex == 0 { runs = runs.map { var value = $0; value.bold = true; return value } }
                    let text = paragraph(runs, style: style, alignment: block.alignments.indices.contains(column) ? block.alignments[column] : "left", tableCell: cell)
                    output.append(text)
                }
            }
            output.append(paragraph([], style: style)); return
        }
        if block.kind == "rule" { output.append(paragraph([ResearchExportRun("────────────────────────")], style: style)); return }
        var runs = block.runs
        if let marker = block.marker { runs.insert(ResearchExportRun(marker + "\t"), at: 0) }
        output.append(paragraph(runs, style: style, heading: block.heading, indent: block.indent, quote: block.quoteDepth, marker: block.marker != nil, code: block.kind == "code"))
    }
    private static func paragraph(_ runs: [ResearchExportRun], style: ResearchExportPageStyle, heading: Int = 0, indent: Int = 0, quote: Int = 0, marker: Bool = false, code: Bool = false, alignment: String? = nil, color textColor: NSColor? = nil, tableCell: NSTextTableBlock? = nil, bibliography: ResearchExportBibliography? = nil) -> NSAttributedString {
        let result = NSMutableAttributedString(string: ""), paragraph = NSMutableParagraphStyle()
        let fontSize = heading > 0 ? style.headingSizes[min(2, heading - 1)] : style.fontSize
        paragraph.alignment = align(alignment ?? (heading > 0 || code || marker || bibliography != nil ? "left" : style.alignment)); paragraph.lineBreakMode = .byWordWrapping
        let multiplier = code ? 1.2 : max(style.lineHeight, bibliography?.lineSpacing ?? 0)
        paragraph.minimumLineHeight = fontSize * multiplier; paragraph.maximumLineHeight = fontSize * multiplier
        paragraph.headIndent = Double(indent + quote) * 18 + (marker ? 18 : 0); paragraph.firstLineHeadIndent = paragraph.headIndent + (heading == 0 && !marker && !code && tableCell == nil && bibliography == nil ? style.firstLineIndent : 0)
        if marker { paragraph.firstLineHeadIndent = Double(indent + quote) * 18; paragraph.tabStops = [NSTextTab(textAlignment: .left, location: paragraph.headIndent, options: [:])] }
        if heading > 0 { paragraph.paragraphSpacingBefore = fontSize * 0.83; paragraph.paragraphSpacing = fontSize * 0.83 }
        if let bibliography { paragraph.paragraphSpacing = bibliography.entrySpacing * fontSize; if bibliography.hangingIndent { paragraph.firstLineHeadIndent = 0; paragraph.headIndent = 18 } }
        if let tableCell { paragraph.textBlocks = [tableCell]; paragraph.headIndent = 0; paragraph.firstLineHeadIndent = 0 }
        for run in runs {
            let face = run.code || code ? NSFont.monospacedSystemFont(ofSize: fontSize, weight: run.bold ? .bold : .regular) : font(style, size: fontSize, bold: run.bold || (heading > 0 && heading < 3), italic: run.italic || (heading >= 3 && style.isASA), headingLevel: heading)
            var attributes: [NSAttributedString.Key: Any] = [.font: face, .paragraphStyle: paragraph, .foregroundColor: textColor ?? color(style.color)]
            if run.strike { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if run.code || code { attributes[.backgroundColor] = NSColor(calibratedWhite: 0.96, alpha: 1) }
            if run.vertical != 0 { attributes[.baselineOffset] = Double(run.vertical) * fontSize * 0.3; attributes[.font] = NSFontManager.shared.convert(face, toSize: fontSize * 0.75) }
            if let link = run.link, let url = URL(string: link), ResearchExportMarkdown.safeLink(link) { attributes[.link] = url; attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            result.append(NSAttributedString(string: run.text, attributes: attributes))
        }
        result.append(NSAttributedString(string: "\n", attributes: [.font: font(style, size: fontSize), .paragraphStyle: paragraph, .foregroundColor: textColor ?? color(style.color)])); return result
    }
    private static func font(_ style: ResearchExportPageStyle, size: Double, bold: Bool = false, italic: Bool = false, headingLevel: Int = 0) -> NSFont {
        var face = NSFont(name: headingLevel == 1 ? style.titleFont : style.font, size: size) ?? NSFont(name: "Times New Roman", size: size) ?? NSFont.systemFont(ofSize: size)
        if bold { face = NSFontManager.shared.convert(face, toHaveTrait: .boldFontMask) }; if italic { face = NSFontManager.shared.convert(face, toHaveTrait: .italicFontMask) }; return face
    }
    private static func color(_ hex: String) -> NSColor { let value = UInt32(hex, radix: 16) ?? 0x171717; return NSColor(calibratedRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1) }
    private static func align(_ value: String) -> NSTextAlignment { switch value { case "center": return .center; case "right": return .right; case "justify": return .justified; default: return .left } }
}
private final class ResearchExportImageSessionDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let previous = task.currentRequest?.url, let next = request.url, ResearchExportImagePolicy.sameOrigin(next, previous), next.user == nil, next.password == nil else { completionHandler(nil); return }; completionHandler(request)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust { completionHandler(.performDefaultHandling, nil) } else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }
}
#endif
