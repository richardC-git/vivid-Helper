// Generates src/data/gem-refs.json: one fingerprint per PoE1 support gem.
//
// The plugin can't read CDN icon pixels at runtime (web.poecdn.com sends no
// CORS headers, so a canvas would be tainted), so we fingerprint every icon
// here once and bundle the result. Re-run when a league adds support gems:
//
//   npm run build:refs
//
// Icon URLs come from Scalpel's own item-data index, pinned to a commit so
// rebuilds are reproducible. Bump ITEM_DATA_REF to pick up new gems.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { FP_SIZE, encodeBytes, fingerprintRegion } from '../src/fingerprint'

const ITEM_DATA_REF = 'ae42ad6446ac7a00cf2e2564f1bc8e939ec399e0'
const ITEM_DATA_URL = `https://raw.githubusercontent.com/scalpelpoe/scalpel/${ITEM_DATA_REF}/packages/item-data/poe1.json`
const OUT = resolve(import.meta.dirname, '../src/data/gem-refs.json')
const CONCURRENCY = 8

/** CDN /gen/image/ URLs embed a base64url JSON spec whose `f` is the art path,
 *  e.g. "2DItems/Gems/Support/multipleattacks". */
function artPath(url: string): string | null {
  const m = url.match(/\/gen\/image\/([^/]+)\//)
  if (!m) return null
  try {
    const spec = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    return typeof spec?.[2]?.f === 'string' ? spec[2].f : null
  } catch {
    return null
  }
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': 'scalpel-plugin-gem-scanner build' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res
}

async function main(): Promise<void> {
  const icons = (await (await fetchOk(ITEM_DATA_URL)).json()) as Record<string, string>
  const supports = Object.entries(icons)
    .filter(([name, url]) => name.endsWith(' Support') && artPath(url)?.startsWith('2DItems/Gems/Support/'))
    .sort(([a], [b]) => a.localeCompare(b))
  console.log(`${supports.length} support gems in item-data@${ITEM_DATA_REF.slice(0, 7)}`)

  const gems: { name: string; icon: string; rgb: string; alpha: string }[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < supports.length) {
      const [name, url] = supports[next++]
      const png = PNG.sync.read(Buffer.from(await (await fetchOk(url)).arrayBuffer()))
      const fp = fingerprintRegion({ pixels: png.data, width: png.width, height: png.height }, 0, 0, png.width, png.height)
      gems.push({ name, icon: url, rgb: encodeBytes(fp.rgb), alpha: encodeBytes(fp.alpha) })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  gems.sort((a, b) => a.name.localeCompare(b.name))

  writeFileSync(OUT, JSON.stringify({ size: FP_SIZE, source: ITEM_DATA_REF, gems }, null, 0) + '\n')
  console.log(`wrote ${gems.length} fingerprints to ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
