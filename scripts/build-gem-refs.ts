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
//
// Gems that can't reach level 20 (exceptional and Awakened supports) are left
// out: Vivid Watcher crafts only make 20/20 gems, and some of them share or
// nearly share art with a regular gem (Communion / Minion Pact, Greater Fork /
// Fork). Max levels come from poe.ninja's gem lines for the current league;
// gems it doesn't list yet (new this league) are kept.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { FP_SIZE, encodeBytes, fingerprintRegion } from '../src/fingerprint'

const ITEM_DATA_REF = 'ae42ad6446ac7a00cf2e2564f1bc8e939ec399e0'
const ITEM_DATA_URL = `https://raw.githubusercontent.com/scalpelpoe/scalpel/${ITEM_DATA_REF}/packages/item-data/poe1.json`
const OUT = resolve(import.meta.dirname, '../src/data/gem-refs.json')
const CONCURRENCY = 8
const NINJA = 'https://poe.ninja/poe1/api/economy'
/** Vivid Watcher crafts output level 20 gems */
const OUTPUT_LEVEL = 20

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

/** Highest level poe.ninja lists for each gem in the current challenge league. */
async function ninjaMaxLevels(): Promise<{ league: string; maxLevel: Map<string, number> }> {
  const leagues = (await (await fetchOk(`${NINJA}/leagues`)).json()) as { id: string }[]
  const league = leagues[0].id
  const url = `${NINJA}/stash/current/item/overview?league=${encodeURIComponent(league)}&type=SkillGem`
  const { lines } = (await (await fetchOk(url)).json()) as { lines: { name: string; gemLevel?: number }[] }
  const maxLevel = new Map<string, number>()
  for (const l of lines) maxLevel.set(l.name, Math.max(maxLevel.get(l.name) ?? 0, l.gemLevel ?? 0))
  return { league, maxLevel }
}

async function main(): Promise<void> {
  const icons = (await (await fetchOk(ITEM_DATA_URL)).json()) as Record<string, string>
  const { league, maxLevel } = await ninjaMaxLevels()
  const all = Object.entries(icons)
    .filter(([name, url]) => name.endsWith(' Support') && artPath(url)?.startsWith('2DItems/Gems/Support/'))
    .sort(([a], [b]) => a.localeCompare(b))
  const excluded = all.filter(([name]) => (maxLevel.get(name) ?? OUTPUT_LEVEL) < OUTPUT_LEVEL).map(([name]) => name)
  const supports = all.filter(([name]) => !excluded.includes(name))
  console.log(
    `${all.length} support gems in item-data@${ITEM_DATA_REF.slice(0, 7)}; ` +
      `${excluded.length} can't reach level ${OUTPUT_LEVEL} per poe.ninja (${league}), leaving ${supports.length}`,
  )

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

  writeFileSync(OUT, JSON.stringify({ size: FP_SIZE, source: ITEM_DATA_REF, levelsFrom: league, excluded, gems }, null, 0) + '\n')
  console.log(`wrote ${gems.length} fingerprints to ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
