import { build } from 'esbuild'
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root,'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist,{recursive:true})
await build({ entryPoints:[path.join(root,'src/capture.js')], bundle:true, outfile:path.join(dist,'capture.js'), format:'iife', target:'chrome120', minify:true })
await build({ entryPoints:[path.join(root,'src/popup.js')], bundle:true, outfile:path.join(dist,'popup.js'), format:'esm', target:'chrome120', minify:true })
for (const file of ['manifest.json','popup.html','popup.css']) await cp(path.join(root,file),path.join(dist,file))
await writeFile(path.join(dist,'THIRD_PARTY_LICENSES.txt'), await readFile(path.join(root,'node_modules/defuddle/LICENSE'),'utf8'))
const downloads = path.resolve(root,'../../frontend/public/downloads')
await mkdir(downloads,{recursive:true})
const files = ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'capture.js', 'THIRD_PARTY_LICENSES.txt']
const zip = (source, output, names, executable = '') => execFileSync('python3', ['-c', `
import pathlib,zipfile,sys
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:
 for name in sys.argv[4:]:
  info=zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))
  info.create_system=3
  info.external_attr=(0o100755 if name==sys.argv[3] else 0o100644)<<16
  info.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(info,(root/name).read_bytes())
`, source, output, executable, ...names])
zip(dist, path.join(downloads, 'everplain-clipper.zip'), files)
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const checksums = [`${await digest(path.join(downloads, 'everplain-clipper.zip'))}  everplain-clipper.zip`]
for (const file of files) checksums.push(`${await digest(path.join(dist, file))}  ${file}`)
await writeFile(path.join(downloads, 'everplain-clipper.sha256'), checksums.join('\n') + '\n')
const setup = path.join(root, 'setup')
// Keep directly downloadable sources beside the ZIPs for review. macOS ZIP retains execute mode.
for (const file of ['everplain-clipper-macos.command', 'everplain-clipper-windows.cmd', 'everplain-clipper-windows.ps1']) {
  await cp(path.join(setup, file), path.join(downloads, file))
}
zip(setup, path.join(downloads, 'everplain-clipper-macos.zip'), ['everplain-clipper-macos.command', 'README-macos.txt'], 'everplain-clipper-macos.command')
zip(setup, path.join(downloads, 'everplain-clipper-windows.zip'), ['everplain-clipper-windows.cmd', 'everplain-clipper-windows.ps1', 'README-windows.txt'])
console.log('Built extension, SHA-256 list and macOS/Windows setup downloads')
