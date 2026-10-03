import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import { readAccountUsage } from '../../modules/account'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import { subscription } from '../../modules/product-integrations'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { NavIcon } from './NavIcon'
import { RoleIdentityPanel } from './RoleIdentityPanel'
import './account-menu.css'

export function AccountMenu({ userId, accountName, onOpen }: { userId: string; accountName: string; onOpen?(): void }) {
  const { text } = useAppLocale()
  const location = useLocation()
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [identityTab, setIdentityTab] = useState<'identity' | 'memory'>('identity')
  const [identityOpen, setIdentityOpen] = useState(false)
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, staleTime: 30_000 })
  const plan = useQuery({ queryKey: ['subscription', userId], queryFn: subscription, enabled: open, staleTime: 0 })
  const usage = useQuery({ queryKey: ['account', 'usage', userId], queryFn: readAccountUsage, enabled: open, staleTime: 0 })
  const chosen = profile.data
  const avatar = agentAvatarPresets.find(preset => preset.id === chosen?.avatar_id) ?? agentAvatarPresets[0]
  const name = chosen?.name?.trim() || 'Agent'
  const currentPlan = plan.data?.subscription
  const planName = plan.isError ? text('套餐信息暂不可用', 'Plan unavailable')
    : !plan.data ? text('正在读取套餐…', 'Loading plan…')
    : !currentPlan ? text('未订阅', 'No subscription')
    : plan.data.plans.find(item => item.id === currentPlan.plan_id)?.name || text('套餐信息待确认', 'Plan not identified')
  const planStates: Record<string, string> = { trialing: text('试用中', 'Trial'), past_due: text('付款逾期', 'Payment overdue'), canceled: text('已取消', 'Canceled'), unpaid: text('未付款', 'Unpaid'), incomplete: text('待完成付款', 'Payment pending'), incomplete_expired: text('已过期', 'Expired'), paused: text('已暂停', 'Paused') }
  const planState = !plan.isError && currentPlan && currentPlan.status !== 'active' ? planStates[currentPlan.status] ?? text('状态待确认', 'Status unconfirmed') : null
  const remaining = usage.isError ? text('额度信息暂不可用', 'Usage unavailable')
    : !usage.data ? text('正在读取…', 'Loading…')
    : usage.data.isUnlimited ? text('不限量', 'Unlimited')
    : usage.data.remainingPercent === null ? text('额度信息暂不可用', 'Usage unavailable')
    : text(`剩余 ${usage.data.remainingPercent}%`, `${usage.data.remainingPercent}% left`)
  const buckets = usage.isError ? [] : usage.data?.buckets ?? []
  // Only a single current subscription pool can describe the plan allowance.
  // Never relabel a welcome gift, top-up, or lifetime balance as monthly usage.
  const subscriptionBuckets = buckets.filter(bucket => bucket.kind === 'subscription')
  const monthlyPercent = subscriptionBuckets.length === 1 ? subscriptionBuckets[0].remainingPercent : null
  const monthlyRemaining = usage.isError ? text('暂不可用', 'Unavailable')
    : !usage.data ? text('正在读取…', 'Loading…')
    : usage.data.isUnlimited ? text('不限量', 'Unlimited')
    : subscriptionBuckets.length === 0 ? text('暂无月度额度', 'No monthly allowance')
    : monthlyPercent === null ? text('待确认', 'Unconfirmed')
    : text(`剩余 ${monthlyPercent}%`, `${monthlyPercent}% left`)

  useEffect(() => { setOpen(false); setIdentityOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function openMenu() { setOpen(true); onOpen?.() }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    event.preventDefault(); event.stopPropagation()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <><div className="application-account-menu" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <button ref={trigger} className="qx-item application-account__identity" type="button"
      aria-label={text(`账户 ${accountName}`, `Account ${accountName}`)} title={`${name} · ${accountName}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) setOpen(false); else openMenu() }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openMenu() } }}>
      <AgentAvatar avatar={avatar.id} color={chosen?.color} size={32} state="idle" />
      <span className="application-account__name">{name}</span><NavIcon name="chevron" />
    </button>
    {open ? <div ref={menu} id={id} role="menu" aria-label={text('账户菜单', 'Account menu')}
      className="qx-panel account-menu" onKeyDown={handleKey}>
      <div className="account-menu__monthly" role="presentation">
        <div className="account-menu__monthly-heading"><span>{text('本月额度', 'Monthly allowance')}</span><span aria-live="polite">{monthlyRemaining}</span></div>
        {monthlyPercent !== null && !usage.data?.isUnlimited ? <div className="account-menu__meter" role="progressbar" aria-label={text('当前套餐周期剩余额度', 'Remaining allowance for the current plan period')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={monthlyPercent}>
          <span style={{ width: `${monthlyPercent}%` }} />
        </div> : <div className="account-menu__meter" aria-hidden="true" />}
        {subscriptionBuckets.length > 0 ? <small>{text('按当前套餐周期，非自然月统计', 'Current plan period, not calendar-month usage')}</small> : null}
      </div>
      <div className="account-menu__identity" role="presentation">
        <AgentAvatar avatar={avatar.id} color={chosen?.color} size={32} state="idle" />
        <div><strong>{accountName}</strong><span className="qx-meta" aria-live="polite">{planName}{planState ? ` · ${planState}` : ''}</span></div>
      </div>
      <button className="qx-item" role="menuitem" type="button" onClick={() => { trigger.current?.focus(); setOpen(false); setIdentityTab('identity'); setIdentityOpen(true) }}><NavIcon name="user" /><span>{text('Soul · 人格', 'Soul')}</span></button>
      <button className="qx-item" role="menuitem" type="button" onClick={() => { trigger.current?.focus(); setOpen(false); setIdentityTab('memory'); setIdentityOpen(true) }}><NavIcon name="library" /><span>{text('Memory · 记忆', 'Memory')}</span></button>
      <Link className="qx-item account-menu__usage" role="menuitem" to="/subscription" onClick={() => setOpen(false)}>
        <NavIcon name="graph" /><span>{text('剩余使用额度', 'Remaining allowance')}</span>
        {buckets.length ? <span className="account-menu__buckets">{buckets.map(bucket => <small key={bucket.id}>
          <span>{bucket.kind === 'subscription' ? text('套餐额度', 'Plan allowance') : bucket.kind === 'top_up' ? text('额外购买额度', 'Purchased allowance') : text('赠送额度', 'Welcome allowance')}</span>
          <span>{bucket.remainingPercent === null ? text('暂不可用', 'Unavailable') : `${bucket.remainingPercent}%`}</span>
        </small>)}</span> : <small aria-live="polite">{remaining}</small>}
      </Link>
      <Link className="qx-item" role="menuitem" to="/subscription" onClick={() => setOpen(false)}><NavIcon name="card" /><span>{text('升级套餐', 'Upgrade plan')}</span></Link>
      <Link className="qx-item" role="menuitem" to="/settings" state={{ settingsBackground: location }} onClick={() => setOpen(false)}><NavIcon name="settings" /><span>{text('设置', 'Settings')}</span></Link>
    </div> : null}
  </div><RoleIdentityPanel key={userId} open={identityOpen} initialTab={identityTab} onClose={() => setIdentityOpen(false)} userId={userId} accountName={accountName} /></>
}
