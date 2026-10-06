import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptPath = fileURLToPath(import.meta.url)
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), '../src')

/** Every module is declared, even when it has no dependencies. */
export const defaultBoundaryPolicy = Object.freeze({
  moduleDependencies: Object.freeze({
    account: Object.freeze(['agent-avatar', 'agent-profile', 'user-avatar', 'channel-gateway']),
    'api-costs': Object.freeze([]),
    'agent-avatar': Object.freeze([]),
    'channel-gateway': Object.freeze([]),
    writing: Object.freeze([]),
    'shared-editor': Object.freeze([]),
    companion: Object.freeze([]),
    'agent-profile': Object.freeze([]),
    'user-avatar': Object.freeze(['companion']),
    'knowledge-import': Object.freeze([]),
    'personal-graph': Object.freeze([]),
    'product-integrations': Object.freeze([]),
    'product-docs': Object.freeze([]),
    'knowledge-graph': Object.freeze([]),
    'knowledge-explorer': Object.freeze([]),
    'm4-theory-judgment': Object.freeze([]),
    'research-agent': Object.freeze([]),
    'research-document': Object.freeze([]),
    'research-exchange': Object.freeze([]),
    'research-materials': Object.freeze([]),
    'shared-knowledge': Object.freeze([]),
    'research-method': Object.freeze([]),
    'research-memory': Object.freeze([]),
    'research-projects': Object.freeze([]),
    'research-workspace': Object.freeze(['research-agent']),
    'socio-match-workspace': Object.freeze([]),
  }),
  generatedApiAdapters: Object.freeze([
    'api/client.ts',
    'api/m5ResearchDelivery.ts',
    'api/researchWorkspace.ts',
    'api/system.ts',
    'modules/account/accountApi.ts',
    'modules/api-costs/apiCostsApi.ts',
    'modules/agent-profile/agentProfileApi.ts',
    'modules/channel-gateway/channelGatewayApi.ts',
    'modules/writing/writingApi.ts',
    'modules/knowledge-import/knowledgeImportApi.ts',
    'modules/personal-graph/personalGraphApi.ts',
    'modules/product-integrations/productIntegrationsApi.ts',
    'modules/product-docs/productCatalogApi.ts',
    'modules/knowledge-graph/knowledgeGraphAdapter.ts',
    'modules/knowledge-graph/knowledgeGraphApi.ts',
    'modules/knowledge-explorer/knowledgeApi.ts',
    'modules/m4-theory-judgment/m4TheoryJudgmentApi.ts',
    'modules/research-agent/researchAgentApi.ts',
    'modules/research-exchange/researchExchangeApi.ts',
    'modules/research-materials/professionalMaterialsApi.ts',
    'modules/research-materials/researchAnalysisApi.ts',
    'modules/research-materials/researchMaterialsApi.ts',
    'modules/shared-knowledge/sharedKnowledgeApi.ts',
    'modules/research-method/researchMethodApi.ts',
    'modules/research-memory/memoryApi.ts',
    'modules/research-projects/projectApi.ts',
    'modules/socio-match-workspace/researchTaskApi.ts',
  ]),
  moduleApiAdapters: Object.freeze([
    'modules/account/accountApi.ts',
    'modules/api-costs/apiCostsApi.ts',
    'modules/agent-profile/agentProfileApi.ts',
    'modules/channel-gateway/channelGatewayApi.ts',
    'modules/writing/writingApi.ts',
    'modules/knowledge-import/knowledgeImportApi.ts',
    'modules/personal-graph/personalGraphApi.ts',
    'modules/product-integrations/productIntegrationsApi.ts',
    'modules/product-docs/productCatalogApi.ts',
    'modules/account/accountManagementApi.ts',
    'modules/knowledge-graph/knowledgeGraphApi.ts',
    'modules/knowledge-explorer/knowledgeApi.ts',
    'modules/m4-theory-judgment/m4TheoryJudgmentApi.ts',
    'modules/research-agent/researchAgentApi.ts',
    'modules/research-exchange/researchExchangeApi.ts',
    'modules/research-materials/professionalMaterialsApi.ts',
    'modules/research-materials/researchAnalysisApi.ts',
    'modules/research-materials/researchMaterialsApi.ts',
    'modules/shared-knowledge/sharedKnowledgeApi.ts',
    'modules/research-method/researchMethodApi.ts',
    'modules/research-memory/memoryApi.ts',
    'modules/research-projects/projectApi.ts',
    'modules/socio-match-workspace/researchTaskApi.ts',
  ]),
  appApiAdapters: Object.freeze([
    'api/m5ResearchDelivery.ts',
    'api/researchWorkspace.ts',
    'api/system.ts',
  ]),
  httpRuntimeAdapters: Object.freeze(['api/client.ts', 'modules/research-agent/researchAgentApi.ts']),
})

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
const sourceBuckets = new Set(['app', 'api', 'modules', 'ui', 'styles', 'i18n', 'design-system', 'test'])
const sourceEntries = new Set(['main.tsx', 'citeproc.d.ts'])
const sharedBuckets = new Set(['ui', 'styles', 'i18n', 'design-system'])
const isTestSource = (relative) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative) || relative.startsWith('test/')
const httpPackages = ['axios', 'got', 'ky', 'ofetch', 'superagent', 'undici']
const modelPackages = [
  '@ai-sdk', '@anthropic-ai/sdk', '@aws-sdk/client-bedrock-runtime',
  '@azure/openai', '@google/generative-ai', '@google/genai', '@langchain',
  '@mistralai/mistralai', 'ai', 'cohere-ai', 'groq-sdk', 'langchain',
  'ollama', 'openai', 'replicate',
]
const routerPackages = ['react-router', 'react-router-dom']
const httpCalls = new Set([
  'fetch', 'globalThis.fetch', 'navigator.sendBeacon', 'self.fetch', 'window.fetch',
])

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(target)
      return sourceExtension.test(entry.name) ? [target] : []
    }),
  )
  return nested.flat()
}

