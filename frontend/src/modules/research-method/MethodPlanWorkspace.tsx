import { PageLoading } from '../../ui/PageLoading'
import { Select } from '../../ui/Select'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  confirmMethodPlan, createMethodPlan, getCurrentMethodPlan, listMethodPlanVersions,
  getMethodPlanPrerequisites,
  resolveMethodPlanReview, reviewMethodPlan, restoreMethodPlan, updateMethodPlan,
  type MethodKind, type MethodPlan,
} from './researchMethodApi'
import './method-plan-view.css'

const METHOD_LABELS: Record<MethodKind, string> = {
  undecided: '暂缓决定',
  qualitative: '质性研究',
  quantitative: '定量研究',
  mixed: '混合研究',
}

const METHOD_DESCRIPTIONS: Record<MethodKind, string> = {
  undecided: '保留路径比较与下一次决定所需信息，暂不把方法选择写成既定事实。',
  qualitative: '围绕材料、批注、备忘、跨案例比较与理论检验建立解释性设计。',
  quantitative: '把理论概念落实为变量、测量、样本与可检验的统计分析计划。',
  mixed: '说明两类证据为何结合、如何排序整合，以及冲突时共同结论的边界。',
}

const STATUS_LABELS: Record<MethodPlan['status'], string> = {
  draft: '草案',
  under_review: '审校中',
  confirmed: '已确认',
  stale: '依据已变化',
}

