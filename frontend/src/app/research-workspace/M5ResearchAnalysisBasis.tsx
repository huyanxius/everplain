import type { M5ResearchAnalysisBasis as M5ResearchAnalysisBasisData } from '../../api/m5ResearchDelivery'
import './m5-research-delivery.css'

export function M5ResearchAnalysisBasis({ basis }: { basis: M5ResearchAnalysisBasisData | null }) {
  const version = basis?.contentHash.replace(/^sha256:/, '').slice(0, 12)
  return <section className="qx-card ep-delivery-basis" aria-label="本版材料分析依据">
    <header><h3 className="qx-card__title">材料分析依据</h3>{basis ? <p className="qx-meta">{basis.codes.length} 个编码 · {basis.memos.length} 则备忘 · {basis.comparisons.length} 项案例比较</p> : null}</header>
    {!basis ? <p className="qx-meta">本版尚未纳入已确认的个人材料分析。</p> : <>
      <ul className="ep-delivery-basis__items">
        {basis.codes.map(code => <li key={`code-${code.id}`}><span className="qx-tag">编码</span><div><strong>{code.label}</strong><p>{code.definition}</p></div></li>)}
        {basis.memos.map(memo => <li key={`memo-${memo.id}`}><span className="qx-tag">{memo.kindLabel}</span><div><strong>{memo.title}</strong></div></li>)}
        {basis.comparisons.map(comparison => <li key={`comparison-${comparison.id}`}><span className="qx-tag">案例比较</span><div><strong>{comparison.title}</strong><p>{comparison.theoryImplication}</p></div></li>)}
      </ul>
      <footer className="qx-meta"><span>{basis.unavailableAnnotationCount > 0 ? `${basis.unavailableAnnotationCount} 处原文已删除，仅保留来源记录` : '原文位置均可追溯'}</span>{version ? <span>依据版本 {version}</span> : null}</footer>
    </>}
  </section>
}
