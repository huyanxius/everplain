import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve('src/styles/tokens.css'), 'utf8')

describe('landing and workspace token integration', () => {
  it('declares each token once instead of shadowing workspace values with the landing compatibility block', () => {
    const names = [...tokens.matchAll(/(--[\w-]+)\s*:\s*[^;{}]+;/g)].map(match => match[1])
    expect(names.length).toBe(new Set(names).size)
  })

  it('preserves the three responsive landing heading scales', () => {
    for (const name of ['hero', 'act', 'statement']) {
      expect(tokens).toMatch(new RegExp(`--qx-text-${name}: clamp\\(`))
    }
  })
})
