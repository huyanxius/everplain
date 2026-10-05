import { expect, it } from 'vitest'
import { PEOPLE } from './avatar-data'
import { mix, withCustom } from './avatar-colors'
it('mixes RGB channels with the original rounding and endpoints', () => {
  expect(mix('#000000', '#ffffff', .5)).toBe('#808080')
  expect(mix('#123456', '#abcdef', 0)).toBe('#123456')
  expect(mix('#123456', '#abcdef', 1)).toBe('#abcdef')
})
it('keeps original presets when there are no customizations', () => {
  for (const p of PEOPLE) { expect(withCustom(p)).toBe(p); expect(withCustom(p, {})).toEqual(p) }
})
it('derives all original shaded colors without mutating inputs', () => {
  const p = PEOPLE[0], original = { ...p }, c = Object.freeze({ hair: '#123456', skin: '#d8a988', sleeve: '#abcdef', blush: false })
  const q = withCustom(p, c)
  expect(q).toMatchObject({ hair: c.hair, hairBack: mix(c.hair, '#2a201c', .14), hairShade: mix(c.hair, '#2a201c', .1), face: c.skin, faceLight: mix(c.skin, '#ffffff', .55), handShade: mix(c.skin, '#b07a5a', .1), sleeve: c.sleeve, sleeveLight: mix(c.sleeve, '#ffffff', .2), front: mix(c.sleeve, '#ffffff', .08), frontLight: mix(c.sleeve, '#ffffff', .28), fold: mix(c.sleeve, '#000000', .18), blush: 0 })
  expect(p).toEqual(original)
  expect(q.fx).toBe(p.fx)
})
it('restores each preset blush and ignores malformed colors before SVG rendering', () => {
  expect(withCustom(PEOPLE[4], { blush: true }).blush).toBe(.6)
  expect(withCustom(PEOPLE[0], { hair: '\"/><script>bad</script>' })).toEqual(PEOPLE[0])
  expect(() => mix('red', '#ffffff', .5)).toThrow()
})
