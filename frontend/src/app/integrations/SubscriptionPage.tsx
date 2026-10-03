import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRightIcon, CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react'
import * as api from '../../modules/product-integrations'
import { useAccount, readAccountUsage } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState, LoadingState } from '../ui/States'
import './subscription-page.css'

type Overview = Awaited<ReturnType<typeof api.subscription>>
type Plan = Overview['plans'][number]
type Subscription = NonNullable<Overview['subscription']>
type PaymentAction = { kind: 'checkout'; planId: string } | { kind: 'portal' }
const tiers = ['Plus', 'Pro', 'Max'] as const
const usageLabels = { subscription: '套餐额度', top_up: '额外购买额度', welcome: '赠送额度' }
const inactiveStatuses = new Set(['canceled', 'incomplete_expired'])
const statusLabels: Record<string, string> = {
  active: '订阅中', trialing: '试用中', past_due: '付款待处理', unpaid: '待付款',
  paused: '已暂停', incomplete: '尚未完成付款', canceled: '已取消', incomplete_expired: '已失效',
}

/** Match explicit catalog identities; checkout retains the server's original ID. */
function planTier(plan: Plan) {
  return tiers.find(tier => [plan.id, plan.name].some(value =>
    value.trim().replace(/^everplain\s+/i, '').toLowerCase() === tier.toLowerCase(),
  ))
}