const REQUIRED_SECTIONS: Record<MethodKind, string[]> = {
  undecided: ['decision'],
  qualitative: ['design', 'research_object', 'sampling', 'material_acquisition', 'analysis', 'credibility', 'reflexivity', 'ethics'],
  quantitative: ['design', 'operationalization', 'variables_indicators', 'hypotheses', 'measurement', 'sampling', 'analysis_plan', 'conditions', 'limitations', 'ethics'],
  mixed: ['design', 'rationale', 'sequence', 'weight', 'integration', 'conflict_handling', 'common_conclusions', 'ethics'],
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

export function MethodPlanWorkspace({ taskId }: { taskId: string }) {
  const [plan, setPlan] = useState<MethodPlan | null>(null)
  const [versions, setVersions] = useState<MethodPlan[]>([])
  const [kind, setKind] = useState<MethodKind>('undecided')
  const [rationale, setRationale] = useState('')
  const [sections, setSections] = useState<MethodPlan['sections']>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewBlocking, setReviewBlocking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getCurrentMethodPlan(taskId)
      setPlan(current)
      if (current) {
        setKind(current.method_kind)
        setRationale(current.rationale)
        setSections(current.sections)
        setVersions(await listMethodPlanVersions(current.plan_id))
      } else {
        setVersions([])
      }
    } catch (cause) {
      setError(errorMessage(cause, '方法计划加载失败。'))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { void load() }, [load])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const prerequisites = await getMethodPlanPrerequisites(taskId)
      const created = await createMethodPlan(taskId, {
        framework_id: prerequisites.frameworkId,
        theory_plan_id: prerequisites.theoryPlanId,
        method_kind: kind,
      })
      setPlan(created)
      setKind(created.method_kind)
      setRationale(created.rationale)
      setSections(created.sections)
      setVersions([created])
    } catch (cause) {
      setError(errorMessage(cause, '方法计划创建失败。'))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateMethodPlan(plan.plan_id, {
        expected_version: plan.version,
        method_kind: kind,
        rationale,
        change_summary: '用户编辑方法计划',
        sections,
      })
      setPlan(updated)
      setKind(updated.method_kind)
      setRationale(updated.rationale)
      setSections(updated.sections)
      setVersions((items) => [updated, ...items.filter((item) => item.version !== updated.version)])
    } catch (cause) {
      setError(errorMessage(cause, '方法计划保存失败。'))
    } finally {
      setBusy(false)
    }
  }

  async function act(action: () => Promise<MethodPlan>) {
    setBusy(true)
    setError(null)
    try {
      const updated = await action()
      setPlan(updated)
      setSections(updated.sections)
      setKind(updated.method_kind)
      setRationale(updated.rationale)
      setVersions((items) => [updated, ...items.filter((item) => item.version !== updated.version)])
    } catch (cause) {
      setError(errorMessage(cause, '方法计划操作失败。'))
    } finally {
      setBusy(false)
    }
  }

  const userDecisionCount = useMemo(
    () => sections.filter((section) => section.source === 'user').length,
    [sections],
  )
  const pendingReviewCount = plan?.reviews.filter((review) => review.blocking && !review.resolved_at).length ?? 0
  const missingDecisionCount = REQUIRED_SECTIONS[kind].filter((key) => {
    const section = sections.find((item) => item.key === key)
    return !section || section.source !== 'user'
  }).length
  const canConfirm = Boolean(plan && plan.status !== 'confirmed' && plan.status !== 'stale' && missingDecisionCount === 0 && pendingReviewCount === 0)

  const isLocked = plan?.status === 'confirmed' || plan?.status === 'stale' || busy
  const pathOptions = (Object.keys(METHOD_LABELS) as MethodKind[]).map(value => ({ value, label: METHOD_LABELS[value] }))

  if (loading) return <section className="ep-method" aria-label="研究方法计划"><PageLoading message="正在恢复方法计划…" /></section>
  if (!plan && error) return <section className="ep-method" aria-label="研究方法计划"><p className="ep-method__error" role="alert">{error}</p><button className="qx-btn qx-btn--secondary" type="button" onClick={() => void load()}>重新加载</button></section>

  return <section className="ep-method" aria-label="研究方法计划">
    <header className="ep-method__head">
      <div><h1 className="qx-section-title">方法设计</h1><p className="qx-card__body">{plan?.research_question || '选择一种适合研究问题的路径，再逐步补充研究设计。'}</p></div>
      {plan ? <span className="ep-method__status">v{plan.version} · {STATUS_LABELS[plan.status]}</span> : null}
    </header>
    {!plan ? <form className="qx-card ep-method__start" onSubmit={event => { event.preventDefault(); void create() }}>
      <label className="ep-method__field">先选一个路径<Select className="qx-input" value={kind} disabled={busy} onChange={nextValue => setKind(nextValue as MethodKind)} options={pathOptions} /></label>
      <p className="qx-card__body">{METHOD_DESCRIPTIONS[kind]}</p><button className="qx-btn qx-btn--primary" type="submit" disabled={busy}>建立方法计划草案</button>
    </form> : <>
      {plan.status === 'stale' ? <section className="ep-method__stale" role="status"><strong>这份计划所依据的框架或理论已经变化。</strong><p>{plan.stale_reason || '旧版本仍可在历史中查看，但不能继续确认或编辑。'}</p><button className="qx-btn qx-btn--primary" type="button" disabled={busy} onClick={() => void create()}>根据当前依据重新建立计划</button></section> : null}
      <form className="ep-method__document" onSubmit={event => { event.preventDefault(); void save() }}>
        <section aria-labelledby="method-path-heading">
          <h2 id="method-path-heading" className="qx-heading">研究路径</h2>
          <label className="ep-method__field">选择研究路径<Select className="qx-input" value={kind} disabled={isLocked} onChange={nextValue => setKind(nextValue as MethodKind)} options={pathOptions} /></label>
          <p className="qx-meta">{METHOD_DESCRIPTIONS[kind]}</p>
          <label className="ep-method__field">方法理由<textarea className="qx-textarea" value={rationale} disabled={isLocked} onChange={event => setRationale(event.target.value)} /></label>
        </section>
        <section aria-labelledby="method-sections-heading">
          <div className="ep-method__section-heading"><h2 id="method-sections-heading" className="qx-heading">计划章节</h2><span className="qx-meta">{userDecisionCount}/{sections.length} 已由用户决定</span></div>
          <fieldset className="ep-method__chapters" disabled={isLocked}><legend className="ep-method__sr">方法计划章节</legend>
            {sections.map((section, index) => <label key={section.key} className="ep-method__chapter"><span><span className="ep-method__number">{index + 1}</span><strong>{section.title}</strong><small>{section.source === 'user' ? '用户决定' : '系统建议'}</small></span><textarea className="qx-textarea" aria-label={section.title} value={section.content} onChange={event => setSections(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value, source: 'user' } : item))} /></label>)}
          </fieldset>
        </section>
        <section className="ep-method__check" aria-labelledby="method-check-heading"><h2 id="method-check-heading" className="qx-heading">确认前检查</h2><ul><li>{missingDecisionCount === 0 ? '所有章节已由用户决定' : `还有 ${missingDecisionCount} 个章节保留为系统建议`}</li><li>{pendingReviewCount === 0 ? '没有未处理的阻断审校' : `有 ${pendingReviewCount} 条阻断审校待处理`}</li><li>{plan.status === 'stale' ? (plan.stale_reason || '依据版本已变化，请重新建立计划') : '理论与材料依据已固定'}</li></ul></section>
        <footer className="ep-method__actions"><button className="qx-btn qx-btn--primary" type="submit" disabled={isLocked}>保存新版本</button><button className="qx-btn qx-btn--secondary" type="button" disabled={!canConfirm || busy} onClick={() => void act(() => confirmMethodPlan(plan.plan_id, { expected_version: plan.version, reason: '用户确认方法计划' }))}>确认计划</button></footer>
      </form>
      <details className="ep-method__details"><summary>理论、证据与约束</summary><dl className="ep-method__context">{[['理论摘要', plan.theory_summary], ['理论概念', plan.theory_concepts.join('；') || '当前框架未列出'], ['证据引用', plan.evidence_ref_ids.join('、') || '当前框架未列出'], ['材料约束', plan.material_constraints.join('；') || '未记录'], ['伦理约束', plan.ethical_constraints.join('；') || '未记录'], ['知识发布版本', plan.knowledge_release_id || '未记录']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {plan.shared_context?.length ? <section aria-label="已固定的上游依据"><h3 className="qx-heading">已固定的上游依据</h3>{plan.shared_context.map(item => <article className="ep-method__upstream" key={item.key}><strong>{item.title}</strong><p>{item.content}</p>{item.evidence_refs.length ? <p className="qx-meta">证据定位：{item.evidence_refs.map(ref => ref.evidence_ref_id).join('、')}</p> : null}</article>)}</section> : null}
      </details>
      <details className="ep-method__details" open={pendingReviewCount > 0}><summary>审校记录</summary>
        <form className="ep-method__review-form" onSubmit={event => { event.preventDefault(); void act(async () => { const updated = await reviewMethodPlan(plan.plan_id, { expected_version: plan.version, note: reviewNote.trim(), blocking: reviewBlocking }); setReviewNote(''); setReviewBlocking(false); return updated }) }}>
          <label className="ep-method__field">审校意见<textarea className="qx-textarea" value={reviewNote} disabled={isLocked} onChange={event => setReviewNote(event.target.value)} /></label>
          <label className="ep-method__checkbox"><input type="checkbox" checked={reviewBlocking} disabled={isLocked} onChange={event => setReviewBlocking(event.target.checked)} />阻断确认</label>
          <button className="qx-btn qx-btn--secondary" type="submit" disabled={isLocked || !reviewNote.trim()}>提交审校</button>
        </form>
        {!plan.reviews.length ? <p className="qx-meta">尚无审校意见。</p> : plan.reviews.map(review => <article className="ep-method__review" key={review.review_id}><strong>{review.blocking ? '阻断审校' : '建议'}</strong><p>{review.note}</p>{review.resolved_at ? <span className="qx-meta">已处理</span> : <button className="qx-btn qx-btn--secondary" type="button" disabled={busy || plan.status === 'stale'} onClick={() => void act(() => resolveMethodPlanReview(plan.plan_id, review.review_id, { expected_version: plan.version, reason: '已处理审校意见' }))}>标记已处理</button>}</article>)}
      </details>
      <details className="ep-method__details"><summary>历史版本</summary><ol className="ep-method__versions">{versions.map(item => <li key={`${item.plan_id}-${item.version}`}><div><strong>v{item.version}</strong><span>{item.change_summary}</span><small>{item.actor === 'user' ? '用户决定' : '系统记录'}</small></div>{item.version !== plan.version ? <button className="qx-btn qx-btn--secondary" type="button" disabled={busy || plan.status === 'stale'} onClick={() => void act(() => restoreMethodPlan(plan.plan_id, { source_version: item.version, expected_version: plan.version, reason: `恢复版本 ${item.version}` }))}>恢复</button> : <span className="qx-meta">当前版本</span>}</li>)}</ol></details>
    </>}
    {error ? <p className="ep-method__error" role="alert">{error}</p> : null}
  </section>
}
