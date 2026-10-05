import { expect, test } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'

async function owner(context) {
  const created = await context.request.post('/api/session/register', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { email: `gateway-${randomUUID()}@example.test`, password: 'synthetic-browser-password' },
  })
  expect(created.status()).toBe(201)
  const profile = await (await context.request.get('/api/agent-profile')).json()
  expect((await context.request.patch('/api/agent-profile', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { expected_version: profile.version, setup_completed: true, setup_step: 4 },
  })).ok()).toBeTruthy()
}
async function channels(page, mobile = false) {
  await page.goto('/settings')
  if (mobile) {
    await page.getByRole('combobox', { name: '设置分类' }).click()
    await page.getByRole('option', { name: '聊天平台', exact: true }).click()
  } else {
    await page.getByRole('navigation', { name: '账户设置分区' }).getByRole('button', { name: '聊天平台', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '生成一次性绑定码' })).toBeVisible()
  await page.getByRole('combobox', { name: '选择机器人' }).click()
  await page.getByRole('option', { name: 'Telegram 本地验收', exact: true }).click()
}
async function telegram(request, subject, updateId, text) {
  return request.post('http://127.0.0.1:18592/webhooks/telegram', {
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'fixture_'.repeat(6) },
    data: { update_id: updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000),
      from: { id: subject, is_bot: false, first_name: 'Fixture' }, chat: { id: subject, type: 'private' }, text } },
  })
}
test.beforeEach(async ({ page, context }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await owner(context)
})

test('owner creates a one-time grant, real HTTP binds it, then confirmed revoke stops access', async ({ page, request, context }) => {
  await channels(page)
  const generate = page.getByRole('button', { name: '生成一次性绑定码' })
  await expect(generate).toBeDisabled()
  await page.getByRole('checkbox').check()
  await generate.click()
  const command = await page.getByLabel('一次性绑定命令').inputValue()
  const subject = randomInt(100000, 900000)
  expect((await telegram(request, subject, randomInt(1000000, 2000000), command)).ok()).toBeTruthy()
  await expect(page.getByRole('status')).toContainText('已确认绑定成功')
  await expect(page.getByLabel('一次性绑定命令')).toHaveCount(0)
  const row = page.getByRole('region', { name: '已绑定账号' })
  await expect(row).toContainText(String(subject))
  await row.getByRole('button', { name: '解除绑定', exact: true }).click()
  const confirmation = page.getByRole('group', { name: '确认解除绑定' })
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(row.getByRole('button', { name: '解除绑定', exact: true })).toBeFocused()
  await row.getByRole('button', { name: '解除绑定', exact: true }).click()
  await page.getByRole('button', { name: '确认解除', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已解除绑定')
  expect(await (await context.request.get('/api/channels/bindings')).json()).toEqual([])
})

test('cancelled code cannot bind and mobile layout keeps command and controls inside the viewport', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await channels(page, true)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '生成一次性绑定码' }).click()
  const command = await page.getByLabel('一次性绑定命令').inputValue()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: '作废绑定码' }).click()
  await expect(page.getByRole('status')).toContainText('绑定码已作废')
  expect((await telegram(request, randomInt(100000, 900000), randomInt(2000000, 3000000), command)).ok()).toBeTruthy()
  await expect(page.getByRole('region', { name: '已绑定账号' })).toContainText('还没有绑定')
})

test('closing settings while code generation is delayed does not reopen or reveal the late capability', async ({ page }) => {
  await channels(page)
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/channels/link-codes', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    await gate
    await route.fulfill({ response }).catch(() => {})
  })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '生成一次性绑定码' }).click()
  await expect(page.getByRole('button', { name: '正在生成…' })).toBeVisible()
  await page.getByRole('button', { name: '关闭账户设置' }).click()
  release()
  await expect(page.getByRole('dialog', { name: '账户设置' })).toHaveCount(0)
  await page.unroute('**/api/channels/link-codes')
  await channels(page)
  await expect(page.getByLabel('一次性绑定命令')).toHaveCount(0)
})
