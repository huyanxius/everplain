import { useEffect, useState } from 'react'
import { Companion } from '../../modules/companion'
import './home-companion.css'

/** Mounted above the route outlet so leaving home can finish its 450ms animation. */
export function HomeCompanion({ active }: { active: boolean }) {
  const [present, setPresent] = useState(active)
  useEffect(() => {
    if (active) { setPresent(true); return }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setPresent(false); return }
    const timer = window.setTimeout(() => setPresent(false), 450)
    return () => window.clearTimeout(timer)
  }, [active])
  if (!active && !present) return null
  return <div className="hm-companion" data-away={!active} aria-hidden={!active} inert={!active}><Companion size={150} /></div>
}
