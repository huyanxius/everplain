import XCTest
@testable import EverplainCore

final class CompanionMotionTests: XCTestCase {
    private func asset() throws -> CompanionAsset {
        let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let url = package.appendingPathComponent("Sources/EverplainMac/Resources/Companion/companion.json")
        return try JSONDecoder().decode(CompanionAsset.self, from: Data(contentsOf: url))
    }
    func testExactWebAssetPreservesAllLayersColorsAndCurves() throws {
        let asset = try asset()
        XCTAssertEqual(asset.sourceSha256, "456b978fa3edaf1e2e8d4f074649411907e46b641fc726dddded36d1ac3d6641")
        XCTAssertEqual(asset.cssSha256, "0b627c839bbc52673527a71a3f6dd9d255b783fb6b04ee1bf95abf94ffd99228")
        XCTAssertEqual(asset.viewBox, [0,-10,220,224]); XCTAssertEqual(asset.palette.count, 20)
        XCTAssertEqual(asset.palette["--cp-hair"], "#e6d8c5"); XCTAssertEqual(asset.defs.count, 4)
        var count = 0, paths = 0, classes = Set<String>()
        func visit(_ node: CompanionNode) throws {
            count += 1; classes.formUnion(node.classes)
            if let bounds = node.bounds { XCTAssertEqual(bounds.count, 4); XCTAssertTrue(bounds.allSatisfy(\.isFinite)) }
            if let path = node.attributes["d"] { paths += 1; XCTAssertFalse(try CompanionVectorPath.parse(path).isEmpty) }
            for child in node.children { try visit(child) }
        }
        try visit(asset.root)
        XCTAssertEqual(count, 69); XCTAssertGreaterThan(paths, 25)
        XCTAssertTrue(classes.isSuperset(of:["cp-bob","cp-eyes","cp-happy","cp-petal","cp-ribbon-tail","cp-ahoge","cp-hand"]))
    }
    func testRelativeStarAndImplicitLinePreserveOriginalCoordinates() throws {
        XCTAssertEqual(try CompanionVectorPath.parse("M10 20 l1.6 4 4 1.6 -4 1.6 Z"), [.move(10,20),.line(11.6,24),.line(15.6,25.6),.line(11.6,27.200000000000003),.close])
        XCTAssertEqual(try CompanionVectorPath.parse("M1 2 3 4 Q5 6 7 8"), [.move(1,2),.line(3,4),.quad(5,6,7,8)])
        XCTAssertThrowsError(try CompanionVectorPath.parse("M0 0 H20"))
    }
    func testEntranceDelayOvershootExitAndReducedMotion() {
        XCTAssertEqual(CompanionMotion.entrance(age:0.2,active:true,reduced:false),0.7,accuracy:0.00001)
        XCTAssertLessThan(CompanionMotion.entrance(age:1,active:true,reduced:false),0)
        XCTAssertEqual(CompanionMotion.entrance(age:1.3,active:true,reduced:false),0,accuracy:0.00001)
        XCTAssertEqual(CompanionMotion.entrance(age:0.45,active:false,reduced:false),1.05,accuracy:0.00001)
        XCTAssertEqual(CompanionMotion.entrance(age:0,active:true,reduced:true),0)
    }
    func testBobUsesWinningCssPivotAndSingleHop() {
        let breathe = CompanionMotion.pose(classes:["cp-bob"],elapsed:1.9,bobElapsed:1.9,happyAge:nil,reduced:false)
        XCTAssertEqual(breathe.anchorY,0.95); XCTAssertEqual(breathe.y,-1.5,accuracy:0.00001)
        let hop = CompanionMotion.pose(classes:["cp-bob"],elapsed:10,bobElapsed:0,happyAge:0.9*0.46,reduced:false)
        XCTAssertEqual(hop.y,-6,accuracy:0.00001); XCTAssertEqual(hop.scaleY,1.02,accuracy:0.00001)
        let settled = CompanionMotion.pose(classes:["cp-bob"],elapsed:11,bobElapsed:0,happyAge:1.1,reduced:false)
        XCTAssertEqual(settled.y,0); XCTAssertEqual(settled.scaleX,1)
        XCTAssertEqual(CompanionMotion.pose(classes:["cp-rest"],elapsed:5,bobElapsed:5,happyAge:nil,reduced:false).rotation,0)
    }
    func testBlinkAndStaggeredHairMatchCssKeys() {
        let blink = CompanionMotion.pose(classes:["cp-eyes"],elapsed:5.2*0.94,bobElapsed:0,happyAge:nil,reduced:false)
        XCTAssertEqual(blink.scaleY,0.08,accuracy:0.00001)
        let b = CompanionMotion.pose(classes:["cp-strand","cp-strand--b"],elapsed:1.2,bobElapsed:0,happyAge:nil,reduced:false)
        XCTAssertEqual(b.rotation,1.8,accuracy:0.00001)
        XCTAssertEqual(CompanionMotion.pose(classes:["cp-ahoge"],elapsed:1.04,bobElapsed:0,happyAge:nil,reduced:true),CompanionPose())
    }
    func testPointerIsClampedSmoothedAndBecomesIdleAfterFourSeconds() {
        var gaze = CompanionGaze()
        gaze.observe(x:10000,y:-10000,width:1000,height:600,now:1)
        gaze.tick(now:1.01,reduced:false)
        XCTAssertEqual(gaze.turn,0.264,accuracy:0.00001); XCTAssertEqual(gaze.nod,-0.08,accuracy:0.00001)
        let previous = gaze.turn
        gaze.tick(now:5.1,reduced:false)
        let target = sin(5.1/2.3)*0.7 + sin(5.1/0.9)*0.12
        XCTAssertEqual(gaze.turn,previous+(target-previous)*0.08,accuracy:0.00001)
        gaze.tick(now:6,reduced:true); XCTAssertEqual(gaze.turn,0.25); XCTAssertEqual(gaze.nod,0)
    }
}
