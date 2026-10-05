import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { PEOPLE, type UserAvatarCustom, type UserAvatarId } from './avatar-data'
import { mix } from './avatar-colors'
import './avatar-palette.css'

type ColorField = 'hair' | 'skin' | 'sleeve'
type DragKind = 'sv' | 'hue' | 'skin'
type HSV = [number, number, number]
type Picker = { hsv: HSV; skin: number }

// These colors belong to the supplied illustration, so they stay fixed in every theme.
export const SKIN = ['#fbf3ec', '#f6ece2', '#f3e0cf', '#e8c9ae', '#d8a988', '#b98466', '#8d5d45'] as const
const SWATCH = {
  hair: ['#e6d8c5', '#ead3a6', '#e2e2e6', '#c9a0a8', '#8a5a3c', '#7f9fc3', '#4d566c', '#3a3330'],
  skin: SKIN.slice(1),
  sleeve: ['#66728a', '#5f7466', '#7b3f3d', '#d9d3c6', '#5a5468', '#2f2f33', '#b48a6a', '#8a9bb0'],
}
const FIELDS: ColorField[] = ['hair', 'skin', 'sleeve']
const clamp = (value: number) => Math.max(0, Math.min(1, value))

export function hsv2hex(h: number, s: number, v: number) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return '#' + [5, 3, 1].map(n => Math.round(channel(n) * 255).toString(16).padStart(2, '0')).join('')
}

export function hex2hsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let hue = 0
  if (delta) {
    hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  return [hue, max ? delta / max : 0, max]
}

export function skinAt(position: number) {
  const value = clamp(position) * (SKIN.length - 1)
  const index = Math.min(SKIN.length - 2, Math.floor(value))
  return mix(SKIN[index], SKIN[index + 1], value - index)
}

function skinPosition(color: string) {
  let closest = 0, distance = Infinity
  for (let i = 0; i <= 100; i++) {
    const candidate = skinAt(i / 100)
    const next = [1, 3, 5].reduce((sum, j) => sum + Math.abs(parseInt(candidate.slice(j, j + 2), 16) - parseInt(color.slice(j, j + 2), 16)), 0)
    if (next < distance) { distance = next; closest = i / 100 }
  }
  return closest
}

function baseColor(id: UserAvatarId, field: ColorField) {
  const person = PEOPLE.find(person => person.id === id) ?? PEOPLE[0]
  return field === 'skin' ? person.face || '#f6ece2' : person[field]
}

function pickerFor(color: string): Picker {
  return { hsv: hex2hsv(color), skin: skinPosition(color) }
}

export type AvatarPaletteProps = {
  id: UserAvatarId
  custom?: UserAvatarCustom
  onChange(custom: UserAvatarCustom): void
  disabled?: boolean
  /** A discrete pick, blush toggle, or pointer release can pulse a nearby preview. */
  onCommit?(): void
}

