import XCTest
@testable import EverplainCore

final class HomePileGeometryTests: XCTestCase {
    func testActualWebDeckClosedAndExpandedObservations() {
        // Read-only live DOM observation, 2026-10-04: 398-wide closed pile,
        // three source document layers plus cover. No user content in fixture.
        let closed = (0..<3).map { HomePileGeometry.card(kind:.deck,index:$0,hasCover:true,width:398,expanded:false) }
        XCTAssertEqual(closed.map(\.width),[354,354,354])
        XCTAssertEqual(closed.map(\.height),[138,138,138])
        XCTAssertEqual(closed.map(\.x),[6,12,12])
        XCTAssertEqual(closed.map(\.y),[6,12,12])
        XCTAssertEqual(closed.map(\.opacity),[1,1,0])
        XCTAssertEqual(closed.map(\.delay),[0,0.055,0.11])
        XCTAssertEqual(HomePileGeometry.containerHeight(kind:.deck,count:3,expanded:false),152)
        // Opening adds the Web scrollbar, so its column becomes 390.5 wide.
        let opened = (0..<3).map { HomePileGeometry.card(kind:.deck,index:$0,hasCover:true,width:390.5,expanded:true) }
        XCTAssertEqual(opened.map(\.width),[390.5,390.5,390.5])
        XCTAssertEqual(opened.map(\.height),[112,112,112])
        XCTAssertEqual(opened.map(\.y),[0,124,248])
        XCTAssertEqual(opened.map(\.opacity),[1,1,1])
        XCTAssertEqual(HomePileGeometry.containerHeight(kind:.deck,count:3,expanded:true),360)
    }
    func testResearchSourcePileKeepsEveryCardAndOrderOnCollapse() {
        let closed = (0..<3).map { HomePileGeometry.card(kind:.hand,index:$0,hasCover:false,width:400,expanded:false) }
        XCTAssertEqual(closed.map(\.x),[0,22,44]); XCTAssertEqual(closed.map(\.y),[0,10,20])
        XCTAssertEqual(closed.map(\.rotation),[0,2.5,5]); XCTAssertEqual(closed.map(\.opacity),[1,1,1])
        XCTAssertEqual(HomePileGeometry.containerHeight(kind:.hand,count:3,expanded:true),612)
        let expanded = HomePileGeometry.card(kind:.hand,index:2,hasCover:false,width:400,expanded:true)
        XCTAssertEqual(expanded.y,416); XCTAssertEqual(expanded.height,196); XCTAssertEqual(expanded.width,400)
        XCTAssertEqual(HomePileGeometry.containerHeight(kind:.deck,count:0,expanded:true),0)
    }
}
