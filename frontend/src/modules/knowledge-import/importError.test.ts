import { expect, it } from 'vitest'
import { importErrorMessage } from './importError'
it('identifies non-JSON HTTP failures without rendering a server HTML page', () => {
  for (const status of [413, 422, 500, 502, 504]) {
    const text = importErrorMessage('<html><script>private marker</script></html>', status)
    expect(text).toContain(`HTTP ${status}`); expect(text).not.toContain('private marker'); expect(text).not.toContain('导入暂时未完成')
  }
})
it('keeps safe application detail and identifies validation fields without echoing their input', () => {
  expect(importErrorMessage({ detail: '存储空间不足' }, 422)).toBe('存储空间不足（HTTP 422）')
  const message = importErrorMessage({ detail: [{ loc: ['body', 'files'], type: 'missing', input: 'synthetic-private-marker' }] }, 422)
  expect(message).toContain('files'); expect(message).not.toContain('synthetic-private-marker')
})
it('preserves a local transport failure and distinguishes expired sessions', () => {
  expect(importErrorMessage(new Error('连接中断'))).toBe('连接中断')
  expect(importErrorMessage('', 401)).toContain('登录已失效')
})
