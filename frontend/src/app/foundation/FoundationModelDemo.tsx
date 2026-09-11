import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'

const questionFlow = [
  ['这两份方案分别依赖什么假设？', '帮我归纳这些访谈里反复出现的问题。', '这份报告的结论有哪些原文支持？'],
  ['用我的阅读笔记解释这个概念。', '哪些观点还需要进一步验证？', '把本周的学习整理成可复习的提纲。'],
  ['比较不同来源对这项技术的判断。', '这几篇文章之间有什么共同观点？', '哪些信息已过时，需要重新核对？'],
  ['帮我把这些材料组织成研究计划。', '有哪些反对意见值得继续追踪？', '这份文稿还缺少哪一类证据？'],
  ['从原文找出支持与反对这个判断的内容。', '把这次讨论整理成有依据的决策备忘。', '上次研究留下的问题有哪些新线索？'],
  ['把我的收藏归纳成几个可以探索的主题。', '这份产品文档与用户反馈有什么差异？', '给我的报告补一份可核查的引用清单。'],
  ['帮我比较两个方案的适用条件。', '从这些资料中找到下一步要验证的问题。', '把研究结果写成一份清楚的说明。'],
  ['整理这个主题的发展过程。', '我的笔记中哪些内容可以合并理解？', '回到最初的材料，检查结论是否成立。'],
]

export function FoundationQuestionFlow() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true)
      return
    }

    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry?.isIntersecting ?? false),
      { rootMargin: '180px 0px', threshold: 0.01 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`foundation-question-flow${active ? ' is-active' : ''}`}
      aria-label="研究问题示例"
      ref={rootRef}
    >
      <p>研究问题示例</p>
      <div aria-hidden="true">
        {questionFlow.map((questions, laneIndex) => (
          <div className={`foundation-question-flow__lane foundation-question-flow__lane--${laneIndex + 1}`} key={questions[0]}>
            <div className="foundation-question-flow__track">
              {[0, 1, 2].map((groupIndex) => (
                <div className="foundation-question-flow__group" key={groupIndex}>
                  {questions.map((question, questionIndex) => (
                    <span key={`${groupIndex}:${question}`}>
                      <i>{String(laneIndex * 3 + questionIndex + 1).padStart(2, '0')}</i>
                      {question}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FoundationModelDemo() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (content) navigate(`/agent?prompt=${encodeURIComponent(content)}`)
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <div className="foundation-model" role="region" aria-label="开始你的研究">
      <form className="foundation-model__field foundation-model__field--standalone" onSubmit={submit}>
        <textarea
          aria-label="输入一个研究问题"
          id="foundation-model-prompt"
          maxLength={1000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder="例如：比较这两份报告的结论与依据"
          rows={1}
          value={draft}
        />
        <button aria-label="前往研究" type="submit" disabled={!draft.trim()}>
          <span aria-hidden="true">↑</span>
        </button>
      </form>
    </div>
  )
}