function periodEnd(subscription: Subscription) {
  if (!subscription.current_period_end) return null
  const date = new Date(subscription.current_period_end)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function paymentUrl(result: Awaited<ReturnType<typeof api.checkout>> | Awaited<ReturnType<typeof api.portal>>) {
  const url = new URL('checkout_url' in result ? result.checkout_url : result.portal_url)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('支付服务返回了无效地址')
  return url.href
}

export function SubscriptionPage() {
  const account = useAccount()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  return <SubscriptionContent key={userId ?? 'anonymous'} userId={userId} />
}

function SubscriptionContent({ userId }: { userId: string | null }) {
  const subscription = useQuery({ queryKey: ['subscription', userId], queryFn: api.subscription })
  const usage = useQuery({ queryKey: ['account', 'usage', userId], queryFn: readAccountUsage, enabled: Boolean(userId) })
  const [pending, setPending] = useState<PaymentAction | null>(null)
  const [failedAction, setFailedAction] = useState<PaymentAction | null>(null)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function redirect(action: PaymentAction) {
    if (busy.current || !subscription.data?.available || subscription.isError) return
    busy.current = true
    setPending(action); setFailedAction(null); setError('')
    try {
      const result = await (action.kind === 'portal' ? api.portal() : api.checkout(action.planId))
      if (!mounted.current) return
      let url: string
      try { url = paymentUrl(result) }
      catch { throw new Error('支付服务返回了无效地址') }
      window.location.assign(url)
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : '暂时无法打开支付服务，请重试')
      setFailedAction(action); setPending(null); busy.current = false
    }
  }

  const overview = subscription.data
  const current = overview?.subscription
  const currentPlan = overview?.plans.find(plan => plan.id === current?.plan_id)
  const ongoing = Boolean(current && !inactiveStatuses.has(current.status))
  const endDate = current ? periodEnd(current) : null
  const canPay = Boolean(overview?.available && !subscription.isError)
  const plans = overview?.plans ?? []
  const tierPlans = tiers.map(tier => plans.find(plan => planTier(plan) === tier && plan.id === current?.plan_id) ?? plans.find(plan => planTier(plan) === tier))
  const displayedIds = new Set(tierPlans.flatMap(plan => plan ? [plan.id] : []))
  const extraPlans = plans.filter(plan => !displayedIds.has(plan.id))

  function renderPlan(plan: Plan | undefined, name: string, key: string) {
    const selected = Boolean(ongoing && plan && plan.id === current?.plan_id)
    const enabled = Boolean(canPay && plan && !selected)
    const action: PaymentAction | null = !plan ? null : ongoing ? { kind: 'portal' } : { kind: 'checkout', planId: plan.id }
    const processing = Boolean(pending && action && pending.kind === action.kind && (pending.kind === 'portal' || (action.kind === 'checkout' && pending.planId === action.planId)))
    const label = selected ? '当前套餐' : !enabled ? '暂未开放' : processing ? '正在打开…' : ongoing ? '更换套餐' : '查看正式结算'
    return <article className={`ep-subscription-plan${selected ? ' ep-subscription-plan--current' : ''}`} key={key} aria-label={`${name} 套餐`}>
      <header><h3>{name}</h3>{selected ? <span className="ep-subscription-badge"><CheckIcon aria-hidden="true" />当前套餐</span> : null}</header>
      <p className="ep-subscription-plan__price">{plan && canPay ? '价格见结算页' : '价格待公布'}</p>
      <p className="ep-subscription-plan__description">{plan?.description || '使用额度与套餐详情将在开放时公布。'}</p>
      <button type="button" className={`qx-btn ${selected ? 'qx-btn--secondary' : 'qx-btn--primary'}`} disabled={!enabled || pending !== null} onClick={() => { if (action) void redirect(action) }}>
        {label}{enabled && !processing ? <ArrowUpRightIcon aria-hidden="true" /> : null}
      </button>
    </article>
  }

  return <PageShell wide><PageContent><main className="ep-subscription">
    <header className="ep-subscription__head"><h1 className="qx-section-title">订阅与用量</h1><p>管理套餐，按需补充使用额度。</p></header>
    {subscription.isPending ? <LoadingState message="正在读取订阅信息" /> : subscription.isError ? <ErrorState title="暂时无法读取订阅" detail={subscription.error.message} onRetry={() => { void subscription.refetch() }} /> : <>
      <section className="ep-subscription-current" aria-labelledby="current-subscription-title">
        <div className="ep-subscription-current__identity"><p id="current-subscription-title">{current && !ongoing ? '最近的订阅' : '当前订阅'}</p>
          <h2>{current ? currentPlan?.name || (current.plan_id && tiers.find(tier => tier.toLowerCase() === current.plan_id?.toLowerCase())) || '订阅方案' : '尚未订阅'}</h2>
          {current ? <p>{statusLabels[current.status] ?? '状态待确认'}{current.cancel_at_period_end && ongoing ? ' · 本期结束后取消' : ''}</p> : <p>{canPay && plans.length ? '选择适合你的套餐。' : '套餐开放后，可在下方选择。'}</p>}
        </div>
        <div className="ep-subscription-current__usage" aria-label="使用额度">
          <span>剩余使用额度</span>
          {usage.isError ? <><strong>暂时无法读取</strong><button type="button" className="qx-btn qx-btn--ghost" onClick={() => { void usage.refetch() }}>重试用量</button></> : usage.isPending && userId ? <strong role="status">正在读取…</strong> : usage.data?.isUnlimited ? <strong>不限量</strong> : usage.data?.buckets.length ? <div className="ep-subscription-current__buckets">{usage.data.buckets.map(bucket => <div className="ep-subscription-usage-bucket" key={bucket.id}>
            <div><span>{usageLabels[bucket.kind]}</span><strong>{bucket.remainingPercent === null ? '暂不可用' : `${bucket.remainingPercent}%`}</strong></div>
            {bucket.remainingPercent !== null ? <progress aria-label={`${usageLabels[bucket.kind]}剩余`} value={bucket.remainingPercent} max={100} /> : null}
            {bucket.expiresAt && Number.isFinite(Date.parse(bucket.expiresAt)) ? <span className="ep-subscription-usage-bucket__expiry">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(bucket.expiresAt))}到期</span> : null}
          </div>)}</div> : <strong>暂不可用</strong>}
        </div>
        {current ? <div className="ep-subscription-current__manage">
          {endDate ? <p>{current.cancel_at_period_end || !ongoing ? '结束日期' : '本期截止'}：{endDate}</p> : null}
          <button type="button" className="qx-btn qx-btn--secondary" disabled={!canPay || pending !== null} onClick={() => { void redirect({ kind: 'portal' }) }}>{pending?.kind === 'portal' ? '正在打开…' : '管理订阅'}<ArrowUpRightIcon aria-hidden="true" /></button>
        </div> : null}
      </section>
      <section className="ep-subscription__section" aria-labelledby="subscription-plans-title">
        <header className="ep-subscription__section-head"><h2 className="qx-heading" id="subscription-plans-title">选择套餐</h2><span>Plus · Pro · Max</span></header>
        {!overview?.available ? <p className="ep-subscription-notice" role="status">{overview?.unavailable_reason || '订阅暂未开放，价格与额度待公布。'}</p> : null}
        <div className="ep-subscription__plans">{tiers.map((tier, index) => renderPlan(tierPlans[index], tier, tier))}</div>
        {extraPlans.length ? <div className="ep-subscription__other-plans"><h3 className="qx-heading">其他已配置方案</h3><div className="ep-subscription__plans">{extraPlans.map(plan => renderPlan(plan, plan.name, plan.id))}</div></div> : null}
        {canPay && plans.length ? <p className="ep-subscription__terms">金额、计费周期和支付条款以正式结算页为准。</p> : null}
      </section>
    </>}
    {error ? <div className="ep-subscription-error" role="alert"><p>{error}</p><button type="button" className="qx-btn qx-btn--secondary" disabled={!canPay || pending !== null} onClick={() => { if (failedAction) void redirect(failedAction) }}>重试打开</button></div> : null}
    <section className="ep-subscription-topup" aria-labelledby="extra-usage-title">
      <div className="ep-subscription-topup__icon"><PlusIcon size={24} aria-hidden="true" /></div>
      <div className="ep-subscription-topup__copy"><h2 className="qx-heading" id="extra-usage-title">额外使用额度</h2><p>单独购买，按需补充。</p><span id="extra-usage-unavailable">暂未开放购买，金额与使用规则待公布。</span></div>
      <button type="button" className="qx-btn qx-btn--secondary" disabled aria-describedby="extra-usage-unavailable">购买额外额度</button>
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
