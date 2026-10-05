import { ApiRequestError } from './error'

export const SESSION_READ_TIMEOUT_MS = 15_000

// Only the cookie-session GET is bounded. Mutations and model streams keep their
// own lifecycle. Race the full SDK read, including the response body, so even a
// transport that ignores abort cannot keep session initialization pending.
export async function readSessionWithDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  lifecycleSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(lifecycleSignal?.reason)
  lifecycleSignal?.addEventListener('abort', cancel, { once: true })
  if (lifecycleSignal?.aborted) cancel()

  let rejectCancelled: (reason: unknown) => void = () => undefined
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
  const onAbort = () => rejectCancelled(controller.signal.reason)
  controller.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(
    new ApiRequestError('登录状态读取超时，请检查网络后重试。'),
  ), SESSION_READ_TIMEOUT_MS)

  try {
    controller.signal.throwIfAborted()
    return await Promise.race([read(controller.signal), cancelled])
  } finally {
    clearTimeout(timer)
    lifecycleSignal?.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
