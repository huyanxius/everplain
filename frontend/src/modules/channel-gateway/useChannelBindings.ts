import { useEffect, useRef, useState } from 'react'
import { channelGatewayApi, isSessionFailure, type ChannelBinding, type ChannelGateway, type ChannelGatewayApi, type ChannelGrant } from './channelGatewayApi'

/** Codes live only in this mounted owner view, never in a URL, cache or browser storage. */
export function useChannelBindings(userId: string, api: ChannelGatewayApi = channelGatewayApi) {
  const [gateways, setGateways] = useState<ChannelGateway[]>([])
  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [selected, setSelected] = useState('')
  const [consent, setConsent] = useState(false)
  const [grant, setGrant] = useState<ChannelGrant | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<'load' | 'session' | 'mutation' | 'clipboard' | null>(null)
  const [feedback, setFeedback] = useState<'bound' | 'revoked' | 'cancelled' | 'copied' | 'expired' | null>(null)
  const [now, setNow] = useState(Date.now())
  const lifecycle = useRef({ active: false })
  const operation = useRef<string | null>(null)
  const reads = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const priorBindings = useRef(new Set<string>())

  useEffect(() => {
    const guard = { active: true }
    lifecycle.current = guard
    const activeControllers = controllers.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([api.gateways(controller.signal), api.bindings(controller.signal)])
      .then(([options, rows]) => {
        if (!guard.active) return
        setGateways(options)
        setBindings(rows)
        setSelected(current => options.some(option => option.gateway_id === current) ? current : options[0]?.gateway_id ?? '')
      })
      .catch(failure => { if (guard.active) setError(isSessionFailure(failure) ? 'session' : 'load') })
      .finally(() => { if (guard.active) setLoading(false) })
    return () => {
      guard.active = false
      controller.abort()
      activeControllers.forEach(value => value.abort())
      activeControllers.clear()
    }
  }, [userId, api, reload])

  useEffect(() => {
    if (!grant) return
    let active = true
    const controller = new AbortController()
    const tick = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= grant.expires_at * 1000) {
        setGrant(null)
        setFeedback('expired')
      }
    }, 1000)
    const poll = window.setInterval(() => {
      if (operation.current) return
      const read = ++reads.current
      void api.bindings(controller.signal).then(rows => {
        if (!active || read !== reads.current || Date.now() >= grant.expires_at * 1000) return
        setBindings(rows)
        if (rows.some(row => row.gateway_id === grant.gateway_id && !priorBindings.current.has(row.binding_id))) {
          setGrant(null)
          setFeedback('bound')
        }
      }).catch(failure => {
        if (active && isSessionFailure(failure)) { setGrant(null); setError('session') }
      })
    }, 3000)
    return () => { active = false; controller.abort(); window.clearInterval(tick); window.clearInterval(poll) }
  }, [grant, api])

  async function perform<T>(action: string, task: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
    if (operation.current || loading) return
    operation.current = action
    const guard = lifecycle.current
    const controller = new AbortController()
    controllers.current.add(controller)
    ++reads.current
    setPending(action)
    setError(null)
    setFeedback(null)
    try {
      const result = await task(controller.signal)
      if (guard.active) apply(result)
    } catch (failure) {
      if (guard.active) setError(isSessionFailure(failure) ? 'session' : 'mutation')
    } finally {
      controllers.current.delete(controller)
      operation.current = null
      if (guard.active) setPending(null)
    }
  }

  function choose(value: string) {
    if (operation.current) return
    ++reads.current
    setSelected(value)
    setConsent(false)
    setGrant(null)
    setFeedback(null)
    setError(null)
  }
  function generate() {
    if (!consent || !selected || operation.current) return
    priorBindings.current = new Set(bindings.map(row => row.binding_id))
    void perform('generate', signal => api.createCode(selected, signal), result => { setGrant(result); setNow(Date.now()) })
  }
  function cancelCode() {
    if (!grant) return
    void perform('cancel', signal => api.cancelCode(grant.gateway_id, signal), () => { setGrant(null); setFeedback('cancelled') })
  }
  async function copyCode() {
    if (!grant || Date.now() >= grant.expires_at * 1000) return
    const guard = lifecycle.current
    const read = reads.current
    try {
      await navigator.clipboard.writeText(`/bind ${grant.code}`)
      if (guard.active && read === reads.current) { setFeedback('copied'); setError(null) }
    } catch { if (guard.active) setError('clipboard') }
  }
  function revoke(id: string, done: () => void) {
    const gatewayId = bindings.find(row => row.binding_id === id)?.gateway_id
    void perform('revoke', signal => api.revoke(id, signal), () => {
      setBindings(rows => rows.filter(row => row.binding_id !== id))
      setGrant(current => current?.gateway_id === gatewayId ? null : current)
      setFeedback('revoked')
      done()
    })
  }
  return { gateways, bindings, selected, choose, consent, setConsent, grant, loading, pending, error, feedback,
    remaining: grant ? Math.max(0, Math.ceil((grant.expires_at * 1000 - now) / 1000)) : 0,
    refresh: () => { if (!operation.current) { ++reads.current; setGrant(null); setReload(value => value + 1) } },
    generate, cancelCode, copyCode, revoke }
}
