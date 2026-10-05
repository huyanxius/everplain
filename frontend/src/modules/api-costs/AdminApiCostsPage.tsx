import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Select } from '../../ui/Select'
import { apiCostsApi } from './apiCostsApi'
import {
  ApiCostsRequestError,
  defaultApiCostFilters,
  formatPicoUsd,
  validateApiCostDates,
  type ApiCostFilters,
  type ApiCostGroup,
  type ApiCostMetrics,
  type ApiCostReport,
  type ApiCostsApi,
} from './apiCostsModel'
import './api-costs.css'

const groups: Array<{ value: ApiCostGroup; label: string }> = [
  { value: 'day', label: '日期（UTC）' },
  { value: 'model', label: '模型' },
  { value: 'provider_host', label: '供应商域名' },
  { value: 'endpoint_id', label: '调用端点 ID' },
  { value: 'user_id', label: '用户 ID' },
]
const count = (value: number) => value.toLocaleString('zh-CN')
const groupLabel = (value: ApiCostGroup) => groups.find(group => group.value === value)?.label

type ReportState =
  | { status: 'loading' }
  | { status: 'error'; message: string; boundary: boolean }
  | { status: 'ready'; report: ApiCostReport }

function TokenDetails({ metrics, detailed = false }: { metrics: ApiCostMetrics; detailed?: boolean }) {
  const detail = (value: number | null, reported: number) => value === null
    ? '未报告'
    : `${count(value)}${reported < metrics.confirmedTokenAttempts ? '（部分报告）' : ''}`
  return <>
    <span>输入 {count(metrics.inputTokens)} · 输出 {count(metrics.outputTokens)}</span>
    <span className="qx-meta">缓存读取 {detail(metrics.cacheReadTokens, metrics.cacheReadReportedAttempts)} · 缓存写入 {detail(metrics.cacheWriteTokens, metrics.cacheWriteReportedAttempts)}</span>
    <span className="qx-meta">推理 {detail(metrics.reasoningTokens, metrics.reasoningReportedAttempts)}</span>
    {detailed && <span className="qx-meta">已确认 token {count(metrics.confirmedTokenAttempts)} 次 · 缺少 token 明细 {count(metrics.missingTokenAttempts)} 次</span>}
  </>
}

function Summary({ value }: { value: ApiCostMetrics }) {
  return <section aria-label="筛选范围汇总" className="ep-api-costs__summary">
    <div className="qx-card ep-api-costs__metric">
      <h2 className="qx-heading">官方参考成本</h2>
      <strong>{formatPicoUsd(value.referenceCostPico)}</strong>
      <p className="qx-meta">仅合计账本中已有的历史参考金额；{count(value.unpricedAttempts)} 次用量未定价，不计入此金额。</p>
    </div>
    <div className="qx-card ep-api-costs__metric">
      <h2 className="qx-heading">实际采购成本</h2>
      <strong>未核实</strong>
      <p className="qx-meta">缺少可核验采购凭证；{count(value.unverifiedProcurementAttempts)} 条已有采购金额仍缺凭证。</p>
    </div>
    <div className="qx-card ep-api-costs__metric">
      <h2 className="qx-heading">已确认 token 总量</h2>
      <strong>{count(value.inputTokens + value.outputTokens)}</strong>
      <div className="ep-api-costs__details"><TokenDetails metrics={value} detailed /></div>
    </div>
    <dl className="ep-api-costs__ledger qx-card">
      <div><dt>账本调用记录</dt><dd>{count(value.attemptCount)}</dd></div>
      <div><dt>已确认用量</dt><dd>{count(value.confirmedUsageAttempts)}</dd></div>
      <div><dt>未知用量</dt><dd>{count(value.unknownUsageAttempts)}</dd></div>
      <div><dt>确定未发送</dt><dd>{count(value.notSentAttempts)}</dd></div>
      <div><dt>有效预留（非实付）</dt><dd>{count(value.activeReservedAttempts)} 次<span>{formatPicoUsd(value.activeReservedCostPico)}</span></dd></div>
      <div><dt>待核未知（非实付）</dt><dd>{count(value.pendingUnknownAttempts)} 次<span>{formatPicoUsd(value.pendingUnknownCostPico)}</span></dd></div>
    </dl>
  </section>
}

