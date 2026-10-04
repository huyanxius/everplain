// Build after `npm run build`. Keep the six-file sideload ZIP unchanged.
import { readFile, mkdir, cp, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const output = path.join(root, 'store-dist')
const files = ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'capture.js', 'THIRD_PARTY_LICENSES.txt']
// Missing inputs fail closed instead of producing an incomplete store package.
for (const file of files) await readFile(path.join(dist, file))
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))
if (manifest.manifest_version !== 3) throw new Error('Chrome Web Store package requires Manifest V3')
manifest.icons = { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' }
manifest.action = { ...manifest.action, default_icon: manifest.icons }
await mkdir(path.join(output, 'icons'), { recursive: true })
for (const file of files.filter(file => file !== 'manifest.json')) await cp(path.join(dist, file), path.join(output, file))
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
for (const size of [16, 48, 128]) {
  const file = `icon-${size}.png`
  const png = await readFile(path.join(root, 'store-assets', file))
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Invalid ${size}px PNG icon`)
  await writeFile(path.join(output, 'icons', file), png)
  files.push(`icons/${file}`)
}
const zipPath = path.join(root, `everplain-clipper-store-${manifest.version}.zip`)
execFileSync('python3', ['-c', `
import pathlib, zipfile, sys
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sys.argv[3:]:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (root / name).read_bytes())
`, output, zipPath, ...files])
const checksum = createHash('sha256').update(await readFile(zipPath)).digest('hex')
await writeFile(zipPath + '.sha256', `${checksum}  ${path.basename(zipPath)}\n`)
console.log(`Built ${zipPath}\nSHA-256 ${checksum}`)
