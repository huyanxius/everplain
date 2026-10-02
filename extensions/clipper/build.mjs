import { build } from 'esbuild'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root,'dist')
await mkdir(dist,{recursive:true})
await build({ entryPoints:[path.join(root,'src/capture.js')], bundle:true, outfile:path.join(dist,'capture.js'), format:'iife', target:'chrome120', minify:true })
await build({ entryPoints:[path.join(root,'src/popup.js')], bundle:true, outfile:path.join(dist,'popup.js'), format:'esm', target:'chrome120', minify:true })
for (const file of ['manifest.json','popup.html','popup.css']) await cp(path.join(root,file),path.join(dist,file))
await writeFile(path.join(dist,'THIRD_PARTY_LICENSES.txt'), await readFile(path.join(root,'node_modules/defuddle/LICENSE'),'utf8'))
const downloads = path.resolve(root,'../../frontend/public/downloads')
await mkdir(downloads,{recursive:true})
execFileSync('python3',['-c','import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [(z.write(f,f.relative_to(p))) for f in p.iterdir() if f.is_file()]; z.close()',dist,path.join(downloads,'everplain-clipper.zip')])
console.log('Built extension and downloadable ZIP')
