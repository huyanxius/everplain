import { describe, expect, it } from 'vitest'
import { defaultApiCostFilters, formatPicoUsd, validateApiCostDates } from './apiCostsModel'

describe('API cost formatting and date boundaries', () => {
  it('keeps pico-USD exact beyond JavaScript safe integer precision', () => {
    expect(formatPicoUsd('9007199254740993123456789')).toBe('USD 9,007,199,254,740.993123456789')
    expect(formatPicoUsd('1')).toBe('USD 0.000000000001')
    expect(formatPicoUsd('1250000000000')).toBe('USD 1.25')
    expect(formatPicoUsd('0')).toBe('USD 0')
    expect(formatPicoUsd('not-a-cost')).toBe('金额不可用')
  })

  it('chooses thirty inclusive UTC dates independent of local offset', () => {
    expect(defaultApiCostFilters(new Date('2026-10-05T01:30:00+08:00'))).toMatchObject({ startDate: '2026-09-05', endDate: '2026-10-04' })
  })

  it('validates real calendar dates and the inclusive 366-day bound', () => {
    expect(validateApiCostDates('2024-01-01', '2024-12-31')).toBeNull()
    expect(validateApiCostDates('2024-01-01', '2025-01-01')).toContain('366')
    expect(validateApiCostDates('2026-02-29', '2026-03-01')).toContain('有效')
    expect(validateApiCostDates('2026-10-05', '2026-10-04')).toContain('晚于')
    expect(validateApiCostDates('', '2026-10-04')).toContain('有效')
    expect(validateApiCostDates('2026-10-04', '2026-10-04')).toBeNull()
  })
})