async function moduleDirectories(modulesRoot) {
  return (await readdir(modulesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const exactPaths = (root, entries) =>
  new Set(entries.map((entry) => path.resolve(root, entry)))

function moduleNameFor(target, modulesRoot, moduleNames) {
  if (!isWithin(modulesRoot, target)) return undefined
  const [name] = path.relative(modulesRoot, target).split(path.sep)
  return moduleNames.has(name) ? name : undefined
}

const packageMatches = (specifier, name) => specifier === name || specifier.startsWith(`${name}/`)

function memberPath(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    const parent = memberPath(node.expression)
    return parent && `${parent}.${node.name.text}`
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    const parent = memberPath(node.expression)
    return parent && `${parent}.${node.argumentExpression.text}`
  }
  return undefined
}

function isBrowserRoutingMember(member = '') {
  return (
    ['window', 'globalThis', 'document'].some(
      (root) => member === `${root}.location` ||
        member.startsWith(`${root}.location.`),
    ) ||
    ['window', 'globalThis'].some(
      (root) => member === `${root}.history.pushState` ||
        member === `${root}.history.replaceState`,
    )
  )
}

function isGlobalBrowserRouting(checker, node, sourceFile) {
  if (!isBrowserRoutingMember(memberPath(node))) return false
  let root = node
  while (ts.isPropertyAccessExpression(root) ||
         ts.isElementAccessExpression(root)) root = root.expression
  const symbol = ts.isIdentifier(root) && checker.getSymbolAtLocation(root)
  return !symbol?.declarations?.some(
    (declaration) => declaration.getSourceFile() === sourceFile,
  )
}

/** AST parsing makes comments and string examples inert by construction. */
function syntaxFacts(sourceFile, checker) {
  const calls = new Set()
  const references = new Set()
  let usesBrowserRouting = false
  let unresolvedDynamicImport = false

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier &&
          ts.isStringLiteralLike(node.moduleSpecifier)) {
        references.add(node.moduleSpecifier.text)
      }
    } else if (ts.isImportEqualsDeclaration(node) &&
               ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression
      if (reference && ts.isStringLiteralLike(reference)) references.add(reference.text)
      else unresolvedDynamicImport = true
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.add(node.argument.literal.text)
    } else if (ts.isCallExpression(node)) {
      const called = memberPath(node.expression)
      if (called) calls.add(called)
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || called === 'require') &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])) {
        references.add(node.arguments[0].text)
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || called === 'require') {
        unresolvedDynamicImport = true
      }
    } else if (ts.isNewExpression(node)) {
      const called = memberPath(node.expression)
      if (called) calls.add(`new:${called}`)
    }
    if ((ts.isPropertyAccessExpression(node) ||
         ts.isElementAccessExpression(node)) &&
        isGlobalBrowserRouting(checker, node, sourceFile)) {
      usesBrowserRouting = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { calls, references, usesBrowserRouting, unresolvedDynamicImport }
}

