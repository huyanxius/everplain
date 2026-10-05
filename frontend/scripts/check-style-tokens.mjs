import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * 页面样式只能引用 tokens.css：字阶、控件高度、圆角和颜色都不许写字面值。
 *
 * 不传参数时扫描 src 下全部 CSS。豁免名单只放取值源本身和自带画面的东西：
 * tokens.css 是唯一取值源；官网落地页（foundation/）和角色头像有自己的固定配色；
 * shader 与 system-theme 处理的是 GPU/位图图层，不是界面表面。
 */
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const exempt = /(?:^|\/)(?:styles\/tokens\.css|styles\/system-theme\.css|app\/foundation\/|modules\/agent-avatar\/|modules\/companion\/companion\.css$|modules\/user-avatar\/user-avatar\.css$|mock\/)|shader/i

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path)
    return entry.name.endsWith('.css') && !exempt.test(relative(srcRoot, path)) ? [path] : []
  })
}

const args = process.argv.slice(2)
const files = args.length > 0 ? args.map((file) => resolve(file)) : collect(srcRoot)

const checks = [
  { label: 'raw type size', pattern: /font-size\s*:\s*([^;}]+)/g, allowed: /^(?:var\(|inherit$|max\(var\(|[\d.]+em$|[\d.]+%$)/ },
  { label: 'raw radius', pattern: /border-radius\s*:\s*([^;}]+)/g, allowed: /^(?:(?:var\(--[\w-]+\)|0)\s*)+(?:!important)?$|^(?:var\(|50%$|inherit$)/ },
  // 颜色只能来自 var(--qx-color-*)；透明度用 color-mix 混 token，不写 rgb()/十六进制。
  { label: 'raw color', pattern: /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g, allowed: /^$/ },
  {
    label: 'raw control size',
    pattern: /(?:^|[;{]\s*)((?:min-)?height)\s*:\s*([^;}]+)/gm,
    valueIndex: 2,
    allowed: /^(?!(?:1\.8rem|1\.9rem|2rem|2\.25rem|32px|36px)$)/,
  },
]

const failures = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const check of checks) {
    for (const match of source.matchAll(check.pattern)) {
      const value = match[check.valueIndex ?? 1].trim()
      if (check.allowed.test(value)) continue
      const line = source.slice(0, match.index).split('\n').length
      failures.push(`${file}:${line} ${check.label}: ${match[0].trim()}`)
    }
  }
}

// 自定义属性不能互相引用成环：环上的变量在计算时会一起失效，引用它们的边框和背景直接变透明。
// 不分作用域地建图，宁可多报：别名层只该单向指向 tokens.css。
const references = new Map()
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    const targets = references.get(match[1]) ?? new Set()
    for (const ref of match[2].matchAll(/var\((--[\w-]+)/g)) targets.add(ref[1])
    references.set(match[1], targets)
  }
}
const reported = new Set()
function walk(name, path) {
  for (const next of references.get(name) ?? []) {
    if (path.includes(next)) {
      const cycle = path.slice(path.indexOf(next)).concat(next).join(' -> ')
      const key = [...new Set(path.slice(path.indexOf(next)))].sort().join(',')
      if (!reported.has(key)) { reported.add(key); failures.push(`custom property cycle: ${cycle}`) }
    } else if (path.length < 12) walk(next, path.concat(next))
  }
}
for (const name of references.keys()) walk(name, [name])

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Style tokens: ok')

