import XCTest
@testable import EverplainCore

final class MarkdownLayoutTests: XCTestCase {
    func testGFMTablePreservesEscapedPipesAlignmentAndInlineMarkup() {
        let blocks = NativeMarkdownLayout.parse("| **名称** | 说明 |\n| :--- | ---: |\n| a\\|b | ~~旧~~ |")
        XCTAssertEqual(blocks.count, 1); XCTAssertEqual(blocks[0].kind, "table")
        XCTAssertEqual(blocks[0].rows.count, 2)
        XCTAssertEqual(blocks[0].rows[0][0].text, "**名称**")
        XCTAssertEqual(blocks[0].rows[1][0].text, "a\\|b")
        XCTAssertEqual(blocks[0].rows[0][1].alignment, "right")
    }
    func testNestedListsTaskCheckboxesAndBlockQuotesAreStructural() {
        let blocks = NativeMarkdownLayout.parse("3. 第三项\n4. 第四项\n   - 子项\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n> 第二行")
        XCTAssertEqual(blocks.prefix(2).compactMap(\.marker), ["3.", "4."])
        XCTAssertEqual(blocks.first(where: { $0.text == "子项" })?.indent, 1)
        XCTAssertEqual(blocks.first(where: { $0.text == "完成" })?.marker, "☑")
        XCTAssertEqual(blocks.first(where: { $0.text == "待办" })?.marker, "☐")
        XCTAssertEqual(blocks.last?.quoteDepth, 1); XCTAssertEqual(blocks.last?.text, "引用\n第二行")
    }
    func testSourcePositionsConvertUTF8ColumnsToOriginalUTF16Ages() {
        let source = "# 标题😀\n\n- 中文 **强调**\n  下一行𐐷\n\n> 摘录 [citation_id:x]"
        let units = Array(source.utf16)
        let blocks = NativeMarkdownLayout.parse(source)
        XCTAssertEqual(blocks[0].text, "标题😀"); XCTAssertEqual(blocks[0].offset, 2)
        for block in blocks {
            XCTAssertEqual(block.text.utf16.count, block.sourceOffsets.count)
            for (unit, offset) in zip(block.text.utf16, block.sourceOffsets) {
                XCTAssertTrue(units.indices.contains(offset))
                if units.indices.contains(offset) { XCTAssertEqual(unit, units[offset]) }
            }
        }
    }
    func testCodeRulesAndImageAreNotMisparsedAsParagraphText() {
        let blocks = NativeMarkdownLayout.parse("```swift\nlet value = \"[citation_id:x]\"\n```\n\n---\n\n![示意图](https://example.com/image.png)")
        XCTAssertEqual(blocks.map(\.kind), ["code", "rule", "image"])
        XCTAssertEqual(blocks[0].language, "swift")
        XCTAssertEqual(blocks[0].text, "let value = \"[citation_id:x]\"")
        XCTAssertEqual(blocks[2].imageSource, "https://example.com/image.png")
        XCTAssertEqual(blocks[2].text, "示意图")
    }
}
