import { afterEach, describe, expect, it, vi } from 'vitest'

import { creditRedemptionMessage } from './creditRedemptionMessage'

afterEach(() => vi.useRealTimers())

describe('credit redemption feedback', () => {
  const membership = { action: 'membership' as const, planId: 'plus', balance: 50, redeemedPoints: 50, membershipStartsAt: '2026-01-01T12:00:00Z', membershipExpiresAt: '2026-01-29T12:00:00Z' }
  it('describes the immediate membership and both dates', () => {
    expect(creditRedemptionMessage(membership)).toContain('Plus 会员已生效')
    expect(creditRedemptionMessage(membership)).toContain('生效时间：2026/01/01')
    expect(creditRedemptionMessage(membership)).toContain('到期时间：2026/01/29')
  })
  it('keeps queued membership feedback distinct from an immediate change', () => {
    const result = creditRedemptionMessage({ ...membership, planId: 'pro', membershipStartsAt: '2099-01-01T12:00:00Z', membershipExpiresAt: '2099-01-29T12:00:00Z' })
    expect(result).toContain('PRO 会员已安排在当前会员到期后生效，当前额度保持不变')
    expect(result).toContain('到期时间：2099/01/29')
  })
  it('supports English membership feedback', () => {
    expect(creditRedemptionMessage(membership, 'en-US')).toContain('Plus membership is active. Starts')
    expect(creditRedemptionMessage({ ...membership, membershipStartsAt: '2099-01-01T12:00:00Z' }, 'en-US')).toContain('with your current allowance unchanged')
  })
  it('reports the real two-day RESET deadline when membership expires before seven days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    const redemption = { action: 'bank_reset' as const, balance: 50, redeemedPoints: 50, quotaPeriodExpiresAt: '2026-01-03T12:00:00Z' }
    const result = creditRedemptionMessage(redemption)
    expect(result).toContain('当前余额：50 积分')
    expect(result).toContain('额度截止时间：2026/01/03')
    expect(result).not.toContain('7 天')
    const english = creditRedemptionMessage(redemption, 'en-US')
    expect(english).toContain('Allowance expiry recorded for this code: 01/03/2026')
    expect(english).not.toContain('7-day')
  })
  it.each([11, 0])('reports the actual %i-point balance when a RESET code is replayed', (balance) => {
    const replay = { action: 'bank_reset' as const, balance, redeemedPoints: 30, quotaPeriodExpiresAt: '2026-01-03T12:00:00Z' }
    const result = creditRedemptionMessage(replay)
    expect(result).toContain(`当前余额：${balance} 积分`)
    expect(result).not.toContain('100%')
    expect(result).toContain('该兑换记录的额度截止时间：2026/01/03')
    const english = creditRedemptionMessage(replay, 'en-US')
    expect(english).toContain(`Current balance: ${balance} points`)
    expect(english).not.toContain('100%')
    expect(english).toContain('Allowance expiry recorded for this code: 01/03/2026')
  })
  it('does not invent a RESET period when the server provides no expiry', () => {
    expect(creditRedemptionMessage({ action: 'bank_reset', balance: 50, redeemedPoints: 50 })).toBe('兑换已确认。当前余额：50 积分。')
    expect(creditRedemptionMessage({ balance: 50, redeemedPoints: 50 }, 'en-US')).toContain('Current balance: 50 points')
  })
})
