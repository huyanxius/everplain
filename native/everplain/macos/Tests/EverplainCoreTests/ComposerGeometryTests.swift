import XCTest
@testable import EverplainCore

final class ComposerGeometryTests: XCTestCase {
    func testDesktopHomeColumnDoesNotTriggerMobileGrid() {
        // Actual cloud Web DOM, 2026-10-04: form x280 / width398 / padding12+10.
        let value = ComposerGeometry.make(width:376,originX:292,originY:328.546875,editorHeight:62,idealModelWidth:134.9375,viewportWidth:1180,research:false,multiline:false)
        XCTAssertEqual(value.height,62)
        XCTAssertEqual(value.tools.y,341.546875); XCTAssertEqual(value.model.y,341.546875)
        XCTAssertEqual(value.input.x,336); XCTAssertEqual(value.input.width,145.0625)
    }
    func testNarrowGridKeepsToolsInsideNonzeroLayoutOrigin() {
        let value = ComposerGeometry.make(width:330,originX:28,originY:300,editorHeight:62,idealModelWidth:140,viewportWidth:400,research:false,multiline:true)
        XCTAssertEqual(value.height,106); XCTAssertEqual(value.tools.y,326)
        XCTAssertEqual(value.model.y,370); XCTAssertEqual(value.send.y,370)
        XCTAssertEqual(value.input.x,72); XCTAssertEqual(value.input.width,286)
    }
    func testEmptyWrappedPlaceholderKeepsControlsCentered() {
        let value = ComposerGeometry.make(width:330,originY:300,editorHeight:62,idealModelWidth:140,viewportWidth:400,research:false,multiline:false)
        XCTAssertEqual(value.tools.y,313)
        XCTAssertEqual(value.model.y,370)
    }
    func testResearchAlwaysHasItsOwnToolbarRow() {
        let value = ComposerGeometry.make(width:600,originY:200,editorHeight:52,idealModelWidth:140,viewportWidth:1200,research:true,multiline:false)
        XCTAssertEqual(value.height,100); XCTAssertEqual(value.tools.y,264)
        XCTAssertEqual(value.input.x,8); XCTAssertEqual(value.input.width,584)
        XCTAssertEqual(value.model.y,value.tools.y); XCTAssertEqual(value.send.y,value.tools.y)
    }
}
