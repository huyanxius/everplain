import './research-analysis-view.css'
import type { ResearchCycleSnapshot } from './researchCycleModel'

const destinationLabels: Record<string, string> = {
  material_screening: '材料筛选',
  sampling: '下一轮取样',
}

const priorityLabels: Record<string, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
}

const sourceLabels: Record<string, string> = {
  analysis: '分析',
  theory: '理论判断',
}

export function ResearchCyclePanel({ snapshot }: { snapshot: ResearchCycleSnapshot }) {
  const visibleHints = snapshot.reporting_hints.filter((item) => item.status !== 'present')

  return <section className="ep-cycle" role="region" aria-label="证据缺口与下一轮材料">
    <header><h3 className="qx-heading">证据缺口与下一轮材料</h3><span className="qx-meta" title={snapshot.content_hash}>循环 v{snapshot.version}</span></header>
    {snapshot.gaps.length ? <ol className="ep-cycle__gaps">{snapshot.gaps.map(gap => <li key={gap.gap_id}><div className="ep-cycle__meta"><span>{destinationLabels[gap.destination] ?? gap.destination}</span><span>{priorityLabels[gap.priority] ?? gap.priority}</span></div><h4 className="qx-card__title">{gap.description}</h4><p className="qx-card__body">{gap.suggested_action}</p><p className="qx-meta">依据：{sourceLabels[gap.source_kind] ?? gap.source_kind} {gap.source_id}{gap.theory_plan_version ? ` · 理论计划 v${gap.theory_plan_version}` : ''}{` · 循环 v${snapshot.version}`}</p></li>)}</ol> : <p className="ep-analysis__empty">当前已确认分析没有形成新的材料缺口。</p>}
    {visibleHints.length ? <details className="ep-cycle__reporting"><summary>报告覆盖提示（{visibleHints.length}）</summary><p className="qx-meta">只提示报告覆盖，不影响理论或方法判断。</p><ul>{visibleHints.map(hint => <li key={`${hint.guideline}:${hint.item_key}`}><strong>{hint.guideline} · {hint.label}</strong><p>{hint.message}</p></li>)}</ul></details> : null}
  </section>
}