/** Shared, controlled palette used by onboarding and the account's appearance panel. */
export function AvatarPalette({ id, custom, onChange, disabled = false, onCommit }: AvatarPaletteProps) {
  const { text } = useAppLocale()
  const pickerId = useId()
  const [tab, setTab] = useState<ColorField>('hair')
  const color = custom?.[tab] || baseColor(id, tab)
  const [picker, setPicker] = useState(() => pickerFor(color))
  const [dragging, setDragging] = useState<DragKind | null>(null)
  const [swapping, setSwapping] = useState(false)
  const pickerRef = useRef(picker)
  const customRef = useRef(custom)
  const previousId = useRef(id)
  const dragRef = useRef<{ kind: DragKind; pointerId: number; element: HTMLDivElement; tab: ColorField } | null>(null)

  useLayoutEffect(() => { customRef.current = custom }, [custom])
  useEffect(() => {
    const drag = dragRef.current
    if (drag && previousId.current === id) return
    if (drag) {
      dragRef.current = null
      setDragging(null)
      if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    }
    previousId.current = id
    const next = pickerFor(color)
    pickerRef.current = next
    setPicker(next)
  }, [id, tab, color])
  useEffect(() => {
    if (!disabled) return
    const drag = dragRef.current
    dragRef.current = null
    setDragging(null)
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
  }, [disabled])

  const labels = { hair: text('发色', 'Hair'), skin: text('肤色', 'Skin'), sleeve: text('衣服', 'Clothes') }
  const [hue, saturation, value] = picker.hsv
  const changed = !!custom?.[tab]
  const spectrumStyle = {
    '--ua-spectrum-white': '#ffffff',
    '--ua-spectrum-black': '#000000',
    '--ua-spectrum-color': `hsl(${hue} 100% 50%)`,
    '--ua-hue-gradient': 'linear-gradient(to right,hsl(0 62% 58%),hsl(40 62% 58%),hsl(80 62% 58%),hsl(140 62% 58%),hsl(190 62% 58%),hsl(230 62% 58%),hsl(280 62% 58%),hsl(330 62% 58%),hsl(360 62% 58%))',
    '--ua-skin-gradient': `linear-gradient(to right,${SKIN.join(',')})`,
  } as CSSProperties

  function updateField(field: ColorField, nextColor: string | null) {
    if (disabled) return
    const next = { ...customRef.current }
    if (nextColor === null) delete next[field]
    else next[field] = nextColor
    customRef.current = next
    onChange(next)
  }

  function selectTab(field: ColorField) {
    if (disabled || tab === field || dragRef.current) return
    const next = pickerFor(customRef.current?.[field] || baseColor(id, field))
    pickerRef.current = next
    setPicker(next)
    setTab(field)
    setSwapping(true)
  }

  function pick(nextColor: string | null) {
    updateField(tab, nextColor)
    const next = pickerFor(nextColor || baseColor(id, tab))
    pickerRef.current = next
    setPicker(next)
    onCommit?.()
  }

  function move(kind: DragKind, field: ColorField, x: number, y: number) {
    const next: Picker = { hsv: [...pickerRef.current.hsv], skin: pickerRef.current.skin }
    if (kind === 'skin') next.skin = x
    else if (kind === 'sv') { next.hsv[1] = x; next.hsv[2] = 1 - y }
    else next.hsv[0] = x * 360
    pickerRef.current = next
    setPicker(next)
    updateField(field, kind === 'skin' ? skinAt(next.skin) : hsv2hex(...next.hsv))
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId || disabled) return
    const rect = drag.element.getBoundingClientRect()
    if (!rect.width || (drag.kind === 'sv' && !rect.height)) return
    move(drag.kind, drag.tab, clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / (rect.height || 1)))
  }

  function startPointer(kind: DragKind, event: PointerEvent<HTMLDivElement>) {
    if (disabled || dragRef.current || event.button > 0 || event.isPrimary === false) return
    event.preventDefault()
    dragRef.current = { kind, pointerId: event.pointerId, element: event.currentTarget, tab }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    setDragging(kind)
    movePointer(event)
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(null)
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    onCommit?.()
  }

  function keyPick(kind: DragKind, event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const step = event.shiftKey ? 0.1 : 0.01
    let x = kind === 'sv' ? saturation : kind === 'hue' ? hue / 360 : picker.skin
    let y = 1 - value
    if (event.key === 'ArrowLeft') x -= step
    else if (event.key === 'ArrowRight') x += step
    else if (event.key === 'ArrowUp') { if (kind === 'sv') y -= step; else x += step }
    else if (event.key === 'ArrowDown') { if (kind === 'sv') y += step; else x -= step }
    else if (event.key === 'Home') x = 0
    else if (event.key === 'End') x = 1
    else return
    event.preventDefault()
    move(kind, tab, clamp(x), clamp(y))
    onCommit?.()
  }

  function pointerProps(kind: DragKind) {
    return {
      'data-drag': kind,
      tabIndex: disabled ? -1 : 0,
      'aria-disabled': disabled || undefined,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => startPointer(kind, event),
      onPointerMove: movePointer,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
      onLostPointerCapture: finishPointer,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => keyPick(kind, event),
    }
  }

  return <div className="cz-body" data-disabled={disabled || undefined} style={spectrumStyle}>
    <div className="cz-tabs" role="group" aria-label={text('外观颜色', 'Appearance colors')} style={{ '--i': FIELDS.indexOf(tab) } as CSSProperties}>
      <span className="cz-tabs__pill" aria-hidden="true" />
      {FIELDS.map(field => <button type="button" key={field} aria-pressed={field === tab} aria-controls={pickerId} disabled={disabled} onClick={() => selectTab(field)}>{labels[field]}</button>)}
    </div>
    <div id={pickerId} key={tab} className={`cz-picker${swapping ? ' swap' : ''}`} onAnimationEnd={() => setSwapping(false)}>
      {tab === 'skin' ? <div className={`cz-skin${dragging === 'skin' ? ' dragging' : ''}`} role="slider" aria-label={text('肤色带', 'Skin tone')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(picker.skin * 100)} aria-valuetext={color.toUpperCase()} {...pointerProps('skin')}>
        <span className="cz-knob" aria-hidden="true" style={{ left: `${picker.skin * 100}%`, background: color }} />
      </div> : <>
        <div className={`cz-sv${dragging === 'sv' ? ' dragging' : ''}`} role="slider" aria-label={text(`${labels[tab]}饱和度与明度`, `${labels[tab]} saturation and brightness`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(saturation * 100)} aria-valuetext={text(`饱和度 ${Math.round(saturation * 100)}%，明度 ${Math.round(value * 100)}%`, `Saturation ${Math.round(saturation * 100)}%, brightness ${Math.round(value * 100)}%`)} {...pointerProps('sv')}>
          <span className="cz-knob" aria-hidden="true" style={{ left: `${saturation * 100}%`, top: `${(1 - value) * 100}%`, background: color }} />
        </div>
        <div className={`cz-hue${dragging === 'hue' ? ' dragging' : ''}`} role="slider" aria-label={text(`${labels[tab]}色相`, `${labels[tab]} hue`)} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hue)} {...pointerProps('hue')}>
          <span className="cz-knob cz-knob--sm" aria-hidden="true" style={{ left: `${hue / 3.6}%`, background: `hsl(${hue} 62% 58%)` }} />
        </div>
      </>}
      <div className="cz-swatches" role="group" aria-label={text(`${labels[tab]}色块`, `${labels[tab]} swatches`)}>
        <button className="cz-sw cz-sw--reset" type="button" aria-pressed={!changed} aria-label={text('原样', 'Original')} title={text('原样', 'Original')} disabled={disabled} onClick={() => pick(null)} />
        {SWATCH[tab].map(swatch => <button className="cz-sw" type="button" key={swatch} style={{ background: swatch }} aria-pressed={changed && color === swatch} aria-label={swatch} disabled={disabled} onClick={() => pick(swatch)} />)}
      </div>
      <div className="cz-hex"><span aria-hidden="true" style={{ background: color }} /><code>{color.toUpperCase()}</code></div>
    </div>
    <div className="cz-blush"><span>{text('腮红', 'Blush')}</span><button className="cz-switch" type="button" role="switch" aria-label={text('腮红', 'Blush')} aria-checked={custom?.blush !== false} disabled={disabled} onClick={() => {
      const next = { ...customRef.current }
      if (next.blush === false) delete next.blush
      else next.blush = false
      customRef.current = next
      onChange(next)
      onCommit?.()
    }}><i aria-hidden="true" /></button></div>
  </div>
}
