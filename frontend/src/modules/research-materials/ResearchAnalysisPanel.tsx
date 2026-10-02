import { CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import type { ResearchAnalysisDecision } from './ResearchAnalysisCandidateCard'
import { ResearchAnalysisWorkspace } from './ResearchAnalysisWorkspace'
import { ResearchCyclePanel } from './ResearchCyclePanel'
import { createAnalysisMemo, createCaseComparison, decideAnalysisMemo, decideCaseComparison, getAnalysisSnapshot, getResearchCycleSnapshot } from './researchAnalysisApi'
import type { CreateAnalysisMemoInput, CreateCaseComparisonInput, ResearchAnalysisSnapshot } from './researchAnalysisModel'
import type { ResearchCycleSnapshot } from './researchCycleModel'
import { listResearchMaterials } from './researchMaterialsApi'
import type { ResearchMaterial } from './researchMaterialsModel'
import './research-materials.css'

type ResearchAnalysisPanelProps = {
  readonly embedded?: boolean
  readonly onChanged?: () => void
  readonly taskId: string
  readonly refreshKey?: number
}

/**
 * 分析：把材料里已经标出来的片段收拢成备忘和案例比较。
 *
 * 这里和材料工具是两件事，所以是两个组件。它们曾经共用一个组件、靠一个 mode 开关切换，
 * 结果两边的布局互相牵制——材料侧为了迁就分析侧藏掉了自己的工具栏，分析侧又拿不到自己的
 * 页头。拆开之后，各自只对自己的任务负责，共享的只有下面那层 API。
 */
export function ResearchAnalysisPanel({ taskId, refreshKey = 0, embedded = false, onChanged }: ResearchAnalysisPanelProps) {
  const [snapshot, setSnapshot] = useState<ResearchAnalysisSnapshot | null>(null)
  const [cycle, setCycle] = useState<ResearchCycleSnapshot | null>(null)
  const [materials, setMaterials] = useState<readonly ResearchMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [cycleLoading, setCycleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cycleError, setCycleError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loadGeneration = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const cycleAbortRef = useRef<AbortController | null>(null)

  async function loadAnalysis(signal?: AbortSignal) {
    const generation = ++loadGeneration.current
    setLoading(true)
    setError(null)
    try {
      const result = await getAnalysisSnapshot(taskId, signal)
      if (signal?.aborted || generation !== loadGeneration.current) return
      setSnapshot(result)
    } catch (cause: unknown) {
      if (
        (cause as { name?: string } | null)?.name !== 'AbortError'
        && !signal?.aborted
        && generation === loadGeneration.current
      ) setError(cause instanceof Error ? cause.message : '研究分析记录暂时无法加载。')
    } finally {
      if (!signal?.aborted && generation === loadGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    void loadAnalysis(controller.signal)
    return () => {
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
      loadGeneration.current += 1
    }
  }, [taskId, refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    void listResearchMaterials(taskId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setMaterials(result.items.filter((item) => item.status !== 'deleted'))
      })
      .catch(() => {
        // 材料名只用于把批注显示成人看得懂的来源，取不到就退回 ID，不打断分析。
      })
    return () => controller.abort()
  }, [taskId])

  useEffect(() => {
    const controller = new AbortController()
    cycleAbortRef.current?.abort()
    cycleAbortRef.current = controller
    setCycleLoading(true)
    setCycleError(null)
    void getResearchCycleSnapshot(taskId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setCycle(next)
    }).catch((cause: unknown) => {
      if ((cause as { name?: string } | null)?.name !== 'AbortError' && !controller.signal.aborted) {
        setCycleError(cause instanceof Error ? cause.message : '研究循环暂时无法加载。')
      }
    }).finally(() => {
      if (!controller.signal.aborted) setCycleLoading(false)
    })
    return () => {
      controller.abort()
      if (cycleAbortRef.current === controller) cycleAbortRef.current = null
    }
  }, [snapshot, taskId])

  async function saveMemo(body: CreateAnalysisMemoInput) {
    const created = await createAnalysisMemo(taskId, body)
    setSnapshot((current) => current
      ? { ...current, memos: [...current.memos, created] }
      : { task_id: taskId, annotations: [], memos: [created], comparisons: [] })
    setNotice('分析备忘已保存。')
    onChanged?.()
  }

  async function decideMemo(memoId: string, decision: ResearchAnalysisDecision, reason: string, expectedVersion: number) {
    const updated = await decideAnalysisMemo(taskId, memoId, { decision, reason, expected_version: expectedVersion })
    setSnapshot((current) => current
      ? { ...current, memos: current.memos.map((memo) => memo.memo_id === updated.memo_id ? updated : memo) }
      : current)
    setNotice(decision === 'confirmed' ? '备忘草稿已确认。' : '备忘草稿已拒绝。')
  }

  async function saveComparison(body: CreateCaseComparisonInput) {
    const created = await createCaseComparison(taskId, body)
    setSnapshot((current) => current
      ? { ...current, comparisons: [...current.comparisons, created] }
      : { task_id: taskId, annotations: [], memos: [], comparisons: [created] })
    setNotice('案例比较已保存。')
    onChanged?.()
  }

  async function decideComparison(comparisonId: string, decision: ResearchAnalysisDecision, reason: string, expectedVersion: number) {
    const updated = await decideCaseComparison(taskId, comparisonId, { decision, reason, expected_version: expectedVersion })
    setSnapshot((current) => current
      ? { ...current, comparisons: current.comparisons.map((item) => item.comparison_id === updated.comparison_id ? updated : item) }
      : current)
    setNotice(decision === 'confirmed' ? '案例比较已确认。' : '案例比较已拒绝。')
  }

  return (
    <section className={`qx-analysis${embedded ? ' is-embedded' : ''}`} role="region" aria-label="分析">
      {!embedded ? <header className="qx-analysis__head">
        <span className="qx-eyebrow">研究分析工作台</span>
        <h2>从原文证据到分析结论</h2>
        <p className="qx-analysis__summary">
          {snapshot
            ? `${snapshot.annotations.length} 条片段标记 · ${snapshot.memos.length} 条备忘`
            : '在材料里标出的片段会收拢到这里，做成备忘和案例比较。'}
        </p>
      </header> : null}

      {notice ? <p className="qx-message is-success" role="status">{notice}</p> : null}
      {error ? <p className="qx-message is-error" role="alert"><WarningCircleIcon size={15} aria-hidden="true" />{error}</p> : null}
      {cycleError ? <p className="qx-message is-error" role="alert"><WarningCircleIcon size={15} aria-hidden="true" />{cycleError}</p> : null}
      {cycleLoading && !cycle ? <p className="qx-message" role="status"><CircleNotchIcon className="is-spinning" size={16} aria-hidden="true" />正在整理证据缺口</p> : null}

      {loading && !snapshot ? (
        <p className="qx-message" role="status"><CircleNotchIcon className="is-spinning" size={16} aria-hidden="true" />正在加载分析记录</p>
      ) : snapshot ? (
        <>
          {cycle?.gaps.length ? embedded ? <details className="coding-workspace__gaps"><summary>研究检查 · {cycle.gaps.length} 项待完善</summary><ResearchCyclePanel snapshot={cycle} /></details> : <ResearchCyclePanel snapshot={cycle} /> : null}
          <ResearchAnalysisWorkspace
            snapshot={snapshot}
            // 分析页是项目级的，没有「当前材料」这回事；传第一份材料只会凭空多出一个
            // 意义不明的筛选按钮。要按单份材料看，入口在材料阅读台那边。
            selectedMaterialId={null}
            materialNames={Object.fromEntries(materials.map((material) => [material.materialId, material.filename]))}
            onCreateMemo={saveMemo}
            onDecideMemo={decideMemo}
            onCreateComparison={saveComparison}
            onDecideComparison={decideComparison}
          />
        </>
      ) : (
        <p className="research-analysis__empty">研究分析记录暂时无法加载。</p>
      )}
    </section>
  )
}

export type { ResearchAnalysisPanelProps }
