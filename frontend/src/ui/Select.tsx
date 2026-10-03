import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent } from 'react'
import './select.css'

export interface SelectOption {
  value: string | number
  label: string
  disabled?: boolean
}

type SelectBaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'value' | 'onChange' | 'onKeyDown' | 'type'> & {
  options: readonly SelectOption[]
  placeholder?: string
  required?: boolean
  validationMessage?: string
}
type SingleSelectProps = SelectBaseProps & { multiple?: false; value: string | number; onChange: (value: string) => void }
type MultipleSelectProps = SelectBaseProps & { multiple: true; value: readonly string[]; onChange: (value: string[]) => void }
export type SelectProps = SingleSelectProps | MultipleSelectProps

/** A controlled, select-only combobox. Values and form submission follow native select conventions. */
export function Select(props: SelectProps) {
  const {
    options, value, multiple = false, onChange: _onChange, placeholder = '请选择',
    required, validationMessage = '请选择一项', disabled, className = '', id: providedId,
    name, form, onClick, onBlur, 'aria-describedby': describedBy, ...buttonProps
  } = props
  const generatedId = useId()
  const id = providedId ?? `qx-select-${generatedId}`
  const listId = `${id}-listbox`
  const errorId = `${id}-error`
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ query: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 })
  const selectedValues = Array.isArray(value) ? value : [String(value)]
  const selected = options.filter(option => selectedValues.includes(String(option.value)))
  const hasValue = multiple ? selected.length > 0 : selected.some(option => String(option.value) !== '')
  const showInvalid = Boolean(invalid && required && !hasValue)
  const expanded = open && !disabled
  const firstEnabled = options.findIndex(option => !option.disabled)
  const lastEnabled = options.findLastIndex(option => !option.disabled)
  const selectedIndex = options.findIndex(option => selectedValues.includes(String(option.value)) && !option.disabled)
  const label = selected.map(option => option.label).join('、') || placeholder

  function close(restoreFocus = false) {
    setOpen(false)
    typeahead.current = { query: '', at: 0 }
    if (restoreFocus) triggerRef.current?.focus()
  }

  function openMenu(preferLast = false) {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : preferLast ? lastEnabled : firstEnabled)
    setOpen(true)
  }

  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled || disabled) return
    const next = String(option.value)
    setInvalid(false)
    if (props.multiple === true) {
      const nextValues = new Set(props.value)
      if (nextValues.has(next)) nextValues.delete(next)
      else nextValues.add(next)
      props.onChange(options.filter(item => nextValues.has(String(item.value))).map(item => String(item.value)))
    } else {
      close(true)
      if (String(props.value) !== next) props.onChange(next)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    if (event.key === 'Tab') { close(); return }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      if (!expanded) {
        openMenu(event.key === 'ArrowUp' || event.key === 'End')
        if (event.key === 'Home') setActiveIndex(firstEnabled)
        if (event.key === 'End') setActiveIndex(lastEnabled)
        return
      }
      if (event.key === 'Home') { setActiveIndex(firstEnabled); return }
      if (event.key === 'End') { setActiveIndex(lastEnabled); return }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      for (let step = 1; step <= options.length; step += 1) {
        const index = (activeIndex + direction * step + options.length) % options.length
        if (!options[index].disabled) { setActiveIndex(index); break }
      }
      return
    }
    if (event.key === 'Enter' || (event.key === ' ' && (!typeahead.current.query || Date.now() - typeahead.current.at >= 700))) {
      event.preventDefault()
      event.stopPropagation()
      if (expanded) choose(activeIndex)
      else openMenu()
      return
    }
    if (event.key.length !== 1 || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    const now = Date.now()
    const previous = now - typeahead.current.at < 700 ? typeahead.current.query : ''
    const query = `${previous}${event.key}`.toLocaleLowerCase()
    typeahead.current = { query, at: now }
    const repeated = [...query].every(character => character === query[0])
    const match = repeated ? query[0] : query
    const start = repeated ? expanded ? activeIndex : selectedIndex : -1
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + step + options.length) % options.length
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(match)) {
        setActiveIndex(index)
        setOpen(true)
        break
      }
    }
  }

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (expanded && (!options[activeIndex] || options[activeIndex].disabled)) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled)
    }
  }, [expanded, activeIndex, options, selectedIndex, firstEnabled])
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])

  useLayoutEffect(() => {
    if (!expanded) return
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    menu.showPopover?.()
    const viewport = window.visualViewport
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect()
      const gutter = 12, gap = 8
      const viewportLeft = (viewport?.offsetLeft ?? 0) + gutter
      const viewportTop = (viewport?.offsetTop ?? 0) + gutter
      const viewportRight = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - gutter
      const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - gutter
      const width = Math.max(0, Math.min(Math.max(rect.width, 240), viewportRight - viewportLeft))
      menu.style.width = `${width}px`
      const below = Math.max(0, viewportBottom - Math.max(rect.bottom + gap, viewportTop))
      const above = Math.max(0, Math.min(rect.top - gap, viewportBottom) - viewportTop)
      const upwards = below < Math.min(menu.scrollHeight, 240) && above > below
      const maxHeight = Math.min(320, upwards ? above : below)
      const height = Math.min(menu.scrollHeight, maxHeight)
      const top = upwards ? rect.top - gap - height : rect.bottom + gap
      setPosition({
        left: Math.max(viewportLeft, Math.min(rect.left, viewportRight - width)),
        top: Math.max(viewportTop, Math.min(top, viewportBottom - height)),
        width, maxHeight,
      })
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(trigger)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    viewport?.addEventListener('resize', updatePosition)
    viewport?.addEventListener('scroll', updatePosition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      viewport?.removeEventListener('resize', updatePosition)
      viewport?.removeEventListener('scroll', updatePosition)
      menu.hidePopover?.()
    }
  }, [expanded, options.length])

  useLayoutEffect(() => {
    const menu = menuRef.current
    const active = document.getElementById(`${listId}-${activeIndex}`)
    if (!expanded || !menu || !active) return
    // Scroll only the menu: scrolling the page would move the trigger under the keyboard.
    const menuBounds = menu.getBoundingClientRect()
    const activeBounds = active.getBoundingClientRect()
    if (activeBounds.top < menuBounds.top) menu.scrollTop -= menuBounds.top - activeBounds.top
    else if (activeBounds.bottom > menuBounds.bottom) menu.scrollTop += activeBounds.bottom - menuBounds.bottom
  }, [expanded, activeIndex, listId, position.maxHeight, position.width])

  return <span ref={rootRef} className="qx-select">
    <button {...buttonProps} ref={triggerRef} id={id} type="button" role="combobox"
      className={`qx-input qx-select__trigger ${className}`.trim()} disabled={disabled} value={multiple ? undefined : String(value)}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && activeIndex >= 0 && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      aria-required={required || undefined} aria-invalid={showInvalid || buttonProps['aria-invalid']}
      aria-describedby={[describedBy, showInvalid ? errorId : ''].filter(Boolean).join(' ') || undefined}
      onKeyDown={handleKeyDown}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (expanded) close(); else openMenu() } }}
      onBlur={event => { onBlur?.(event); if (!rootRef.current?.contains(event.relatedTarget as Node)) close() }}>
      <span className="qx-select__value" title={label}>{label}</span><CaretDownIcon aria-hidden="true" size={16} />
    </button>
    {(required || name) ? <input className="qx-select__validation" tabIndex={-1} aria-hidden="true"
      name={multiple ? undefined : name} form={form} disabled={disabled} required={required}
      value={multiple ? (hasValue ? 'selected' : '') : selected.length ? String(value) : ''} onChange={() => {}}
      onInvalid={event => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus() }} /> : null}
    {multiple && name ? selectedValues.map(item => <input key={item} type="hidden" name={name} form={form} value={item} disabled={disabled} />) : null}
    {showInvalid ? <span id={errorId} className="qx-select__error" role="alert">{validationMessage}</span> : null}
    {expanded ? <div ref={menuRef} id={listId} className="qx-select__menu" popover="manual" role="listbox"
      aria-labelledby={id} aria-multiselectable={multiple || undefined} style={position}>
      {options.map((option, index) => <div id={`${listId}-${index}`} key={String(option.value)} role="option"
        aria-selected={selectedValues.includes(String(option.value))} aria-disabled={option.disabled || undefined}
        className="qx-select__option" data-active={index === activeIndex || undefined}
        onPointerMove={() => { if (!option.disabled) setActiveIndex(index) }}
        onMouseDown={event => event.preventDefault()}
        onClick={event => { event.preventDefault(); choose(index) }}>
        <span>{option.label}</span><CheckIcon size={16} aria-hidden="true" className="qx-select__check" />
      </div>)}
    </div> : null}
  </span>
}
