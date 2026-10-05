import { describe, expect, it } from 'vitest'
import { estimateReferenceUsage, REFERENCE_PRICING } from './referencePricing'

describe('public list-price estimates', () => {
  it('derives all examples from the displayed official prices and shared assumptions', () => {
    expect(REFERENCE_PRICING.models.map(price => estimateReferenceUsage(price, 30)?.calls)).toEqual([636, 37, 247, 494, 31])
    for (const model of REFERENCE_PRICING.models) {
      const result = estimateReferenceUsage(model, 30)!
      expect(result.inputTokens).toBe(result.calls * 2_000)
      expect(result.outputTokens).toBe(result.calls * 1_000)
      expect(result.calls * result.pointsPerCall).toBeLessThanOrEqual(30)
      expect((result.calls + 1) * result.pointsPerCall).toBeGreaterThan(30)
      expect(model.source).toMatch(/^https:\/\//)
    }
  })
  it('uses the live allowance instead of a hard-coded Free quota', () => {
    expect(estimateReferenceUsage(REFERENCE_PRICING.models[0], 0)?.calls).toBe(0)
    expect(estimateReferenceUsage(REFERENCE_PRICING.models[0], 60)?.calls).toBe(1272)
  })
  it.each([-1, NaN, Infinity])('rejects invalid point budgets %s', value => {
    expect(estimateReferenceUsage(REFERENCE_PRICING.models[0], value)).toBeNull()
  })
  it('rejects impossible prices, token amounts, free division and unsafe totals', () => {
    for (const price of [{ input: -1, output: 1 }, { input: NaN, output: 1 }, { input: 0, output: 0 }]) expect(estimateReferenceUsage(price, 30)).toBeNull()
    for (const amount of [-1, 0.1, Infinity]) expect(estimateReferenceUsage(REFERENCE_PRICING.models[0], 30, amount)).toBeNull()
    expect(estimateReferenceUsage(REFERENCE_PRICING.models[0], Number.MAX_VALUE)).toBeNull()
  })
})
