import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { findBoundaryViolations } from './check-module-boundaries.mjs'

const roots = []
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true })))
})

const adapters = {
  appApiAdapters: ['api/system.ts'],
  generatedApiAdapters: [
    'api/client.ts',
    'modules/alpha/researchTaskApi.ts',
  ],
  httpRuntimeAdapters: ['api/client.ts'],
  moduleApiAdapters: ['modules/alpha/researchTaskApi.ts'],
}

async function check(files, moduleDependencies, policy = adapters) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'qunxue-boundaries-'))
  roots.push(temporary)
  const sourceRoot = path.join(temporary, 'src')
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(sourceRoot, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }
  return findBoundaryViolations({
    sourceRoot,
    policy: { ...policy, moduleDependencies },
  })
}

test('reports the six confirmed boundary rule families', async () => {
  const violations = await check(
    {
      'api/client.ts': `
        import { client } from './generated/client.gen.js'
        export const apiClient = client
        export const request = (input) => globalThis.fetch(input)
      `,
      'api/generated/client.gen.ts': 'export const client = {}',
      'api/generated/index.ts': `
        export interface Dto { readonly task_id: string }
        export const create = () => undefined
        export { privateValue } from '../../modules/alpha/private.js'
      `,
      'api/system.ts': `
        import { create, type Dto } from './generated/index.js'
        export { privateValue } from '../modules/alpha/private.js'
        const firstSystemValue = create
        export const secondSystemValue = firstSystemValue
        type FirstSystemType = Dto
        export type SecondSystemType = FirstSystemType
      `,
      'app/App.tsx': `
        import { privateValue } from '../modules/alpha/private.js'
        import { apiClient } from '../api/client.js'
        export const App = () => [privateValue, apiClient]
      `,
      'modules/alpha/index.ts': `
        import { load } from './researchTaskApi.js'
        export const wrapped = () => load()
        export { secondValue } from './researchTaskApi.js'
        export type { SecondType } from './researchTaskApi.js'
      `,
      'modules/alpha/private.ts': 'export const privateValue = true',
      'modules/alpha/researchTaskApi.ts': `
        import { create, type Dto } from '../../api/generated/index.js'
        const firstValue = create
        const secondValue = firstValue
        type FirstType = Dto
        export type SecondType = FirstType
        export { secondValue }
        export const load = () => create()
      `,
      'modules/alpha/View.tsx': `
        import axios from 'axios'
        import { Link } from 'react-router'
        const model = import('openai')
        window.fetch('/api/research-tasks')
        window.location.href = '/research/next'
        globalThis.history.pushState({}, '', '/research/final')
        export const View = () => [axios, Link, model]
      `,
      'modules/beta/Consumer.ts': `
        import { privateValue } from '../alpha/private.js'
        export type LeakedDto = import('../../api/generated/index.js').Dto
        export { privateValue }
      `,
      'modules/beta/index.ts': 'export const beta = true',
      'modules/beta/researchTaskApi.tsx':
        "import { create } from '../../api/generated/index.js'",
      'modules/delta/index.ts': 'export const delta = true',
      'modules/gamma/View.tsx': 'export const View = () => null',
    },
    { alpha: [], beta: ['alpha'], gamma: [] },
  )

  const expected = [
    'delta is missing an allowed dependency declaration',
    'gamma has no public index.ts',
    'app/App.tsx bypasses alpha/index.ts',
    'app/App.tsx imports API internals instead of an approved app adapter',
    'api/generated/index.ts imports outside the generated API layer',
    'api/system.ts imports product module code from the API layer',
    'api/system.ts re-exports raw generated API value secondSystemValue',
    'api/system.ts re-exports raw generated API type SecondSystemType',
    'modules/beta/Consumer.ts bypasses alpha/index.ts',
    'modules/beta/Consumer.ts imports generated API outside an approved adapter',
    'modules/beta/researchTaskApi.tsx imports generated API outside an approved adapter',
    'modules/alpha/View.tsx imports axios as a direct HTTP client',
    'modules/alpha/View.tsx imports openai as a model SDK',
    'modules/alpha/View.tsx imports routing in a product module',
    'modules/alpha/View.tsx uses HTTP outside the runtime adapter',
    'modules/alpha/View.tsx uses browser routing APIs in a product module',
    'modules/alpha/researchTaskApi.ts re-exports raw generated API value secondValue',
    'modules/alpha/researchTaskApi.ts re-exports raw generated API type SecondType',
    'modules/alpha/index.ts exports module adapter value secondValue',
    'modules/alpha/index.ts exports module adapter type SecondType',
    'modules/alpha/index.ts imports module adapter from its public index',
  ]
  for (const message of expected) {
    assert.ok(violations.includes(message), `${message}\n\n${violations.join('\n')}`)
  }
})

