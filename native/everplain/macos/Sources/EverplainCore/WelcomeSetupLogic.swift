import Foundation

/// Source: frontend/src/app/welcome/useWelcomeSetup.ts and WelcomeSetupPage.tsx.
/// Pure transition/projection logic; no network, persistence or synthetic production state.
public struct WelcomeSetupDraft: Equatable, Sendable {
    public var name = ""
    public var avatar = "cheng"
    public var color = "#5d8fe6"
    public var style = "clear"
    public var occupation = ""
    public var industry = ""
    public var goals: [String] = []
    public var interests = ""
    public var additional = ""
    public init() {}
    public init(profile: AgentProfileResponse) {
        name = profile.name == "Everplain" ? "" : profile.name
        avatar = WelcomeSetupLogic.avatarIds.contains(profile.avatarId) ? profile.avatarId : "cheng"
        color = profile.color
        style = WelcomeSetupLogic.speakingStyles.contains(where: { $0.id == profile.speakingStyle }) ? profile.speakingStyle : "clear"
        occupation = profile.questionnaire.occupation ?? ""
        industry = profile.questionnaire.industry ?? ""
        goals = profile.questionnaire.goals ?? []
        interests = (profile.questionnaire.interests ?? []).joined(separator: "、")
        additional = profile.questionnaire.additional ?? ""
    }
}

public struct WelcomeImportProgress: Equatable, Sendable {
    public let total: Int
    public let finished: Int
    public let failed: Int
    public let processing: Bool
    public var fraction: Double { total > 0 ? min(1, max(0, Double(finished) / Double(total))) : 0 }
    public init(batches: [ImportBatchResponse]) {
        total = batches.reduce(0) { $0 + max(0, $1.total) }
        finished = batches.reduce(0) { $0 + max(0, $1.finished) }
        failed = batches.reduce(0) { $0 + max(0, $1.failed) }
        processing = batches.contains { $0.status == "processing" }
    }
    public func title(name: String, readable: Bool) -> String {
        guard readable else { return "看看你的知识图谱" }
        if processing { return "\(name.isEmpty ? "Everplain" : name)正在读你的收藏" }
        if failed > 0 { return "还有几条资料需要重试" }
        return total > 0 ? "整理好了" : "从一张空白的纸开始"
    }
}

public enum WelcomeSetupLogic {
    public struct SpeakingStyle: Equatable, Sendable {
        public let id: String
        public let title: String
        public let detail: String
    }
    public static let stageNames = ["导入资料", "名字与外观", "说说自己", "整理图谱"]
    public static let avatarIds = ["cheng", "nian", "qi", "shi", "heng", "ruo", "you"]
    public static let colors = ["#5d8fe6", "#ec8a52", "#3fae9c", "#e55f6f", "#de6aa5", "#9a80e0", "#eeb146", "#3d3d3a"]
    public static let speakingStyles = [
        SpeakingStyle(id: "clear", title: "清晰直接", detail: "先说重点，清楚利落"),
        SpeakingStyle(id: "warm", title: "温和自然", detail: "耐心倾听，一起想办法"),
        SpeakingStyle(id: "rigorous", title: "严谨细致", detail: "重视依据，深入推敲"),
        SpeakingStyle(id: "curious", title: "好奇开放", detail: "发现联系，探索可能")
    ]
    public static let occupations = ["学生", "研究者", "产品经理", "老师", "创作者", "自由职业"]
    public static let goals = ["整理阅读笔记", "查找收藏资料", "研究一个问题", "辅助写作", "准备课程", "探索新领域"]
    public static func initialStep(_ profile: AgentProfileResponse) -> Int {
        profile.setupCompleted ? 0 : min(3, max(0, profile.setupStep))
    }
    public static func splitInterests(_ text: String) -> [String] {
        text.components(separatedBy: CharacterSet(charactersIn: "、,，\n"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    public static func update(profile: AgentProfileResponse, draft: WelcomeSetupDraft, step: Int, next: Int, skip: Bool) throws -> AgentProfileUpdate {
        guard (0...3).contains(step), (0...4).contains(next), next < step || next == step + 1 else {
            throw WelcomeSetupFailure("请选择上一步或继续。")
        }
        var result = AgentProfileUpdate(expectedVersion: profile.version, setupCompleted: next == 4, setupStep: next)
        // Back and Skip only persist navigation, never unsaved identity or survey inputs.
        if !skip && step == 1 {
            let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard name.unicodeScalars.count <= 40 else { throw WelcomeSetupFailure("名字最多 40 个字符。") }
            guard avatarIds.contains(draft.avatar), speakingStyles.contains(where: { $0.id == draft.style }), draft.color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else {
                throw WelcomeSetupFailure("请选择有效的外观、颜色和说话方式。")
            }
            result.name = name.isEmpty ? "Everplain" : name
            result.avatarId = draft.avatar; result.color = draft.color; result.speakingStyle = draft.style
        }
        if !skip && step == 2 {
            let interests = splitInterests(draft.interests)
            guard draft.occupation.unicodeScalars.count <= 160, draft.industry.unicodeScalars.count <= 160, draft.additional.unicodeScalars.count <= 1000 else {
                throw WelcomeSetupFailure("职业和领域最多 160 个字符，补充说明最多 1000 个字符。")
            }
            guard draft.goals.count <= 8, interests.count <= 12, (draft.goals + interests).allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.unicodeScalars.count <= 60 }) else {
                throw WelcomeSetupFailure("目标最多 8 项，关注主题最多 12 项，每项需要 1–60 个字符。")
            }
            result.questionnaire = Questionnaire(additional: draft.additional, goals: draft.goals, industry: draft.industry, interests: interests, occupation: draft.occupation)
        }
        return result
    }
    /// Explicit conflict review retains only locally edited fields, preserving unrelated remote changes.
    public static func merging(draft: WelcomeSetupDraft, base: AgentProfileResponse, latest: AgentProfileResponse) -> WelcomeSetupDraft {
        let previous = WelcomeSetupDraft(profile: base)
        var merged = WelcomeSetupDraft(profile: latest)
        if draft.name != previous.name { merged.name = draft.name }
        if draft.avatar != previous.avatar { merged.avatar = draft.avatar }
        if draft.color != previous.color { merged.color = draft.color }
        if draft.style != previous.style { merged.style = draft.style }
        if draft.occupation != previous.occupation { merged.occupation = draft.occupation }
        if draft.industry != previous.industry { merged.industry = draft.industry }
        if draft.goals != previous.goals { merged.goals = draft.goals }
        if draft.interests != previous.interests { merged.interests = draft.interests }
        if draft.additional != previous.additional { merged.additional = draft.additional }
        return merged
    }
}

public struct WelcomeSetupFailure: LocalizedError, Equatable, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}
