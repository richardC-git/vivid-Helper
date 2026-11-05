// Copies the built plugin into the Scalpel fork, which ships it preinstalled
// (src/main/plugins/bundled/<id>/ there). Run via `npm run bundle`; pass the
// fork's path if it isn't next to this repo:
//
//   npm run bundle -- /path/to/scalpel-gems
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const fork = resolve(process.argv[2] ?? resolve(root, '../scalpel-gems'))
const { id, version } = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))

if (!existsSync(resolve(fork, 'src/main/plugins/bundled.ts'))) {
  console.error(`${fork} doesn't look like the Scalpel fork (no src/main/plugins/bundled.ts)`)
  process.exit(1)
}
const dest = resolve(fork, 'src/main/plugins/bundled', id)
mkdirSync(dest, { recursive: true })
for (const f of ['plugin.js', 'manifest.json']) copyFileSync(resolve(root, 'dist', f), resolve(dest, f))
console.log(`bundled ${id} ${version} into ${dest}`)
console.log('Bump "version" in manifest.json for each change, or existing installs will not re-seed it.')
