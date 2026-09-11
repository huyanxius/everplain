import { ArrowUp } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'

import { FoundationAgentShader } from './FoundationAgentShader'

const researchQuestions = [
  '帮我比较这两份产品方案的差异',
  '从我的阅读笔记里找到反对意见',
  '整理这次调研的发现与原文依据',
  '把这个主题的资料串成研究提纲',
  '最近的技术变化会影响哪些判断？',
  '把访谈与产品数据放在一起比较',
  '这些文档里有哪些相互矛盾的结论？',
  '帮我把研究结果整理成一份报告',
] as const

type CopyPhase = 'entering' | 'resting' | 'exiting'

const COPY_ENTER_DURATION_MS = 960
const COPY_EXIT_DURATION_MS = 460
const COPY_CYCLE_MS = 4_200

function glyphStyle(index: number, count: number) {
  return {
    '--foundation-glyph-index': index,
    '--foundation-glyph-reverse-index': count - index - 1,
    '--foundation-glyph-drift-x': `${((index * 17) % 15) - 7}px`,
    '--foundation-glyph-drift-y': `${10 + ((index * 11) % 14)}px`,
    '--foundation-glyph-rotate': `${((index * 13) % 9) - 4}deg`,
  } as CSSProperties
}

function ResearchQuestionField({ active, value, onChange }: { active: boolean; value: string; onChange(value: string): void }) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [copyPhase, setCopyPhase] = useState<CopyPhase>('entering')
  const [scrollOffset, setScrollOffset] = useState(0)

  useEffect(() => {
    if (!active) {
      setCopyPhase('resting')
      return
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduceMotion) {
      setCopyPhase('resting')
      return
    }

    if (value) {
      setCopyPhase('entering')
      const inputTimer = window.setTimeout(
        () => setCopyPhase('resting'),
        COPY_ENTER_DURATION_MS,
      )
      return () => window.clearTimeout(inputTimer)
    }

    setCopyPhase('entering')
    const restTimer = window.setTimeout(
      () => setCopyPhase('resting'),
      COPY_ENTER_DURATION_MS,
    )
    const exitTimer = window.setTimeout(
      () => setCopyPhase('exiting'),
      COPY_CYCLE_MS - COPY_EXIT_DURATION_MS,
    )
    const swapTimer = window.setTimeout(() => {
      setQuestionIndex((index) => (index + 1) % researchQuestions.length)
      setCopyPhase('entering')
    }, COPY_CYCLE_MS)

    return () => {
      window.clearTimeout(restTimer)
      window.clearTimeout(exitTimer)
      window.clearTimeout(swapTimer)
    }
  }, [active, questionIndex, value])

  const copy = value || researchQuestions[questionIndex]
  const characters = Array.from(copy)
  const copyMode = value ? 'input' : 'questions'

  return (
    <span className="foundation-agent__copy">
      <span className="foundation-agent__question-field" data-copy-mode={copyMode}>
        <input
          aria-label="输入你的研究问题"
          autoComplete="off"
          maxLength={80}
          onChange={(event) => {
            const nextValue = event.currentTarget.value
            onChange(nextValue)
            setScrollOffset(nextValue ? event.currentTarget.scrollLeft : 0)
          }}
          onScroll={(event) => setScrollOffset(event.currentTarget.scrollLeft)}
          spellCheck={false}
          value={value}
        />
        <strong
          aria-hidden="true"
          data-copy-mode={copyMode}
          data-copy-phase={copyPhase}
          data-research-question
          style={copyMode === 'input'
            ? { transform: `translate3d(${-scrollOffset}px, 0, 0)` }
            : undefined}
        >
          {characters.map((character, index) => (
            <span
              className="foundation-agent__glyph"
              key={`${copyMode}:${questionIndex}:${index}:${character}`}
              style={glyphStyle(index, characters.length)}
            >
              {character === ' ' ? '\u00a0' : character}
            </span>
          ))}
        </strong>
      </span>
    </span>
  )
}

export function FoundationAgentReveal() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const rootRef = useRef<HTMLElement>(null)
  const [effectsActive, setEffectsActive] = useState(true)
  const [pageBackdropActive, setPageBackdropActive] = useState(false)

  useEffect(() => {
    const page = rootRef.current?.closest('.public-site')
    if (!page || typeof MutationObserver === 'undefined') return
    const update = () => setPageBackdropActive(page.classList.contains('is-dark-backdrop-active'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(page, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => setEffectsActive(entry?.isIntersecting ?? false),
      { rootMargin: '320px 0px', threshold: 0.01 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let frame = 0
    let lastProgress = -1
    let scrolling = false
    let expanded = false
    let headerInverted = false
    let agentDocumentTop = 0
    let darkCoverDocumentBottom = 0
    const page = root.closest('.public-site')

    const updateGeometry = () => {
      const parentWidth = root.parentElement?.getBoundingClientRect().width ?? window.innerWidth
      const inlineInset = Math.max(0, (window.innerWidth - parentWidth) / 2)
      agentDocumentTop = root.getBoundingClientRect().top + window.scrollY
      const method = page?.querySelector<HTMLElement>('#method')
      darkCoverDocumentBottom = method
        ? method.getBoundingClientRect().bottom + window.scrollY
        : agentDocumentTop + window.innerHeight
      root.style.setProperty('--agent-inline-inset', `${inlineInset.toFixed(2)}px`)
    }

    const updateProgress = () => {
      frame = 0
      const distance = Math.max(window.innerHeight * 0.72, 1)
      const progress = Math.min(1, Math.max(0, window.scrollY / distance))
      if (Math.abs(progress - lastProgress) > 0.0001) {
        root.style.setProperty('--agent-progress', progress.toFixed(4))
        lastProgress = progress
      }

      const nextScrolling = progress > 0.02
      const nextExpanded = progress >= 0.98
      if (nextScrolling !== scrolling) {
        page?.classList.toggle('is-agent-scrolling', nextScrolling)
        scrolling = nextScrolling
      }
      if (nextExpanded !== expanded) {
        page?.classList.toggle('is-agent-expanded', nextExpanded)
        expanded = nextExpanded
      }
      const nextHeaderInverted = nextExpanded
        && window.scrollY + 84 < darkCoverDocumentBottom
      if (nextHeaderInverted !== headerInverted) {
        page?.classList.toggle('is-agent-header-inverted', nextHeaderInverted)
        headerInverted = nextHeaderInverted
      }
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateProgress)
    }
    const onResize = () => {
      updateGeometry()
      onScroll()
    }

    updateGeometry()
    updateProgress()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      page?.classList.remove('is-agent-scrolling', 'is-agent-expanded', 'is-agent-header-inverted')
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <section ref={rootRef} className="foundation-agent" aria-label="Everplain 研究入口">
      <div className="foundation-agent__field" data-dynamic aria-hidden="true">
        {effectsActive || pageBackdropActive ? <FoundationAgentShader /> : null}
      </div>

      <article className="foundation-agent__dialog">
        <form className="foundation-agent__composer" onSubmit={(event) => {
          event.preventDefault()
          const prompt = question.trim()
          navigate(prompt ? `/agent?prompt=${encodeURIComponent(prompt)}` : '/agent')
        }}>
          <ResearchQuestionField active={effectsActive} value={question} onChange={setQuestion} />
          <button type="submit" aria-label="开始研究">
            <ArrowUp weight="bold" aria-hidden="true" />
          </button>
        </form>
      </article>
    </section>
  )
}
