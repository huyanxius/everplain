import type { AgentConversationSummary } from '../../modules/research-agent'
import type { ResearchMaterial } from '../../modules/research-materials'
import type { ResearchProject } from '../../modules/research-projects'
import type { AppLocale } from '../i18n/AppLocaleProvider'

export type ConversationSuggestionContext = {
  mode: 'chat' | 'research'
  taskId?: string | null
  projects?: ResearchProject[]
  conversations?: AgentConversationSummary[]
  attachedMaterials?: ResearchMaterial[]
}
type Suggestion = { title: string; description: string; prompt: string }
const usableTitle = (title: string) => title.trim().replace(/\s+/g, ' ').slice(0, 180)
const briefTitle = (title: string) => title.length > 52 ? `${title.slice(0, 52)}…` : title

// Titles are topic cues, never evidence that another conversation has been read.
// No requests or user-data persistence are needed to derive these suggestions.
export function buildConversationSuggestions(context: ConversationSuggestionContext, locale: AppLocale): { label: string; cards: Suggestion[] } {
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh
  const research = context.mode === 'research'
  const conversations = (context.conversations ?? []).filter(item => item.turn_count > 0 && usableTitle(item.title)
    && (research ? Boolean(item.task_id) && (!context.taskId || item.task_id === context.taskId) : !item.task_id && !item.reference_knowledge_base_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  // Only explicitly attached, ready files belong to the current request.
  const materials = research ? (context.attachedMaterials ?? []).filter(item => item.status === 'ready' && usableTitle(item.filename)) : []
  if (materials.length) {
    const names = materials.slice(0, 2).map(item => `「${usableTitle(item.filename)}」`).join(text('与', ' and '))
    const card = (title: string, result: string, prompt: string) => ({ title, description: `${briefTitle(names)} · ${result}`, prompt })
    return { label: text('基于已附加材料', 'From your attached materials'), cards: [
      card(text('提炼关键证据', 'Extract the evidence'), text('结论、出处与局限', 'Findings, sources and limits'), text(`阅读已附加的${names}，整理“核心论点—支持证据—原文位置—局限”表。明确标注没有依据的部分，不补写材料里没有的信息。`, `Read the attached ${names}. Make a table of key claims, supporting evidence, source locations and limitations. Mark unsupported claims; do not invent missing information.`)),
      card(text('找出证据缺口', 'Find evidence gaps'), text('事实、假设与核查清单', 'Facts, assumptions and checks'), text(`检查已附加的${names}，区分已证实的事实、作者判断与待验证假设，列出最重要的3个证据缺口和对应核查办法。`, `Review the attached ${names}. Separate established facts, author interpretations and untested assumptions. List the three most important evidence gaps and how to check each.`)),
      card(text('形成研究提纲', 'Build a report outline'), text('章节与证据对应', 'Sections mapped to evidence'), text(`根据已附加的${names}拟一份研究报告提纲。每节注明要回答的问题、可引用的材料位置和仍需补充的来源；先确认目标读者与用途。`, `Build a report outline from the attached ${names}. For each section, identify the question, supporting source locations and missing sources. First confirm the audience and purpose.`)),
    ] }
  }
  const project = research ? context.taskId
    ? context.projects?.find(item => item.task_id === context.taskId)
    : context.projects?.find(item => usableTitle(item.project_title) && !['archived', 'deleted'].includes(item.status)) : undefined
  const topic = usableTitle(project?.project_title ?? conversations[0]?.title ?? '')
  const quoted = topic ? `「${topic}」` : text('我想讨论的主题', 'the topic I want to discuss')
  const guard = topic ? text('只把标题当作主题线索，不假定已读过其他对话或材料；背景不足时先问我。', 'Use this title only as a topic cue. Do not assume access to other conversations or materials; ask me for missing context first.') : ''
  const card = (title: string, result: string, zh: string, en: string): Suggestion => ({ title, description: topic ? `${briefTitle(topic)} · ${result}` : result, prompt: `${text(zh, en)}${guard ? ` ${guard}` : ''}` })
  const label = topic ? project ? text('围绕你的研究项目', 'For your research project') : text('围绕最近的对话主题', 'From your recent conversation topic') : text('通用起步建议', 'General starting points')
  return { label, cards: research ? [
    card(text('缩小研究问题', 'Focus the question'), text('目标、范围与3个可验证子问题', 'Goal, scope and three testable questions'), `围绕${quoted}，先问我研究目标和范围，再拆成3个可验证的子问题，并列出每个问题需要的证据。`, `For ${quoted}, first ask about my research goal and scope. Define three testable questions and the evidence each needs.`),
    card(text('制定查证计划', 'Plan the investigation'), text('检索词、来源与可靠性标准', 'Search terms, sources and reliability criteria'), `针对${quoted}，先确认具体问题，再制定查证计划：给出检索关键词、优先来源类型和判断来源可靠性的标准，按优先级排出下一步。`, `For ${quoted}, first clarify the question. Propose search terms, priority source types and reliability criteria, then order the next steps.`),
    card(text('准备研究产出', 'Shape the deliverable'), text('报告框架与待补充证据', 'Report outline and missing evidence'), `围绕${quoted}，先确认读者与用途，再拟一份简短研究报告框架，区分要回答的问题、待验证的结论和仍需收集的证据，不提前编写结论。`, `For ${quoted}, first confirm the audience and purpose. Outline a short research report, separating questions, claims to test and evidence still needed. Do not invent findings.`),
  ] : [
    card(text('理清下一步', 'Clarify next steps'), text('目标、障碍与3个可执行行动', 'Goal, obstacles and three actionable steps'), `关于${quoted}，先问我目标、已尝试的方法和限制，再找出关键障碍，拆成3个可执行的下一步。`, `For ${quoted}, first ask about my goal, what I have tried and my constraints. Identify the main obstacle and three actionable next steps.`),
    card(text('比较可选方案', 'Compare options'), text('收益、代价与选择依据', 'Benefits, costs and decision criteria'), `围绕${quoted}，先问我正在考虑哪些方案和最看重的标准，再按收益、代价、风险和适用条件做对比，指出还缺哪些信息。`, `For ${quoted}, ask which options I am considering and my priorities. Compare benefits, costs, risks and suitability, and identify missing information.`),
    card(text('把想法写清楚', 'Put an idea into words'), text('明确读者和目的，整理重点与结构', 'Audience, purpose, key points and structure'), `帮我把${quoted}表达清楚。先向我确认原始想法、目标读者和用途，再整理重点和结构，写成一段简洁的文字，不编造事实或进展。`, `Help me express ${quoted} clearly. First ask for my original idea, audience and purpose, then organize the key points into a concise paragraph. Do not invent facts or progress.`),
  ] }
}
