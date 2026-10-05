import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfile } from '../agent-profile'
import { AvatarPalette, PEOPLE, UserAvatar, type UserAvatarCustom, type UserAvatarId } from '../user-avatar'
import { SettingRow } from './SettingRow'
import './user-avatar-settings.css'

type SavedAvatar = NonNullable<PersonalAgentProfile['user_avatar']>
type Props = { userId: string; active: boolean; text(zh: string, en: string): string }

/** Shares the owner's profile cache with onboarding and the home companion. */
export function UserAvatarSettingsPanel({ userId, active, text }: Props) {
  const client = useQueryClient()
  const key = ['agent-profile', userId] as const
  const profile = useQuery({ queryKey: key, queryFn: readAgentProfile, staleTime: 30_000 })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const desired = useRef<SavedAvatar | null | undefined>(undefined)
  const queued = useRef(false)
  const saving = useRef(false)
  const mounted = useRef(true)
  const last = useRef<SavedAvatar>({ id: 'xiaoping' })
  const figure = useRef<HTMLDivElement>(null)
  function pulse() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !figure.current) return
    figure.current.classList.remove('pulse'); void figure.current.offsetWidth; figure.current.classList.add('pulse')
  }
  const colors = useRef<Partial<Record<UserAvatarId, UserAvatarCustom>>>({})

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; queued.current = false }
  }, [])
  const avatar = profile.data?.user_avatar ?? null
  useEffect(() => {
    if (!avatar) return
    last.current = avatar
    const { id, ...custom } = avatar
    colors.current[id] = custom
  }, [avatar])

  async function persist() {
    if (saving.current || !mounted.current) return
    saving.current = true
    setPending(true)
    setError('')
    try {
      while (queued.current && mounted.current) {
        queued.current = false
        const requested = desired.current ?? null
        const current = client.getQueryData<PersonalAgentProfile>(key)
        if (!current) break
        const saved = await saveAgentProfile({ expected_version: current.version, user_avatar: requested })
        client.setQueryData(key, queued.current && mounted.current ? { ...saved, user_avatar: desired.current ?? null } : saved)
      }
    } catch (failure) {
      queued.current = false
      if (mounted.current) setError(failure instanceof Error ? failure.message : text('形象暂时无法保存，请重试。', 'Could not save your avatar. Try again.'))
      // Keep the draft visible, but refresh the persisted version before an explicit retry.
      const saved = await readAgentProfile().catch(() => null)
      if (saved && mounted.current) client.setQueryData(key, { ...saved, user_avatar: desired.current ?? null })
    } finally {
      saving.current = false
      if (mounted.current) setPending(false)
    }
  }

  function update(next: SavedAvatar | null) {
    desired.current = next
    queued.current = true
    client.setQueryData<PersonalAgentProfile>(key, current => current ? { ...current, user_avatar: next } : current)
    void persist()
  }

  return <div className="ep-avatar-settings" hidden={!active}>
    {profile.isPending ? <p className="qx-meta" role="status">{text('正在读取你的形象…', 'Loading your avatar…')}</p> : profile.isError ? <p className="qx-notice qx-notice--danger" role="alert">{profile.error.message}<button type="button" className="qx-btn qx-btn--ghost" onClick={() => void profile.refetch()}>{text('重试', 'Try again')}</button></p> : <>
      <SettingRow label={text('在右下角显示', 'Show in the bottom-right corner')}><button className="qx-switch" type="button" role="switch" aria-label={text('在右下角显示', 'Show in the bottom-right corner')} aria-checked={Boolean(avatar)} onClick={() => update(avatar ? null : last.current)} /></SettingRow>
      <SettingRow label={text('角色', 'Character')} muted={!avatar}><div className="ep-avatar-settings__people" role="group" aria-label={text('角色', 'Character')}>{PEOPLE.map((person, index) => <button type="button" key={person.id} aria-pressed={avatar?.id === person.id} aria-label={text(`形象 ${index + 1}`, `Avatar ${index + 1}`)} disabled={!avatar} onClick={() => update({ id: person.id, ...colors.current[person.id] })}><UserAvatar id={person.id} custom={avatar?.id === person.id ? avatar : colors.current[person.id]} variant="head" size={64} /></button>)}</div></SettingRow>
      {avatar && <SettingRow label={text('外观', 'Appearance')}><div className="ep-avatar-settings__custom"><div className="cz-fig ep-avatar-settings__figure" ref={figure}><UserAvatar id={avatar.id} custom={avatar} variant="resting" size={140} /></div><AvatarPalette id={avatar.id} custom={avatar} onChange={custom => update({ id: avatar.id, ...custom })} onCommit={pulse} /><button className="qx-btn qx-btn--ghost" type="button" onClick={() => { update({ id: avatar.id }); pulse() }}>{text('恢复原样', 'Restore original')}</button></div></SettingRow>}
      {pending && <p className="qx-meta" role="status">{text('正在保存…', 'Saving…')}</p>}
      {error && <p className="qx-notice qx-notice--danger" role="alert">{error}<button type="button" className="qx-btn qx-btn--ghost" disabled={pending} onClick={() => { queued.current = true; void persist() }}>{text('重试保存', 'Retry saving')}</button></p>}
    </>}
  </div>
}