test('allows mapped adapters and ignores comments, strings, URLs, and local names', async () => {
  const violations = await check(
    {
      'api/client.ts': `
        import { client } from './generated/client.gen.js'
        client.setConfig({ fetch: (request) => globalThis.fetch(request) })
        export const apiClient = client
      `,
      'api/generated/client.gen.ts':
        'export const client = { setConfig: (_value) => undefined }',
      'api/generated/index.ts': `
        export interface Dto { readonly task_id: string }
        export const create = () => ({ task_id: 'task-1' })
      `,
      'api/system.ts': 'export const getSystemHealth = () => ({ status: "ok" })',
      'app/App.tsx': `
        import { start } from '../modules/alpha/index.js'
        import { getSystemHealth } from '../api/system.js'
        export const App = () => [start, getSystemHealth]
      `,
      'modules/alpha/index.ts': `
        export { start } from './start.js'
        export type { Task } from './model.js'
      `,
      'modules/alpha/model.ts':
        'export interface Task { readonly taskId: string }',
      'modules/alpha/researchTaskApi.ts': `
        import { apiClient } from '../../api/client.js'
        import { create, type Dto } from '../../api/generated/index.js'
        export function load() {
          const dto: Dto = create()
          return { taskId: dto.task_id, clientReady: Boolean(apiClient) }
        }
      `,
      'modules/alpha/start.ts': `
        import { load } from './researchTaskApi.js'
        export function start() { return load() }
      `,
      'modules/alpha/View.tsx': `
        // window.fetch('/api/research-tasks')
        /* import OpenAI from 'openai' */
        const example = "window.location.href = '/research/example'"
        const url = new URL('/research/task', 'https://example.test')
        const location = { pathname: '/local' }
        const history = { pushState: () => undefined }
        const inspect = (window, document, globalThis) => [
          window.location.pathname,
          document.location.pathname,
          globalThis.history.pushState,
        ]
        history.pushState()
        export const safe = [example, url.pathname, location.pathname, inspect]
      `,
    },
    { alpha: [] },
  )

  assert.deepEqual(violations, [])
})

test('allows a generated-only module adapter without opening other API internals', async () => {
  const policy = {
    appApiAdapters: [],
    generatedApiAdapters: ['modules/graph/knowledgeGraphAdapter.ts'],
    httpRuntimeAdapters: [],
    moduleApiAdapters: [],
  }
  const sharedFiles = {
    'api/generated/index.ts':
      'export interface KnowledgeDto { readonly knowledge_id: string }',
    'modules/graph/index.ts': 'export {}',
    'modules/graph/knowledgeGraphAdapter.ts': `
      import type { KnowledgeDto } from '../../api/generated/index.js'
      export const toId = (entry: KnowledgeDto) => entry.knowledge_id
    `,
  }

  assert.deepEqual(
    await check(sharedFiles, { graph: [] }, policy),
    [],
  )

  const violations = await check(
    {
      ...sharedFiles,
      'api/client.ts': 'export const apiClient = {}',
      'modules/graph/knowledgeGraphAdapter.ts': `
        import type { KnowledgeDto } from '../../api/generated/index.js'
        import { apiClient } from '../../api/client.js'
        export const toId = (entry: KnowledgeDto) => [entry.knowledge_id, apiClient]
      `,
    },
    { graph: [] },
    policy,
  )

  assert.ok(
    violations.includes(
      'modules/graph/knowledgeGraphAdapter.ts imports API internals outside its module adapter',
    ),
    violations.join('\n'),
  )
})

test('keeps the research materials adapter behind the generated API boundary', async () => {
  const violations = await findBoundaryViolations()
  const researchMaterialViolations = violations.filter((message) =>
    message.includes('research-materials'),
  )

  assert.deepEqual(
    researchMaterialViolations,
    [],
    `research materials must use the generated SDK and a declared module boundary:\n${researchMaterialViolations.join('\n')}`,
  )
})

test('rejects unknown source buckets, unresolved dynamic imports and shared backdoors', async () => {
  const violations = await check({
    'modules/alpha/index.ts': 'export {}',
    'app/secret.ts': 'export const secret = 1',
    'unregistered/bridge.ts': "export { secret } from '../app/secret'",
    'ui/bridge.ts': "export { secret } from '../app/secret'",
    'modules/alpha/load.ts': 'export const load = (name) => import(name)',
  }, { alpha: [] })
  for (const expected of [
    'unregistered/bridge.ts is not in a registered source bucket',
    'ui/bridge.ts imports app code through a shared source bucket',
    'modules/alpha/load.ts has an unresolved dynamic import',
  ]) assert.ok(violations.includes(expected), violations.join('\n'))
})

