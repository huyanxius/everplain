import { accountManagementApi } from './accountManagementApi'
import type { CreditSummary } from './accountManagementModels'

export type AccountUsageBucket = { id: string; kind: 'subscription' | 'top_up' | 'welcome'; remainingPercent: number | null; expiresAt: string | null }
export type AccountUsage = { isUnlimited: boolean; remainingPercent: number | null; buckets: AccountUsageBucket[] }

/** The server supplies only currently valid pools. Never divide by lifetime grants or combine purchases. */
export function accountUsageFromCredits(credits: CreditSummary): AccountUsage {
  const buckets = credits.isUnlimited ? [] : (credits.activeUsageBuckets ?? [])
    .filter(bucket => ['subscription', 'top_up', 'welcome'].includes(bucket.kind) && (!bucket.expiresAt || Date.parse(bucket.expiresAt) > Date.now()))
    .map(bucket => {
      const available = bucket.availablePoints, limit = bucket.limitPoints
      const valid = typeof available === 'number' && Number.isFinite(available) && available >= 0
        && typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && available <= limit
      return { id: bucket.id, kind: bucket.kind, remainingPercent: valid ? Math.floor(available / limit * 100) : null, expiresAt: bucket.expiresAt }
    })
  return { isUnlimited: credits.isUnlimited, remainingPercent: buckets.length === 1 ? buckets[0].remainingPercent : null, buckets }
}

export async function readAccountUsage(): Promise<AccountUsage> {
  return accountUsageFromCredits(await accountManagementApi.getCreditSummary({ limit: 1 }))
}
