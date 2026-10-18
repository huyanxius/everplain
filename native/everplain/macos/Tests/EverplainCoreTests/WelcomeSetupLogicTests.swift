import XCTest
@testable import EverplainCore

/// Synthetic fixtures only; no production requests or user profile data.
final class WelcomeSetupLogicTests: XCTestCase {
    private func profile(step: Int = 0, completed: Bool = false, version: Int = 7) -> AgentProfileResponse {
        .init(avatarId: "cheng", color: "#5d8fe6", greeting: "Synthetic greeting", name: "Everplain", questionnaire: .init(additional: "Synthetic note", goals: ["辅助写作"], industry: "Synthetic field", interests: ["合成主题"], occupation: "研究者"), setupCompleted: completed, setupStep: step, soulText: "Synthetic soul", speakingStyle: "clear", version: version)
    }
    private func batch(_ id: String, total: Int, finished: Int, failed: Int = 0, status: String = "completed") -> ImportBatchResponse {
        .init(createdAt: "2026-01-01T00:00:00Z", duplicates: 0, failed: failed, finished: finished, id: id, imported: finished - failed, items: [], libraryId: "synthetic", sourceType: "chrome", status: status, total: total)
    }
    func testResumeClampsUnfinishedAndReopensCompletedAtImport() {
        XCTAssertEqual(WelcomeSetupLogic.initialStep(profile(step: -1)), 0)
        XCTAssertEqual(WelcomeSetupLogic.initialStep(profile(step: 2)), 2)
        XCTAssertEqual(WelcomeSetupLogic.initialStep(profile(step: 4)), 3)
        XCTAssertEqual(WelcomeSetupLogic.initialStep(profile(step: 4, completed: true)), 0)
    }
    func testHydrationRetainsSurveyAndResolvesUnknownDisplayChoices() {
        var value = profile(); value.avatarId = "unknown"; value.speakingStyle = "unknown"
        let draft = WelcomeSetupDraft(profile: value)
        XCTAssertEqual(draft.name, ""); XCTAssertEqual(draft.avatar, "cheng"); XCTAssertEqual(draft.style, "clear")
        XCTAssertEqual(draft.industry, "Synthetic field"); XCTAssertEqual(draft.interests, "合成主题")
        XCTAssertEqual(draft.goals, ["辅助写作"]); XCTAssertEqual(draft.additional, "Synthetic note")
    }
    func testIdentityPatchUsesExactCASShapeAndDoesNotWriteQuestionnaireOrSoul() throws {
        let value = profile(step: 1)
        var draft = WelcomeSetupDraft(profile: value)
        draft.name = "  小叶  "; draft.avatar = "you"; draft.color = "#eeb146"; draft.style = "warm"
        let update = try WelcomeSetupLogic.update(profile: value, draft: draft, step: 1, next: 2, skip: false)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), Set(["name", "avatar_id", "color", "speaking_style", "expected_version", "setup_step", "setup_completed"]))
        XCTAssertEqual(update.name, "小叶"); XCTAssertEqual(update.expectedVersion, 7)
        XCTAssertEqual(update.setupStep, 2); XCTAssertEqual(update.setupCompleted, false)
        XCTAssertNil(update.questionnaire); XCTAssertNil(update.soulText)
    }
    func testBlankIdentityUsesEverplain() throws {
        let update = try WelcomeSetupLogic.update(profile: profile(), draft: .init(), step: 1, next: 2, skip: false)
        XCTAssertEqual(update.name, "Everplain")
    }
    func testSkipAndBackNeverSaveUnsavedFieldsEvenWhenInputsAreInvalid() throws {
        var draft = WelcomeSetupDraft(); draft.name = String(repeating: "x", count: 41); draft.additional = String(repeating: "x", count: 1001)
        for (step, next) in [(1, 2), (2, 3), (2, 1), (3, 0)] {
            let update = try WelcomeSetupLogic.update(profile: profile(), draft: draft, step: step, next: next, skip: true)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as? [String: Any])
            XCTAssertEqual(Set(json.keys), Set(["expected_version", "setup_step", "setup_completed"]))
        }
    }
    func testSurveySplitsSourceDelimitersAndPreservesAllFields() throws {
        var draft = WelcomeSetupDraft(); draft.occupation = "研究者"; draft.industry = "设计"; draft.goals = ["辅助写作", "研究一个问题"]
        draft.interests = "城市、 电影,认知科学，\n 阅读\n"; draft.additional = "每周读一本书"
        let update = try WelcomeSetupLogic.update(profile: profile(), draft: draft, step: 2, next: 3, skip: false)
        XCTAssertEqual(update.questionnaire, Questionnaire(additional: "每周读一本书", goals: draft.goals, industry: "设计", interests: ["城市", "电影", "认知科学", "阅读"], occupation: "研究者"))
        XCTAssertNil(update.name); XCTAssertNil(update.soulText)
    }
    func testContractLimitsRejectInvalidDraftWithoutClippingIt() throws {
        var draft = WelcomeSetupDraft(); draft.name = String(repeating: "名", count: 41)
        XCTAssertThrowsError(try WelcomeSetupLogic.update(profile: profile(), draft: draft, step: 1, next: 2, skip: false))
        XCTAssertEqual(draft.name.count, 41)
        draft = .init(); draft.interests = (1...13).map { "主题\($0)" }.joined(separator: "、")
        XCTAssertThrowsError(try WelcomeSetupLogic.update(profile: profile(), draft: draft, step: 2, next: 3, skip: false))
        draft.interests = String(repeating: "题", count: 61)
        XCTAssertThrowsError(try WelcomeSetupLogic.update(profile: profile(), draft: draft, step: 2, next: 3, skip: false))
    }
    func testCompleteUsesPersistedStepFourAndNeverWaitsForImportedMaterials() throws {
        let update = try WelcomeSetupLogic.update(profile: profile(step: 3), draft: .init(), step: 3, next: 4, skip: false)
        XCTAssertEqual(update.setupStep, 4); XCTAssertEqual(update.setupCompleted, true)
        XCTAssertNil(update.name); XCTAssertNil(update.questionnaire)
        XCTAssertThrowsError(try WelcomeSetupLogic.update(profile: profile(), draft: .init(), step: 0, next: 4, skip: true))
    }
    func testProgressUsesOnlyServerCountsAndNeverInventsCompletion() {
        let empty = WelcomeImportProgress(batches: [])
        XCTAssertEqual(empty.fraction, 0)
        XCTAssertEqual(empty.title(name: "", readable: false), "看看你的知识图谱")
        XCTAssertEqual(empty.title(name: "", readable: true), "从一张空白的纸开始")
        let active = WelcomeImportProgress(batches: [batch("a", total: 8, finished: 4, status: "processing"), batch("b", total: 2, finished: 2, failed: 1)])
        XCTAssertEqual(active.total, 10); XCTAssertEqual(active.finished, 6); XCTAssertEqual(active.failed, 1)
        XCTAssertEqual(active.fraction, 0.6); XCTAssertTrue(active.processing)
        XCTAssertEqual(active.title(name: "小叶", readable: true), "小叶正在读你的收藏")
        XCTAssertEqual(WelcomeImportProgress(batches: [batch("a", total: 2, finished: 2, failed: 1)]).title(name: "", readable: true), "还有几条资料需要重试")
    }
    func testConflictMergeOnlyOverridesLocallyChangedFields() {
        let base = profile(step: 2)
        var draft = WelcomeSetupDraft(profile: base); draft.name = "本地名字"; draft.additional = "本地补充"
        var latest = base; latest.version += 1; latest.avatarId = "qi"; latest.color = "#3fae9c"
        latest.questionnaire.industry = "远端领域"; latest.questionnaire.goals = ["探索新领域"]
        let merged = WelcomeSetupLogic.merging(draft: draft, base: base, latest: latest)
        XCTAssertEqual(merged.name, "本地名字"); XCTAssertEqual(merged.additional, "本地补充")
        XCTAssertEqual(merged.avatar, "qi"); XCTAssertEqual(merged.color, "#3fae9c")
        XCTAssertEqual(merged.industry, "远端领域"); XCTAssertEqual(merged.goals, ["探索新领域"])
    }
}
