import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'

export function Pile({ kind, open, onToggle, cover, items }: { kind: 'hand' | 'deck'; open: boolean; onToggle(next: boolean): void; cover?: ReactNode; items: { id: string; href: string; body: ReactNode; label?: string }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onToggle(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggle(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open, onToggle])
  const layers = cover ? 1 : 0
  return (
    <div ref={ref} className="hm-pile" data-kind={kind} data-open={open} style={{ '--n': items.length } as CSSProperties}
      onClickCapture={e => { if (!open) { e.preventDefault(); e.stopPropagation(); onToggle(true) } }}>
      {!open && <button type="button" className="hm-pile__trigger" aria-label={kind === 'hand' ? '展开研究' : '展开资料'} onClick={() => onToggle(true)} />}
      {cover ? <div className="hm-pc hm-pc--cover" style={{ '--d': 0, '--i': 0 } as CSSProperties}>{cover}</div> : null}
      {items.map((it, i) => (
        <Link key={it.id} className="qx-card qx-card--interactive hm-pc" aria-label={it.label} to={it.href} tabIndex={open ? 0 : -1} data-depth={Math.min(i + layers, 3)}
          style={{ '--d': Math.min(i + layers, 2), '--i': i } as CSSProperties}>{it.body}</Link>
      ))}
    </div>
  )
}
