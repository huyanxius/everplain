import { expect, it } from 'vitest'
import { normalizeCanvasColor } from './resolveCssColor'

it('normalizes computed srgb alpha colors for canvas renderers', () => {
  expect(normalizeCanvasColor('color(srgb 0.192157 0.372549 0.568627 / 0.45)')).toBe('rgba(49, 95, 145, 0.45)')
  expect(normalizeCanvasColor('color(srgb 100% 0% 50% / 25%)')).toBe('rgba(255, 0, 128, 0.25)')
  expect(normalizeCanvasColor('color(srgb 0 0 0)')).toBe('rgba(0, 0, 0, 1)')
})
it('preserves legacy colors and rejects unresolved modern components', () => {
  expect(normalizeCanvasColor('rgba(49, 95, 145, 0.45)')).toBe('rgba(49, 95, 145, 0.45)')
  expect(normalizeCanvasColor('#315f91')).toBe('#315f91')
  expect(normalizeCanvasColor('color(srgb none 0 0)', 'gray')).toBe('gray')
})
