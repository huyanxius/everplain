import { GlobeIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { siteIconUrl } from './siteIconUrl'
import './site-icon.css'

export function SiteIcon({ url, fallback }: { url?: string | null; fallback?: ReactNode }) {
  const { text } = useAppLocale()
  const src = siteIconUrl({ url })
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || src === failedSrc) return fallback ?? <GlobeIcon className="ep-site-icon" aria-hidden="true" />
  return <img className="ep-site-icon" src={src} alt={text('站点图标', 'Site icon')} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
}