function compilerContext(files, sourceRoot) {
  const configPath = path.resolve(sourceRoot, '../tsconfig.app.json')
  const configuration = ts.sys.fileExists(configPath)
    ? ts.readConfigFile(configPath, ts.sys.readFile).config
    : {}
  const configured = ts.parseJsonConfigFileContent(
    configuration, ts.sys, path.dirname(configPath),
  ).options
  const options = {
    ...configured,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const program = ts.createProgram({ host, options, rootNames: files })
  const cache = ts.createModuleResolutionCache(
    sourceRoot, host.getCanonicalFileName, options,
  )
  const resolve = (sourceFile, specifier) =>
    ts.resolveModuleName(
      specifier, sourceFile.fileName, options, host, cache,
    ).resolvedModule?.resolvedFileName
  return { checker: program.getTypeChecker(), program, resolve }
}

function expressionSymbol(checker, node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  if (ts.isIdentifier(current)) return checker.getSymbolAtLocation(current)
  if (ts.isPropertyAccessExpression(current))
    return checker.getSymbolAtLocation(current.name)
  if (ts.isElementAccessExpression(current))
    return checker.getSymbolAtLocation(current.argumentExpression)
  return undefined
}

/**
 * Record each declaration in an alias chain, then follow it to its terminal
 * source. That exposes adapter hops as well as two-hop value and type aliases.
 */
function symbolOrigins(checker, symbol, seen = new Set()) {
  if (!symbol || seen.has(symbol)) return new Set()
  seen.add(symbol)
  const origins = new Set(
    (symbol.declarations ?? []).map((declaration) =>
      path.resolve(declaration.getSourceFile().fileName),
    ),
  )

  if (symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol)
    for (const origin of symbolOrigins(checker, target, seen)) {
      origins.add(origin)
    }
    return origins
  }

  for (const declaration of symbol.declarations ?? []) {
    let next
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      next = expressionSymbol(checker, declaration.initializer)
    } else if (ts.isTypeAliasDeclaration(declaration)) {
      const visit = (node) => {
        if (ts.isIdentifier(node)) {
          const candidate = checker.getSymbolAtLocation(node)
          if (candidate && candidate !== symbol) {
            for (const origin of symbolOrigins(checker, candidate, seen))
              origins.add(origin)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(declaration.type)
    }
    for (const origin of symbolOrigins(checker, next, seen))
      origins.add(origin)
  }
  return origins
}

function exportKind(checker, symbol) {
  const typeOnly = symbol.declarations?.some(
    (declaration) =>
      ts.isExportSpecifier(declaration) &&
      (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly),
  )
  if (typeOnly) return 'type'
  const target = symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol
  return target.flags & ts.SymbolFlags.Value ? 'value' : 'type'
}

function addExportLeaks(
  checker, sourceFile, forbidden, describe, relative, violations,
) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []
  for (const symbol of exported) {
    const blocked = [...symbolOrigins(checker, symbol)].find(forbidden)
    if (blocked) {
      violations.add(
        `${relative} ${describe(blocked)} ${exportKind(checker, symbol)} ${symbol.name}`,
      )
    }
  }
}

/** Static strongly connected components, not a runtime execution proof. */
export function dependencyCycles(graph) {
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), result = []
  const visit = (node) => {
    indices.set(node, indices.size)
    low.set(node, indices.get(node))
    stack.push(node)
    active.add(node)
    for (const target of [...(graph.get(node) ?? [])].sort()) {
      if (!indices.has(target)) {
        visit(target)
        low.set(node, Math.min(low.get(node), low.get(target)))
      } else if (active.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)))
    }
    if (low.get(node) === indices.get(node)) {
      const component = []
      let target
      do {
        target = stack.pop()
        active.delete(target)
        component.push(target)
      } while (target !== node)
      if (component.length > 1 || graph.get(node)?.has(node)) result.push(component.sort())
    }
  }
  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node)
  return result.sort((a, b) => a.join().localeCompare(b.join()))
}

