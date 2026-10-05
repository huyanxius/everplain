import type { UserAvatarCustom, UserAvatarPerson } from './avatar-data'
const hexColor = /^#[\da-f]{6}$/i
/** RGB interpolation with the prototype's rounding, independent of UI state. */
export function mix(a: string, b: string, t: number): string {
  if (!hexColor.test(a) || !hexColor.test(b) || !Number.isFinite(t) || t < 0 || t > 1) throw new RangeError('Invalid avatar color mix')
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substring(i, i + 2), 16) * (1 - t) + parseInt(b.substring(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
}
/** Derive shades without mutating presets or the persisted customization. */
export function withCustom(p: UserAvatarPerson, custom?: UserAvatarCustom | null): UserAvatarPerson {
  if (!custom) return p
  const q = { ...p }
  if (custom.hair && hexColor.test(custom.hair)) {
    q.hair = custom.hair; q.hairBack = mix(custom.hair, '#2a201c', .14); q.hairShade = mix(custom.hair, '#2a201c', .1)
  }
  if (custom.skin && hexColor.test(custom.skin)) {
    q.face = custom.skin; q.faceLight = mix(custom.skin, '#ffffff', .55); q.handShade = mix(custom.skin, '#b07a5a', .1)
  }
  if (custom.sleeve && hexColor.test(custom.sleeve)) {
    q.sleeve = custom.sleeve; q.sleeveLight = mix(custom.sleeve, '#ffffff', .2); q.front = mix(custom.sleeve, '#ffffff', .08); q.frontLight = mix(custom.sleeve, '#ffffff', .28); q.fold = mix(custom.sleeve, '#000000', .18)
  }
  if (custom.blush === false) q.blush = 0
  return q
}
