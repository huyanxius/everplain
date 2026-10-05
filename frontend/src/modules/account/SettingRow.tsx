import type { ReactNode } from 'react'

/** Shared label/control row for all account panels. */
export function SettingRow({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return <div className="ep-setting-row" data-off={muted || undefined}><span className="ep-setting-row__label">{label}</span><div className="ep-setting-row__control">{children}</div></div>
}
