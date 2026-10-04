import XCTest
@testable import EverplainCore

final class ComposerGeometryTests: XCTestCase {
    func testDesktopHomeColumnDoesNotTriggerMobileGrid() {
        let value = ComposerGeometry.make(width:398,originX:280,originY:320,editorHeight:62,idealModelWidth:140,viewportWidth:1180,research:false,multiline:false)
        XCTAssertEqual(value.height,62)
        XCTAssertEqual(value.tools.y,333); XCTAssertEqual(value.model.y,333)
        XCTAssertEqual(value.input.width,162)
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
