#if os(macOS)
import Foundation
import JavaScriptCore
import EverplainCore

/// The same pinned processor and XML styles as the Web. JavaScriptCore has no DOM, network or browser shell.
@MainActor enum ResearchWorkspaceExportCSL {
    private struct Input: Encodable { let items: [[String: JSONValue]]; let style: String; let locale: String; let localeXML: String }
    private struct Output: Decodable { let htmlEntries: [String]; let textEntries: [String]; let hangingIndent: Bool; let entrySpacing: Double; let lineSpacing: Double }
    static func bibliography(for document: ResearchExportDocument) throws -> ResearchExportBibliography {
        let items = document.citations.compactMap(\.csl)
        guard !items.isEmpty else { return ResearchExportBibliography() }
        let style: String
        if let custom = document.formatting.customCsl, !custom.isEmpty { style = custom }
        else {
            guard ["american-sociological-association", "china-national-standard-gb-t-7714-2015-author-date", "chicago-author-date"].contains(document.formatting.cslStyleId) else { throw ResearchExportFailure.bibliography("未找到 CSL 样式：\(document.formatting.cslStyleId)") }
            style = try resource(document.formatting.cslStyleId + ".csl")
        }
        let localeXML = try resource(document.formatting.locale == "zh-CN" ? "locales-zh-CN.xml" : "locales-en-US.xml")
        let input = Input(items: items, style: style, locale: document.formatting.locale, localeXML: localeXML)
        guard let payload = String(data: try JSONEncoder().encode(input), encoding: .utf8), let context = JSContext() else { throw ResearchExportFailure.bibliography("无法建立本机格式处理环境。") }
        var failure: String?
        context.exceptionHandler = { _, value in failure = value?.toString() ?? "CSL 处理器返回异常。" }
        context.evaluateScript("var module = { exports: {} }; var exports = module.exports; var console = { log: function(){}, warn: function(){}, error: function(){} };")
        context.evaluateScript(try resource("citeproc.js"))
        guard failure == nil else { throw ResearchExportFailure.bibliography(failure!) }
        context.evaluateScript(try resource("bibliography.js"))
        guard failure == nil, let function = context.objectForKeyedSubscript("everplainFormatBibliography"), !function.isUndefined else { throw ResearchExportFailure.bibliography(failure ?? "CSL 适配器未载入。") }
        // The user-supplied XML and CSL JSON are arguments, never interpolated into executable source.
        let result = function.call(withArguments: [payload])
        guard failure == nil, let json = result?.toString(), let bytes = json.data(using: .utf8) else { throw ResearchExportFailure.bibliography(failure ?? "CSL 处理器未返回参考文献。") }
        let output = try JSONDecoder().decode(Output.self, from: bytes)
        return ResearchExportBibliography(htmlEntries: output.htmlEntries, textEntries: output.textEntries, hangingIndent: output.hangingIndent, entrySpacing: output.entrySpacing, lineSpacing: output.lineSpacing)
    }
    private static func resource(_ name: String) throws -> String {
        guard let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "ResearchExport") else { throw ResearchExportFailure.missingResource(name) }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
#endif