function CostTable({ report }: { report: ApiCostReport }) {
  return <div className="ep-api-costs__table-scroll" tabIndex={0} role="region" aria-label="成本分组明细，可横向滚动">
    <table className="ep-api-costs__table">
      <caption>按{groupLabel(report.groupBy)}分组的账本统计</caption>
      <thead><tr>
        <th scope="col">{groupLabel(report.groupBy)}</th>
        <th scope="col">调用与用量状态</th>
        <th scope="col">已确认 token</th>
        <th scope="col">官方参考成本</th>
        <th scope="col">实际采购成本</th>
        <th scope="col">有效预留（非实付）</th>
        <th scope="col">待核未知（非实付）</th>
      </tr></thead>
      <tbody>{report.items.map(item => <tr key={item.groupValue === null ? 'null:' : `value:${item.groupValue}`}>
        <th scope="row">{item.groupValue === null ? '未记录' : item.groupValue}</th>
        <td><div className="ep-api-costs__details">
          <span>共 {count(item.attemptCount)} 次</span>
          <span className="qx-meta">已确认 {count(item.confirmedUsageAttempts)} · 未知 {count(item.unknownUsageAttempts)}</span>
          <span className="qx-meta">未发送 {count(item.notSentAttempts)} · 缺少 token {count(item.missingTokenAttempts)}</span>
        </div></td>
        <td><div className="ep-api-costs__details"><span>合计 {count(item.inputTokens + item.outputTokens)}</span><TokenDetails metrics={item} /></div></td>
        <td><div className="ep-api-costs__details"><span>{formatPicoUsd(item.referenceCostPico)}</span><span className="qx-meta">未定价 {count(item.unpricedAttempts)} 次</span></div></td>
        <td><div className="ep-api-costs__details"><span>未核实</span><span className="qx-meta">{count(item.unverifiedProcurementAttempts)} 条已有采购金额仍缺凭证</span></div></td>
        <td><div className="ep-api-costs__details"><span>{formatPicoUsd(item.activeReservedCostPico)}</span><span className="qx-meta">{count(item.activeReservedAttempts)} 次</span></div></td>
        <td><div className="ep-api-costs__details"><span>{formatPicoUsd(item.pendingUnknownCostPico)}</span><span className="qx-meta">{count(item.pendingUnknownAttempts)} 次</span></div></td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function AdminApiCostsPage({ api = apiCostsApi, onForbidden, onSessionExpired }: {
  api?: ApiCostsApi
  onForbidden?(): void
  onSessionExpired?(): void
}) {
  const [draft, setDraft] = useState<ApiCostFilters>(() => defaultApiCostFilters())
  const [query, setQuery] = useState(() => ({ ...draft, cursor: 0 }))
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<ReportState>({ status: 'loading' })
  const [validation, setValidation] = useState<string | null>(null)
  const [previousCursors, setPreviousCursors] = useState<number[]>([])
  const callbacks = useRef({ onForbidden, onSessionExpired })
  callbacks.current = { onForbidden, onSessionExpired }
  const inFlight = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    inFlight.current = JSON.stringify(query)
    setState({ status: 'loading' })
    api.read(query, controller.signal).then(report => {
      if (active) setState({ status: 'ready', report })
    }).catch((error: unknown) => {
      if (!active) return
      const status = error instanceof ApiCostsRequestError ? error.status : undefined
      const message = status === 401 ? '登录已过期，请重新登录。'
        : status === 403 ? '仅管理员可以查看 API 成本统计。'
          : error instanceof ApiCostsRequestError ? error.message : '暂时无法读取 API 成本统计，请重试。'
      setState({ status: 'error', message, boundary: status === 401 || status === 403 })
      if (status === 401) callbacks.current.onSessionExpired?.()
      if (status === 403) callbacks.current.onForbidden?.()
    }).finally(() => {
      if (active) inFlight.current = null
    })
    return () => { active = false; controller.abort() }
  }, [api, query, reload])

  function apply(event: FormEvent) {
    event.preventDefault()
    const error = validateApiCostDates(draft.startDate, draft.endDate)
    setValidation(error)
    if (error) return
    const next = { ...draft, model: draft.model.trim(), providerHost: draft.providerHost.trim(), endpointId: draft.endpointId.trim(), userId: draft.userId.trim(), cursor: 0 }
    const key = JSON.stringify(next)
    if (inFlight.current === key) return
    // Mark synchronously so repeated submissions cannot enqueue duplicate reads.
    inFlight.current = key
    setPreviousCursors([])
    setQuery(next)
  }

  function refresh() {
    if (inFlight.current !== null) return
    inFlight.current = JSON.stringify(query)
    setReload(value => value + 1)
  }

  function changePage(cursor: number, history: number[]) {
    if (inFlight.current !== null) return
    inFlight.current = JSON.stringify({ ...query, cursor })
    setPreviousCursors(history)
    setQuery(value => ({ ...value, cursor }))
  }

  const report = state.status === 'ready' ? state.report : null
  const busy = state.status === 'loading'
  return <article className="ep-api-costs">
    <header className="ep-api-costs__header">
      <div><h1 className="qx-section-title">API 成本统计</h1><p className="qx-meta">只读管理员账本。金额以 USD 展示，汇总覆盖整个已应用筛选范围。</p></div>
      <button type="button" className="qx-btn qx-btn--secondary" disabled={busy} onClick={refresh}>刷新统计</button>
    </header>
    <form className="qx-card ep-api-costs__filters" aria-label="成本统计筛选" onSubmit={apply}>
      <label>开始日期（UTC，含）<input className="qx-input" type="date" required value={draft.startDate} onChange={event => setDraft(value => ({ ...value, startDate: event.target.value }))} /></label>
      <label>结束日期（UTC，含）<input className="qx-input" type="date" required value={draft.endDate} onChange={event => setDraft(value => ({ ...value, endDate: event.target.value }))} /></label>
      <label>模型（精确匹配）<input className="qx-input" maxLength={256} value={draft.model} onChange={event => setDraft(value => ({ ...value, model: event.target.value }))} placeholder="全部模型" /></label>
      <label>供应商域名（精确匹配）<input className="qx-input" maxLength={256} value={draft.providerHost} onChange={event => setDraft(value => ({ ...value, providerHost: event.target.value }))} placeholder="全部供应商" /></label>
      <label>调用端点 ID（精确匹配）<input className="qx-input" maxLength={128} value={draft.endpointId} onChange={event => setDraft(value => ({ ...value, endpointId: event.target.value }))} placeholder="全部端点" /></label>
      <label>用户 ID（精确匹配）<input className="qx-input" maxLength={256} value={draft.userId} onChange={event => setDraft(value => ({ ...value, userId: event.target.value }))} placeholder="全部用户" /></label>
      <label>分组方式<Select aria-label="分组方式" value={draft.groupBy} options={groups} onChange={value => setDraft(current => ({ ...current, groupBy: value as ApiCostGroup }))} /></label>
      <label>每页分组数<Select aria-label="每页分组数" value={draft.limit} options={[25, 50, 100].map(value => ({ value, label: String(value) }))} onChange={value => setDraft(current => ({ ...current, limit: Number(value) }))} /></label>
      <div className="ep-api-costs__filter-footer"><p className="qx-meta">按调用创建时间统计，UTC 日期闭区间，最多 366 天；空白条件表示全部。调用端点 ID 不代表密钥。</p><button className="qx-btn qx-btn--primary" type="submit">应用筛选</button></div>
      {validation && <p className="qx-notice qx-notice--danger ep-api-costs__validation" role="alert">{validation}</p>}
    </form>
    <aside className="qx-notice ep-api-costs__notice" aria-label="统计口径">
      <p>仅覆盖持久化调用账本，不代表所有供应商账单；无法按密钥归因。官方参考成本、预留金额和待核金额都不是实际采购账单，也不使用 1/35 折算来代替实付。</p>
      <p>token 总量只计算输入 + 输出；缓存与推理为明细，不再重复相加。未知用量、未定价用量与有效预留单独列出，不视为零成本。</p>
    </aside>
    <section aria-label="成本统计结果" aria-busy={busy}>
      <p className="qx-meta ep-api-costs__scope">已应用：{query.startDate} 至 {query.endDate}（UTC，含首尾日期） · 按{groupLabel(query.groupBy)}分组</p>
      {(query.model || query.providerHost || query.endpointId || query.userId) && <p className="qx-meta ep-api-costs__scope">精确匹配：{[
        query.model && `模型 ${query.model}`,
        query.providerHost && `供应商 ${query.providerHost}`,
        query.endpointId && `端点 ${query.endpointId}`,
        query.userId && `用户 ${query.userId}`,
      ].filter(Boolean).join(' · ')}</p>}
      {busy && <p className="qx-notice" role="status">正在读取 API 成本统计…</p>}
      {state.status === 'error' && <div className="qx-notice qx-notice--danger" role="alert"><p>{state.message}</p>{!state.boundary && <button className="qx-btn qx-btn--secondary" type="button" onClick={refresh}>重试</button>}</div>}
      {report && <>
        <Summary value={report.summary} />
        {report.items.length ? <CostTable report={report} /> : <div className="qx-card ep-api-costs__empty" role="status"><h2 className="qx-heading">没有符合条件的账本记录</h2><p className="qx-meta">可以调整日期或清空精确匹配条件后重试。没有记录不代表实际采购成本为零。</p></div>}
        <footer className="ep-api-costs__pagination">
          <p className="qx-meta">共 {count(report.totalGroups)} 个分组{report.items.length > 0 ? ` · 当前 ${count(query.cursor + 1)}–${count(query.cursor + report.items.length)}` : ''}</p>
          <div><button className="qx-btn qx-btn--secondary" type="button" disabled={!previousCursors.length} onClick={() => changePage(previousCursors[previousCursors.length - 1], previousCursors.slice(0, -1))}>上一页</button><button className="qx-btn qx-btn--secondary" type="button" disabled={report.nextCursor === null} onClick={() => { if (report.nextCursor !== null) changePage(report.nextCursor, [...previousCursors, query.cursor]) }}>下一页</button></div>
        </footer>
        <p className="qx-meta">统计生成时间（UTC）：{report.generatedAt}</p>
      </>}
    </section>
  </article>
}