export async function findBoundaryViolations({
  sourceRoot = defaultSourceRoot,
  policy = defaultBoundaryPolicy,
  reportGraph,
} = {}) {
  const appRoot = path.join(sourceRoot, 'app')
  const modulesRoot = path.join(sourceRoot, 'modules')
  const apiRoot = path.join(sourceRoot, 'api')
  const generatedRoot = path.join(apiRoot, 'generated')
  const files = await sourceFiles(sourceRoot)
  const discovered = await moduleDirectories(modulesRoot)
  const moduleNames = new Set(discovered)
  const dependencies = new Map(
    Object.entries(policy.moduleDependencies).map(([name, names]) => [
      name,
      new Set(names),
    ]),
  )
  const generatedAdapters = exactPaths(sourceRoot, policy.generatedApiAdapters)
  const moduleApiAdapters = exactPaths(sourceRoot, policy.moduleApiAdapters)
  const moduleAdapters = exactPaths(sourceRoot, [
    ...policy.moduleApiAdapters,
    ...policy.generatedApiAdapters.filter((entry) =>
      entry.startsWith('modules/'),
    ),
  ])
  const appAdapters = exactPaths(sourceRoot, policy.appApiAdapters)
  const httpAdapters = exactPaths(sourceRoot, policy.httpRuntimeAdapters)
  const { checker, program, resolve } = compilerContext(files, sourceRoot)
  const violations = new Set()
  const fileGraph = new Map()
  const moduleGraph = new Map(discovered.map((name) => [name, new Set()]))
  const unresolved = []
  const report = (condition, message) =>
    condition && violations.add(message)

  for (const key of ['generatedApiAdapters', 'moduleApiAdapters', 'appApiAdapters', 'httpRuntimeAdapters']) {
    for (const entry of policy[key]) {
      report(!program.getSourceFile(path.resolve(sourceRoot, entry)),
        `${entry} is registered in ${key} but does not exist`)
    }
  }

  for (const name of discovered) {
    report(
      !dependencies.has(name),
      `${name} is missing an allowed dependency declaration`,
    )
    report(
      !program.getSourceFile(path.join(modulesRoot, name, 'index.ts')),
      `${name} has no public index.ts`,
    )
  }
  for (const [name, allowed] of dependencies) {
    report(!moduleNames.has(name),
      `${name} is registered but has no module directory`)
    for (const dependency of allowed) {
      report(!moduleNames.has(dependency),
        `${name} declares unknown module dependency ${dependency}`)
      report(dependency === name,
        `${name} declares itself as a dependency`)
    }
  }

  for (const sourcePath of files) {
    const sourceFile = program.getSourceFile(sourcePath)
    if (!sourceFile) continue
    const facts = syntaxFacts(sourceFile, checker)
    const relative = path.relative(sourceRoot, sourcePath).split(path.sep).join('/')
    const sourceModule = moduleNameFor(sourcePath, modulesRoot, moduleNames)
    const bucket = relative.split('/')[0]
    const production = !isTestSource(relative)
    if (production) fileGraph.set(relative, new Set())
    report(!sourceBuckets.has(bucket) && !sourceEntries.has(relative),
      `${relative} is not in a registered source bucket`)
    report(bucket === 'modules' && !sourceModule,
      `${relative} is not inside a declared product module`)
    report(facts.unresolvedDynamicImport, `${relative} has an unresolved dynamic import`)
    if (facts.unresolvedDynamicImport) unresolved.push({ source: relative, specifier: '<dynamic>' })
    const inApp = isWithin(appRoot, sourcePath)
    const inApi = isWithin(apiRoot, sourcePath)
    const inGenerated = isWithin(generatedRoot, sourcePath)
    const isPublicIndex =
      sourceModule &&
      sourcePath === path.join(modulesRoot, sourceModule, 'index.ts')
    const usesHttp =
      [...facts.calls].some((call) => httpCalls.has(call)) ||
      facts.calls.has('new:XMLHttpRequest')

    report(!inGenerated && usesHttp && !httpAdapters.has(sourcePath),
      `${relative} uses HTTP outside the runtime adapter`)
    report(sourceModule && facts.usesBrowserRouting,
      `${relative} uses browser routing APIs in a product module`)

    for (const specifier of facts.references) {
      const httpPackage = httpPackages.find((name) =>
        packageMatches(specifier, name),
      )
      const modelPackage = modelPackages.find((name) =>
        packageMatches(specifier, name),
      )
      report(httpPackage && !inGenerated && !httpAdapters.has(sourcePath),
        `${relative} imports ${httpPackage} as a direct HTTP client`)
      report(modelPackage,
        `${relative} imports ${modelPackage} as a model SDK`)
      report(
        sourceModule &&
          routerPackages.some((name) => packageMatches(specifier, name)),
        `${relative} imports routing in a product module`,
      )

      const target = resolve(sourceFile, specifier)
      if (!target) {
        if (specifier.startsWith('.') && !/\.(?:css|svg|png|jpe?g|webp|gif|woff2?|csl|xml)(?:\?.*)?$/.test(specifier)) {
          unresolved.push({ source: relative, specifier })
          report(true, `${relative} has an unresolved local import ${specifier}`)
        }
        continue
      }
      const targetRelative = path.relative(sourceRoot, target).split(path.sep).join('/')
      report(!isWithin(sourceRoot, target) && sourceExtension.test(target) &&
        !target.split(path.sep).includes('node_modules'),
        `${relative} imports local source outside the registered source root`)
      if (production && isWithin(sourceRoot, target) && !isTestSource(targetRelative)) {
        fileGraph.get(relative).add(targetRelative)
      }
      const targetModule = moduleNameFor(target, modulesRoot, moduleNames)
      const targetApp = isWithin(appRoot, target)
      const targetApi = isWithin(apiRoot, target)
      const targetGenerated = isWithin(generatedRoot, target)

      report(isPublicIndex && moduleAdapters.has(path.resolve(target)),
        `${relative} imports module adapter from its public index`)
      report(sourceModule && targetApp, `${relative} imports app code`)
      report(production && targetRelative === 'main.tsx',
        `${relative} imports the application composition entry`)
      report(production && sharedBuckets.has(bucket) && targetApp,
        `${relative} imports app code through a shared source bucket`)
      report(production && sharedBuckets.has(bucket) && targetApi,
        `${relative} imports API code through a shared source bucket`)
      report(production && sharedBuckets.has(bucket) && targetModule &&
        !(targetModule === 'agent-avatar' && ['ui', 'design-system'].includes(bucket)),
        `${relative} imports product code through a shared source bucket`)
      report(production && isWithin(sourceRoot, target) && isTestSource(targetRelative),
        `${relative} imports test-only source`)
      report(
        inApi && !inGenerated && targetApp,
        `${relative} imports app code from the API layer`,
      )
      report(inGenerated && !targetGenerated,
        `${relative} imports outside the generated API layer`)
      report(
        targetGenerated &&
          !inGenerated &&
          !generatedAdapters.has(sourcePath),
        `${relative} imports generated API outside an approved adapter`,
      )
      report(
        inApp &&
          targetApi &&
          !targetGenerated &&
          !appAdapters.has(path.resolve(target)),
        `${relative} imports API internals instead of an approved app adapter`,
      )
      report(
        sourceModule &&
          targetApi &&
          !targetGenerated &&
          !moduleApiAdapters.has(sourcePath),
        `${relative} imports API internals outside its module adapter`)
      report(inApi && !inGenerated && targetModule,
        `${relative} imports product module code from the API layer`)

      if (!targetModule || sourceModule === targetModule) continue
      if (sourceModule && production) moduleGraph.get(sourceModule).add(targetModule)
      report(
        sourceModule && !dependencies.get(sourceModule)?.has(targetModule),
        `${sourceModule} cannot depend on ${targetModule}`,
      )
      const publicEntry = path.join(modulesRoot, targetModule, 'index.ts')
      report(path.resolve(target) !== publicEntry,
        `${relative} bypasses ${targetModule}/index.ts`)
    }

    if (moduleAdapters.has(sourcePath)) {
      addExportLeaks(
        checker,
        sourceFile,
        (origin) => isWithin(apiRoot, origin),
        (origin) =>
          `re-exports raw ${
            isWithin(generatedRoot, origin) ? 'generated API' : 'API'
          }`,
        relative,
        violations,
      )
    }
    if (appAdapters.has(sourcePath)) {
      addExportLeaks(
        checker,
        sourceFile,
        (origin) => isWithin(generatedRoot, origin),
        () => 're-exports raw generated API',
        relative,
        violations,
      )
    }
    if (isPublicIndex) {
      addExportLeaks(
        checker,
        sourceFile,
        (origin) => moduleAdapters.has(origin),
        () => 'exports module adapter',
        relative,
        violations,
      )
    }
  }
  for (const component of dependencyCycles(moduleGraph)) {
    violations.add(`product module dependency cycle (SCC): ${component.join(', ')}`)
  }
  if (reportGraph) reportGraph({
    scope: 'All local JS/TS production imports including type-only and literal dynamic imports; excludes test sources and external packages.',
    nodes: [...fileGraph.keys()].sort(),
    edges: [...fileGraph].flatMap(([source, targets]) => [...targets].sort().map((target) => ({ source, target }))),
    cycles: dependencyCycles(fileGraph),
    moduleCycles: dependencyCycles(moduleGraph),
    unresolved,
  })
  return [...violations].sort()
}

export async function assertModuleBoundaries(options) {
  const violations = await findBoundaryViolations(options)
  if (violations.length) {
    throw new Error(`Module boundary violations:\n${violations.join('\n')}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await assertModuleBoundaries()
    process.stdout.write('Module boundaries: ok\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
