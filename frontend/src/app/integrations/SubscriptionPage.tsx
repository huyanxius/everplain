import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react'
import * as api from '../../modules/product-integrations'
import { useAccount, readAccountUsage, redeemAccountCode, MutationIntentLedger, creditRedemptionMessage, notifyAccountUsageChanged, watchAccountUsageChanges } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState, LoadingState } from '../ui/States'
import './subscription-page.css'

type Catalog = Awaited<ReturnType<typeof api.productCatalog>>
type Plan = Catalog['plans'][number]
const usageLabels = { subscription: '套餐额度', top_up: '额外购买额度', welcome: '赠送额度' }
const inactiveStatuses = new Set(['canceled', 'incomplete_expired', 'expired', 'scheduled'])
const statusLabels: Record<string, string> = {
  active: '会员生效中', scheduled: '待生效', expired: '已到期', trialing: '试用中', past_due: '付款待处理', unpaid: '待付款',
  paused: '已暂停', incomplete: '尚未完成付款', canceled: '已取消', incomplete_expired: '已失效',
}

function dateLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function priceLabel(fen: number) {
  return `¥${(fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

export function SubscriptionPage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  return <SubscriptionContent key={userId ?? 'anonymous'} userId={userId} />
}

function SubscriptionContent({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient()
  const catalog = useQuery({ queryKey: ['product-catalog'], queryFn: api.productCatalog })
  const subscription = useQuery({ queryKey: ['subscription', userId], queryFn: api.subscription })
  const usage = useQuery({ queryKey: ['account', 'usage', userId], queryFn: readAccountUsage, enabled: Boolean(userId) })
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  const intents = useRef(new MutationIntentLedger())
  useEffect(() => {
    mounted.current = true
    const unwatch = watchAccountUsageChanges(() => {
      void queryClient.invalidateQueries({ queryKey: ['account', 'usage', userId] })
      void queryClient.invalidateQueries({ queryKey: ['subscription', userId] })
    })
    return () => { mounted.current = false; unwatch() }
  }, [queryClient, userId])

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = code.trim()
    if (!userId || busy.current || !value) return
    busy.current = true
    setPending(true); setError(''); setFeedback('')
    try {
      const result = await redeemAccountCode({ code: value, idempotencyKey: intents.current.keyFor('credit-redemption', { code: value }) })
      if (!mounted.current) return
      intents.current.complete('credit-redemption')
      setCode(''); setFeedback(creditRedemptionMessage(result))
      notifyAccountUsageChanged()
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : '兑换未完成，请重试。')
    } finally {
      if (mounted.current) { setPending(false); busy.current = false }
    }
  }

  const current = subscription.data?.subscription
  const currentPlan = catalog.data?.plans.find(plan => plan.id === current?.plan_id) ?? subscription.data?.plans.find(plan => plan.id === current?.plan_id)
  const ongoing = Boolean(current && !inactiveStatuses.has(current.status))
  const startDate = dateLabel(current?.current_period_start)
  const endDate = dateLabel(current?.current_period_end)

  function renderPlan(plan: Plan) {
    const selected = Boolean(ongoing && plan.id === current?.plan_id)
    return <article className={`ep-subscription-plan${selected ? ' ep-subscription-plan--current' : ''}`} key={plan.id} aria-label={`${plan.name} 套餐`}>
      <header><h3>{plan.name}</h3>{selected ? <span className="ep-subscription-badge"><CheckIcon aria-hidden="true" />当前套餐</span> : null}</header>
      <p className="ep-subscription-plan__price">{priceLabel(plan.price_cny_fen)}<span> / {plan.period_days} 天</span></p>
      <p className="ep-subscription-plan__description">{plan.description}</p>
      <ul className="ep-subscription-plan__benefits">
        <li>每 {catalog.data!.reset_days} 天 {plan.weekly_points} 点额度</li>
        <li>{plan.period_days} 天共 {plan.period_points} 点，分 {plan.period_days / catalog.data!.reset_days} 周发放</li>
        <li>全部模型均可使用</li>
      </ul>
      <button type="button" className="qx-btn qx-btn--secondary" disabled={!userId} onClick={() => input.current?.focus()}>使用兑换码</button>
    </article>
  }

  return <PageShell wide><PageContent><main className="ep-subscription">
    <header className="ep-subscription__head"><h1 className="qx-section-title">订阅与用量</h1><p>查看会员套餐与额度，使用兑换码开通或续期。</p></header>
    <section className="ep-subscription-current" aria-labelledby="current-subscription-title">
      <div className="ep-subscription-current__identity"><p id="current-subscription-title">{current?.status === 'scheduled' ? '已安排的会员' : current && !ongoing ? '最近的会员' : '当前套餐'}</p>
        {subscription.isPending ? <LoadingState message="正在读取订阅信息" /> : null}
        {subscription.isError ? <ErrorState title="暂时无法读取订阅" detail={subscription.error.message} onRetry={() => { void subscription.refetch() }} /> : null}
        {subscription.data ? <><h2>{current ? currentPlan?.name || current.plan_id || '会员方案' : 'Free'}</h2>
          {current ? <p>{statusLabels[current.status] ?? '状态待确认'}</p> : catalog.data ? <p>每 {catalog.data.reset_days} 天 {catalog.data.free_weekly_points} 点额度 · 全部模型均可使用</p> : null}
        </> : null}
      </div>
      <div className="ep-subscription-current__usage" aria-label="使用额度">
        <span>剩余使用额度</span>
        {usage.isError ? <><p className="qx-meta">{usage.data ? '用量刷新失败，显示上次读取的额度。' : '暂时无法读取'}</p><button type="button" className="qx-btn qx-btn--ghost" onClick={() => { void usage.refetch() }}>重试用量</button></> : null}
        {usage.isPending && userId ? <strong role="status">正在读取…</strong> : usage.data?.isUnlimited ? <strong>不限量</strong> : usage.data?.buckets.length ? <div className="ep-subscription-current__buckets">{usage.data.buckets.map(bucket => <div className="ep-subscription-usage-bucket" key={bucket.id}>
          <div><span>{usageLabels[bucket.kind]}</span><strong>{bucket.remainingPercent === null ? '暂不可用' : `${bucket.remainingPercent}%`}</strong></div>
          {bucket.remainingPercent !== null ? <progress aria-label={`${usageLabels[bucket.kind]}剩余`} value={bucket.remainingPercent} max={100} /> : null}
          {bucket.expiresAt && Number.isFinite(Date.parse(bucket.expiresAt)) ? <span className="ep-subscription-usage-bucket__expiry">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(bucket.expiresAt))}到期</span> : null}
        </div>)}</div> : !usage.isError ? <strong>暂不可用</strong> : null}
      </div>
      {current && (startDate || endDate) ? <div className="ep-subscription-current__manage">{startDate ? <p>生效时间：{startDate}</p> : null}{endDate ? <p>到期时间：{endDate}</p> : null}</div> : null}
    </section>
    <section className="ep-subscription__section" aria-labelledby="subscription-plans-title">
      <header className="ep-subscription__section-head"><h2 className="qx-heading" id="subscription-plans-title">会员套餐</h2><span>全档位可用全部模型</span></header>
      {catalog.isPending ? <LoadingState message="正在读取套餐价格" /> : null}
      {catalog.isError ? <ErrorState title="暂时无法读取套餐价格" detail={catalog.error.message} onRetry={() => { void catalog.refetch() }} /> : null}
      {catalog.data ? <>
        <p className="ep-subscription-notice">Free 每 {catalog.data.reset_days} 天 {catalog.data.free_weekly_points} 点；会员按周发放额度，未用完的周额度不结转。支付尚未开放，目前仅支持兑换码。</p>
        <div className="ep-subscription__plans">{catalog.data.plans.map(renderPlan)}</div>
      </> : null}
    </section>
    <section className="ep-subscription-redeem" aria-labelledby="subscription-redeem-title">
      <h2 className="qx-heading" id="subscription-redeem-title">兑换会员或额度</h2>
      <p>会员码首次兑换立即生效；已有有效会员时从到期日顺延，当前会员与本周额度保持不变。bank RESET 仅重置当前套餐额度，不延长会员。</p>
      <form onSubmit={event => { void redeem(event) }}><label className="ep-subscription-redeem__field">兑换码<input ref={input} className="qx-input" autoComplete="off" maxLength={64} placeholder="输入兑换码" value={code} disabled={!userId || pending} onChange={event => setCode(event.target.value)} /></label><button className="qx-btn qx-btn--primary" disabled={!userId || pending || !code.trim()}>{pending ? '正在兑换…' : '兑换'}</button></form>
      {feedback ? <p className="qx-notice" role="status">{feedback}</p> : null}
      {error ? <p className="qx-notice qx-notice--danger" role="alert">{error}</p> : null}
    </section>
    <section className="ep-subscription-topup" aria-labelledby="extra-usage-title">
      <div className="ep-subscription-topup__icon"><PlusIcon size={24} aria-hidden="true" /></div>
      <div className="ep-subscription-topup__copy"><h2 className="qx-heading" id="extra-usage-title">额外使用额度</h2>{catalog.data ? <p>{catalog.data.top_up_points} 点 / {priceLabel(catalog.data.top_up_price_cny_fen)}</p> : null}<span>暂未开放购买与支付。</span></div>
    </section>
    <ModelCatalog userId={userId} />
  </main></PageContent></PageShell>
}

function ModelCatalog({ userId }: { userId: string | null }) {
  const [open, setOpen] = useState(false)
  const catalog = useQuery({ queryKey: ['model-catalog', userId], queryFn: api.models, enabled: open })
  return <details className="ep-subscription-models" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>当前模型目录</span><CaretDownIcon aria-hidden="true" /></summary>
    {open ? <div className="ep-subscription-models__content">
      <p>模型可用性由当前服务配置决定。</p>
      {catalog.isPending ? <LoadingState message="正在读取模型配置" /> : catalog.isError ? <ErrorState detail={catalog.error.message} onRetry={() => { void catalog.refetch() }} /> : catalog.data?.length ? <ul>{catalog.data.map(model => <li key={model.id}>
        <div><h3 className="qx-heading">{model.display_name}</h3><p>{model.provider} · {model.model}</p></div>
        <span>{model.availability === 'configured' ? '已配置 · 待实际调用验证' : '尚未配置'}</span>
        {model.capabilities.length ? <div className="ep-subscription-models__tags">{model.capabilities.map(capability => <span className="qx-tag" key={capability}>{capability}</span>)}</div> : null}
        {model.unavailable_reason ? <p className="ep-subscription-models__reason">{model.unavailable_reason}</p> : null}
      </li>)}</ul> : <p>当前没有可显示的模型配置。</p>}
    </div> : null}
  </details>
}
