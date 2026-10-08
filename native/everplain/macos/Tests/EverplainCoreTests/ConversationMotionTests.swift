import XCTest
@testable import EverplainCore

final class ConversationMotionTests: XCTestCase {
    func testNetworkCompletionDrainsBacklogAndFinishesLight() {
        var pacer = ConversationStreamPacer()
        let answer = String(repeating: "正在逐字回答。", count: 10)
        pacer.update(answer: answer, streaming: true, reducedMotion: false)
        XCTAssertEqual(pacer.visible, "")
        pacer.tick(now: 0.048)
        XCTAssertFalse(pacer.visible.isEmpty)
        XCTAssertNotEqual(pacer.visible, answer)
        pacer.update(answer: answer, streaming: false, reducedMotion: false)
        var now = 0.048
        while pacer.visible != answer { now += 0.048; pacer.tick(now: now) }
        XCTAssertFalse(pacer.revealedAt.isEmpty)
        pacer.tick(now: now + 1.099)
        XCTAssertFalse(pacer.revealedAt.isEmpty)
        pacer.tick(now: now + 1.101)
        XCTAssertEqual(pacer.revealedAt, [])
        XCTAssertFalse(pacer.needsTicks)
    }

    func testPacingNeverExposesHalfASurrogatePair() {
        var pacer = ConversationStreamPacer()
        let answer = "a😀b𐐷c🧑🏽‍💻"
        pacer.update(answer: answer, streaming: true, reducedMotion: false)
        var now = 0.0
        while pacer.visible != answer {
            now += 0.048; pacer.tick(now: now)
            XCTAssertFalse(pacer.visible.contains("�"))
            XCTAssertTrue(answer.utf16.starts(with: pacer.visible.utf16))
            XCTAssertEqual(pacer.revealedAt.count, pacer.visible.utf16.count)
        }
    }

    func testHistoryAndReducedMotionAreImmediateAndReplacementDoesNotReplay() {
        var pacer = ConversationStreamPacer()
        pacer.update(answer: "历史回答", streaming: false, reducedMotion: false)
        XCTAssertEqual(pacer.visible, "历史回答")
        XCTAssertFalse(pacer.needsTicks)
        pacer.update(answer: "新回答", streaming: true, reducedMotion: false)
        XCTAssertEqual(pacer.visible, "新回答")
        pacer.update(answer: "新回答继续", streaming: true, reducedMotion: true)
        XCTAssertEqual(pacer.visible, "新回答继续")
        XCTAssertEqual(pacer.revealedAt, [])
    }

    func testSpringHasSourceBackedOvershootAndVelocityStretch() {
        XCTAssertEqual(ConversationMotion.spring(0), 0, accuracy: 0.000001)
        XCTAssertGreaterThan(ConversationMotion.spring(0.49), 1)
        let stretch = ConversationMotion.flightStretch(0.15)
        XCTAssertGreaterThan(stretch.x, 1)
        XCTAssertLessThan(stretch.y, 1)
        XCTAssertEqual(ConversationMotion.ease(1), 1, accuracy: 0.0001)
    }

    func testNetworkPauseStopsDisplayClockWithoutLosingSourceAges() {
        var pacer = ConversationStreamPacer()
        pacer.update(answer: "首字", streaming: true, reducedMotion: false)
        pacer.tick(now: 0.048)
        pacer.tick(now: 1.2)
        XCTAssertFalse(pacer.needsTicks)
        XCTAssertEqual(pacer.visible, "首字")
        let originalAges = pacer.revealedAt
        pacer.update(answer: "首字继续", streaming: true, reducedMotion: false)
        XCTAssertTrue(pacer.needsTicks)
        pacer.tick(now: 2)
        XCTAssertEqual(Array(pacer.revealedAt.prefix(2)), originalAges)
        pacer.tick(now: 3.2)
        pacer.update(answer: "首字继续", streaming: false, reducedMotion: false)
        XCTAssertFalse(pacer.needsTicks)
        XCTAssertTrue(pacer.revealedAt.isEmpty)
    }
}
