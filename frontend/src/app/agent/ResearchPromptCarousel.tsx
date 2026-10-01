import { useMemo, useState } from 'react'

import { KineticCopyCycle, type KineticCopyMessage } from './KineticCopyCycle'
import { useAppLocale } from '../i18n/AppLocaleProvider'

const researchTopicPresets = [
  "比较这两份产品方案的关键差异",
  "从这些访谈中整理用户需求",
  "帮我研究一个新的市场机会",
  "把阅读笔记整理成知识框架",
  "这份报告的结论有哪些依据",
  "整理这几篇文章的共同观点",
  "帮我核对这项研究的来源",
  "把零散想法变成可执行的计划",
  "分析材料中相互矛盾的观点",
  "围绕这个问题继续查找资料",
  "总结这份长文档的核心发现",
  "从会议记录中提取待办事项",
  "帮我准备一次有依据的讨论",
  "将研究发现组织成报告提纲",
  "这些资料里还有哪些问题没解决",
  "比较不同方案的成本和限制",
  "解释这份技术文档中的概念",
  "帮我整理一个主题的学习路线",
  "找出这组材料中的证据缺口",
  "沿着上次的研究继续推进"
] as const

const englishResearchTopicPresets = [
  "Compare the key differences between these proposals",
  "Find user needs across these interviews",
  "Research a new market opportunity",
  "Organize my reading notes into a knowledge map",
  "What evidence supports this report?",
  "Find common ideas across these articles",
  "Check the sources behind this research",
  "Turn scattered ideas into an actionable plan",
  "Compare conflicting claims in these materials",
  "Find more sources for this question",
  "Summarize the key findings in this document",
  "Extract action items from meeting notes",
  "Help me prepare an evidence-based discussion",
  "Turn research findings into a report outline",
  "Which questions remain unanswered?",
  "Compare the costs and limits of these options",
  "Explain concepts in this technical document",
  "Build a learning path for this topic",
  "Find gaps in the available evidence",
  "Continue where my last research left off"
] as const

const INTRO_PROMPT = '你想研究什么？'

export function ResearchPromptCarousel({ onSelect }: { onSelect: (topic: string) => void }) {
  const { locale } = useAppLocale()
  const { introPrompt, presets, messages } = useMemo(() => {
    const isEnglish = locale === 'en-US'
    const nextIntroPrompt = isEnglish ? 'What do you want to research?' : INTRO_PROMPT
    const nextPresets = isEnglish ? englishResearchTopicPresets : researchTopicPresets
    const nextMessages: readonly KineticCopyMessage[] = [
      { lines: [nextIntroPrompt] },
      ...nextPresets.map((preset) => ({
        prefix: isEnglish ? 'Try' : '试试',
        prefixClassName: 'research-agent-prompt__prefix',
        lines: [preset],
      })),
    ]
    return {
      introPrompt: nextIntroPrompt,
      presets: nextPresets,
      messages: nextMessages,
    }
  }, [locale])
  const [visibleMessageIndex, setVisibleMessageIndex] = useState(0)
  const topic = visibleMessageIndex > 0
    ? presets[visibleMessageIndex - 1]
    : null
  const prompt = topic ?? introPrompt

  return (
    <h1 aria-label={prompt} className="research-agent-prompt" id="research-agent-title">
      <button
        aria-label={prompt}
        disabled={!topic}
        onClick={() => topic && onSelect(topic)}
        type="button"
      >
        <KineticCopyCycle
          active
          as="span"
          className="research-agent-prompt__copy"
          firstCycleMs={5_000}
          loopStartIndex={1}
          messages={messages}
          motionMode="characters"
          onMessageChange={setVisibleMessageIndex}
        />
      </button>
    </h1>
  )
}
