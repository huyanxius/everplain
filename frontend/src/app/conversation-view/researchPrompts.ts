import { useEffect, useState } from 'react'
import type { AppLocale } from '../i18n/AppLocaleProvider'

type Daypart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'
// Only user-selected copy is enabled. Verse excerpt: 李涉《题鹤林寺僧舍》。
const hello = { zh: '来啦。', en: 'Oh, hello.' }
const chance = { zh: '这么巧，你也在。', en: 'Fancy meeting you here.' }
const waiting = { zh: '恭候多时。', en: 'At your service.' }
const returningGreetings = [
  { zh: '你回来啦。', en: 'There you are again.' },
  { zh: '别来无恙。', en: 'Good to see you again.' },
]
export const conversationGreetingPresets: Record<Daypart, readonly { zh: string; en: string }[]> = {
  morning: [{ zh: '太阳已到岗。', en: 'The sun has clocked in.' }, hello, chance, waiting],
  noon: [{ zh: '偷得浮生半日闲。', en: 'A little pause in a busy day.' }, hello, chance, waiting],
  afternoon: [hello, chance, waiting],
  evening: [{ zh: '今晚我值班。', en: 'I am on duty tonight.' }, hello, chance, waiting],
  night: [
    { zh: '月亮值班中。', en: 'The moon is on duty.' },
    { zh: '夜猫子，集合。', en: 'Night owls, assemble.' },
    { zh: '今晚我值班。', en: 'I am on duty tonight.' },
    waiting,
  ],
}

export function conversationDaypart(date: Date): Daypart {
  const hour = date.getHours()
  if (hour >= 6 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

export function conversationGreeting(locale: AppLocale, date: Date, hasHistory = false): string {
  const pool = conversationGreetingPresets[conversationDaypart(date)]
  const choices = hasHistory ? [...pool, ...returningGreetings] : pool
  // The browser's local calendar date stays stable across renders and reloads.
  const day = date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate()
  const selected = choices[day % choices.length]
  return locale === 'en-US' ? selected.en : selected.zh
}

export function useConversationGreeting(locale: AppLocale, hasHistory = false, owner?: string | null, historyReady = true): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const current = new Date()
      setNow(current)
      const next = new Date(current)
      next.setHours([6, 11, 14, 18, 23, 24].find(hour => hour > current.getHours())!, 0, 0, 0)
      timer = setTimeout(refresh, next.getTime() - current.getTime())
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  // Pair home and new-conversation entry points within the same browser session.
  // Late history responses must not switch an already displayed greeting.
  if (!owner) return conversationGreeting(locale, now, hasHistory)
  const key = `everplain.greeting.v1.${encodeURIComponent(owner)}`
  const period = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}.${conversationDaypart(now)}`
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    const history = saved?.period === period && typeof saved.history === 'boolean' ? saved.history : hasHistory
    if (historyReady) sessionStorage.setItem(key, JSON.stringify({ period, history }))
    return conversationGreeting(locale, now, history)
  } catch { return conversationGreeting(locale, now, false) }
}