test('rejects stale adapter permissions', async () => {
  const violations = await check({ 'modules/alpha/index.ts': 'export {}' }, { alpha: [] }, {
    appApiAdapters: [], generatedApiAdapters: [], moduleApiAdapters: [],
    httpRuntimeAdapters: ['api/deleted.ts'],
  })
  assert.ok(violations.includes('api/deleted.ts is registered in httpRuntimeAdapters but does not exist'))
})

test('rejects a cycle even when every cross-module edge is allowed', async () => {
  const violations = await check({
    'modules/alpha/index.ts': "export { beta } from '../beta'",
    'modules/beta/index.ts': "export { alpha } from '../alpha'",
  }, { alpha: ['beta'], beta: ['alpha'] }, {
    appApiAdapters: [], generatedApiAdapters: [], moduleApiAdapters: [], httpRuntimeAdapters: [],
  })
  assert.ok(violations.includes('product module dependency cycle (SCC): alpha, beta'), violations.join('\n'))
})


test('JavaScript files cannot bypass the source or HTTP guard', async () => {
  const violations = await check({
    'modules/alpha/index.ts': 'export {}',
    'new-bucket/hidden.js': "fetch('/api/private')",
  }, { alpha: [] }, {
    appApiAdapters: [], generatedApiAdapters: [], moduleApiAdapters: [], httpRuntimeAdapters: [],
  })
  assert.ok(violations.includes('new-bucket/hidden.js is not in a registered source bucket'))
  assert.ok(violations.includes('new-bucket/hidden.js uses HTTP outside the runtime adapter'))
})


test('configured aliases and files outside src cannot hide an app dependency', async () => {
  const violations = await check({
    '../tsconfig.app.json': JSON.stringify({ compilerOptions: {
      baseUrl: '.', paths: { '@escape/*': ['src/app/*'] },
    } }),
    '../bridge.ts': 'export const bridge = true',
    'app/secret.ts': 'export const secret = true',
    'modules/alpha/index.ts': 'export {}',
    'modules/alpha/consumer.ts': `
      import { secret } from '@escape/secret'
      import { bridge } from '../../../bridge'
      export const value = [secret, bridge]
    `,
  }, { alpha: [] }, {
    appApiAdapters: [], generatedApiAdapters: [], moduleApiAdapters: [], httpRuntimeAdapters: [],
  })
  assert.ok(violations.includes('modules/alpha/consumer.ts imports app code'))
  assert.ok(violations.includes('modules/alpha/consumer.ts imports local source outside the registered source root'))
})


const noAdapters = {
  appApiAdapters: [], generatedApiAdapters: [], moduleApiAdapters: [], httpRuntimeAdapters: [],
}

test('unowned modules-root source cannot bridge app or cross-module dependencies', async () => {
  const violations = await check({
    'modules/alpha/index.ts': "export { beta } from '../bridge'; export const alpha = 1",
    'modules/bridge.ts': "export { beta } from './beta'; export { secret } from '../app/secret'",
    'modules/beta/index.ts': "import { alpha } from '../alpha'; export const beta = () => alpha",
    'app/secret.ts': 'export const secret = 1',
  }, { alpha: [], beta: ['alpha'] }, noAdapters)
  assert.ok(violations.includes('modules/bridge.ts is not inside a declared product module'))
})

test('the composition entry cannot become a reverse-import bridge', async () => {
  const violations = await check({
    'modules/alpha/index.ts': "export { secret } from '../../main'",
    'main.tsx': "export { secret } from './app/secret'",
    'app/secret.ts': 'export const secret = 1',
  }, { alpha: [] }, noAdapters)
  assert.ok(violations.includes('modules/alpha/index.ts imports the application composition entry'))
})

test('import-equals declarations contribute type and value dependency edges', async () => {
  const violations = await check({
    'modules/alpha/index.ts': 'export {}',
    'modules/alpha/types.d.ts': "import type Secret = require('../../app/secret'); export type Value = Secret.Value",
    'modules/alpha/loader.cts': "import secret = require('../../app/secret'); export const value = secret.value",
    'app/secret.ts': 'export interface Value { id: string }; export const value = 1',
  }, { alpha: [] }, noAdapters)
  assert.ok(violations.includes('modules/alpha/types.d.ts imports app code'))
  assert.ok(violations.includes('modules/alpha/loader.cts imports app code'))
})
