import type { ReactNode } from 'react'

export function AgentModeSwitch({ mode, disabled, avatar, onChange, children }: {
  mode: 'standard' | 'deep-research'
  disabled: boolean
  avatar: ReactNode
  onChange: (mode: 'standard' | 'deep-research') => void
  children?: ReactNode
}) {
  return <div className="cv-mode-switch">
    <div className="qx-segmented cv-mode-switch__tabs" role="tablist" aria-label="Chat / Research">
      <button type="button" role="tab" aria-label="Chat" aria-selected={mode === 'standard'} disabled={disabled}
        onClick={() => onChange('standard')} onKeyDown={event => {
          if (!disabled && event.key === 'ArrowRight') { event.preventDefault(); onChange('deep-research'); (event.currentTarget.nextElementSibling as HTMLButtonElement)?.focus() }
        }}>{avatar}</button>
      <button type="button" role="tab" aria-label="Research" aria-selected={mode === 'deep-research'} disabled={disabled}
        onClick={() => onChange('deep-research')} onKeyDown={event => {
          if (!disabled && event.key === 'ArrowLeft') { event.preventDefault(); onChange('standard'); (event.currentTarget.previousElementSibling as HTMLButtonElement)?.focus() }
        }}>Research</button>
    </div>
    {children}
  </div>
}
