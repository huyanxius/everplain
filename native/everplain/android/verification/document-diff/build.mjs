import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
const modules = path.resolve(process.argv[2] ?? '')
if (!process.argv[2] || !process.argv[3]) throw Error('Pass verified Web node_modules and package-lock.json; this script does not install packages')
const lockPath = path.resolve(process.argv[3])
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')).packages
const {rolldown} = await import(pathToFileURL(path.join(modules, 'rolldown/dist/index.mjs')).href)
const output = path.resolve(root, '../../app/src/main/assets/document-diff')
const used = new Set()
const bundle = await rolldown({
  input: path.join(root, 'bridge.ts'), platform:'neutral',
  resolve: {modules:[modules, 'node_modules'], mainFields:['module','main']},
  onwarn(warning) { if (warning.code === 'UNRESOLVED_IMPORT' || warning.code === 'MISSING_GLOBAL_NAME') throw Error(warning.message) },
  plugins:[{name:'record-sources',transform: (_code,id)=>{used.add(id); return null}}],
})
await bundle.write({file:path.join(output,'web-document-diff.js'),format:'iife',name:'EverplainDocumentDiff',minify:true,comments:{legal:true}})
await bundle.close()
fs.copyFileSync(path.join(root,'runtime-envelope.js'),path.join(output,'runtime-envelope.js'))
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const packages = new Map()
for (const file of used) {
  if (!file.startsWith(modules+path.sep)) continue
  const rel = path.relative(modules,file).split(path.sep)
  const name = rel[0].startsWith('@')?rel.slice(0,2).join('/'):rel[0]
  const dir = path.join(modules,name)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))
  if (packages.has(name)) continue
  if (lock['node_modules/'+name]?.version !== pkg.version) throw Error('Version differs from Web lock: '+name)
  const license = ['LICENSE','LICENSE.md','LICENSE.txt','license'].map(n=>path.join(dir,n)).find(p=>fs.existsSync(p))
  if (!license) throw Error('Missing license: '+name)
  const target = name.replaceAll('/','__')+'.LICENSE.txt'
  fs.copyFileSync(license,path.join(output,target))
  packages.set(name,{name,version:pkg.version,license:pkg.license,licenseFile:target,licenseSha256:hash(license)})
}
fs.writeFileSync(path.join(output,'provenance.json'),JSON.stringify({
  purpose:'Unmodified Web ProseMirror/TipTap document difference computation. No Editor, HTML surface or WebView is created.',
  source:'src/modules/research-document/model/documentDiff.ts',sourceSha256:hash(path.join(root,'web-document-diff.ts')),
  testSha256:hash(path.join(root,'web-document-diff.test.ts')),
  webPackageLockSha256:hash(lockPath),
  bundleSha256:hash(path.join(output,'web-document-diff.js')),
  runtimeEnvelopeSha256:hash(path.join(output,'runtime-envelope.js')),
  bundler:JSON.parse(fs.readFileSync(path.join(modules,'rolldown/package.json'),'utf8')).version,
  packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)),
},null,2)+'\n')
console.log('Built',fs.statSync(path.join(output,'web-document-diff.js')).size,'bytes;',packages.size,'package license files')
