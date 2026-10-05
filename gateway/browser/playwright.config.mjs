import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const directory = mkdtempSync(join(tmpdir(), 'everplain-gateway-browser-'))
const env = {
  ...process.env,
  EVERPLAIN_GATEWAY_CONTRACT_TEST: '1',
  EVERPLAIN_DATABASE_URL: `sqlite:///${join(directory, 'backend.db')}`,
  FIXTURE_BACKEND_PORT: '18591', FIXTURE_GATEWAY_PORT: '18592',
  FIXTURE_GATEWAY_DATABASE: join(directory, 'gateway.db'),
  PYTHONPATH: join(root, 'backend/src'),
}
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 15000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:18593', browserName: 'chromium',
    screenshot: 'off', trace: 'off', video: 'off' },
  webServer: [
    { command: `${join(root, 'backend/.venv/bin/python')} ${join(root, 'gateway/integration/backend_fixture.py')}`,
      cwd: join(root, 'backend'), env, url: 'http://127.0.0.1:18591/__fixture/state', timeout: 90000, reuseExistingServer: false },
    { command: `${join(root, 'gateway/.venv/bin/python')} ${join(root, 'gateway/integration/gateway_fixture.py')}`,
      cwd: root, env, url: 'http://127.0.0.1:18592/health', timeout: 90000, reuseExistingServer: false },
    { command: 'npm run dev -- --host 127.0.0.1 --port 18593', cwd: join(root, 'frontend'),
      env: { ...env, VITE_API_PROXY_TARGET: 'http://127.0.0.1:18591' },
      url: 'http://127.0.0.1:18593', timeout: 90000, reuseExistingServer: false },
  ],
})
