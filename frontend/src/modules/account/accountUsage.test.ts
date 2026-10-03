import { describe, expect, it } from 'vitest'
import { accountUsageFromCredits } from './accountUsage'
import type { ActiveUsageBucket, CreditSummary } from './accountManagementModels'

const credits: CreditSummary = { balance: 4500, creditLimit: 3000, grantAmount: 3000, isUnlimited: false, inputTokensPerCredit: 100, outputTokensPerCredit: 25, entries: [], totalEntries: 0, nextCursor: null }
const current: ActiveUsageBucket = { id: 'current-cycle', kind: 'subscription', availablePoints: 3600, limitPoints: 9000, expiresAt: null }

describe('account usage projection', () => {
  it('uses the available amount after holds and only the current pool limit', () => {
    expect(accountUsageFromCredits({ ...credits, activeUsageBuckets: [current] })).toEqual({ isUnlimited: false, remainingPercent: 40, buckets: [{ id: 'current-cycle', kind: 'subscription', remainingPercent: 40, expiresAt: null }] })
  })
  it('keeps legacy credit limits and expired pools unknown', () => {
    expect(accountUsageFromCredits(credits).remainingPercent).toBeNull()
    expect(accountUsageFromCredits({ ...credits, activeUsageBuckets: [{ ...current, expiresAt: '2020-01-01T00:00:00Z' }] }).buckets).toEqual([])
  })
  it.each([
    { availablePoints: 0, limitPoints: 0 },
    { availablePoints: -1 }, { availablePoints: 9001 }, { availablePoints: Number.NaN },
  ])('does not invent a ratio for inconsistent active pools: %j', projection => {
    expect(accountUsageFromCredits({ ...credits, activeUsageBuckets: [{ ...current, ...projection }] }).remainingPercent).toBeNull()
  })
  it('keeps subscription and extra purchases separate instead of averaging them', () => {
    const usage = accountUsageFromCredits({ ...credits, activeUsageBuckets: [current, { ...current, id: 'purchase-1', kind: 'top_up', availablePoints: 1000, limitPoints: 1000 }] })
    expect(usage.remainingPercent).toBeNull()
    expect(usage.buckets.map(bucket => bucket.remainingPercent)).toEqual([40, 100])
  })
  it('distinguishes exhausted usage from unlimited access', () => {
    expect(accountUsageFromCredits({ ...credits, activeUsageBuckets: [{ ...current, availablePoints: 0 }] }).remainingPercent).toBe(0)
    expect(accountUsageFromCredits({ ...credits, isUnlimited: true })).toEqual({ isUnlimited: true, remainingPercent: null, buckets: [] })
  })
})
