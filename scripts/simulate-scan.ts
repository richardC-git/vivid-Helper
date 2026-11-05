// Accuracy check for the matcher without the game: renders real gem icons into
// synthetic inventory grids (dark noisy background, grid lines, lighting gain,
// sensor noise, calibration misalignment) and runs scanGrid over them.
//
//   npm run sim
//
// Icons are cached under .cache/icons so reruns are offline.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { INVENTORY_COLS, INVENTORY_ROWS } from '../src/grid'
import { GEM_REFS, scanGrid } from '../src/match'

const CACHE = resolve(import.meta.dirname, '../.cache/icons')

let seed = 1
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
function gauss(): number {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
}

async function loadIcon(name: string, url: string): Promise<PNG> {
  const file = resolve(CACHE, name.replace(/[^a-z0-9]+/gi, '_') + '.png')
  if (!existsSync(file)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return PNG.sync.read(readFileSync(file))
}

function sampleBilinear(png: PNG, u: number, v: number): [number, number, number, number] {
  const x = Math.min(png.width - 1, Math.max(0, u * png.width - 0.5))
  const y = Math.min(png.height - 1, Math.max(0, v * png.height - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(png.width - 1, x0 + 1)
  const y1 = Math.min(png.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const p = (xx: number, yy: number): number => png.data[(yy * png.width + xx) * 4 + c]
    out[c] = (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy
  }
  return out
}

interface Trial {
  cell: number
  shift: number
  gain: number
  noise: number
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true })
  const icons = new Map<string, PNG>()
  for (const ref of GEM_REFS) icons.set(ref.name, await loadIcon(ref.name, ref.icon))

  const trials: Trial[] = []
  for (const cell of [35.1, 52.6, 70.1, 105.2]) {
    for (const shift of [0, 2, -3]) {
      for (const gain of [0.8, 1, 1.15]) trials.push({ cell, shift, gain, noise: 4 })
    }
  }

  const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(2)}%`
  let total = 0
  let correct = 0
  let wrong = 0
  let unknown = 0
  let ambiguousHit = 0
  let extraCandidates = 0
  let scanMs = 0
  let scans = 0
  let emptyOk = 0
  let emptyTotal = 0
  const correctDist: number[] = []
  const confusions = new Map<string, number>()

  for (const t of trials) {
    const before = { total, correct }
    // Each trial fills grids until every gem has appeared once, ~10% empty cells.
    const order = [...GEM_REFS].sort(() => rand() - 0.5)
    while (order.length) {
      const w = Math.ceil(INVENTORY_COLS * t.cell) + 8
      const h = Math.ceil(INVENTORY_ROWS * t.cell) + 8
      const img = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        const n = gauss() * 3
        img[i * 4] = 14 + n
        img[i * 4 + 1] = 12 + n
        img[i * 4 + 2] = 10 + n
        img[i * 4 + 3] = 255
      }
      const truth: (string | null)[] = []
      const gx = 4
      const gy = 4
      for (let row = 0; row < INVENTORY_ROWS; row++) {
        for (let col = 0; col < INVENTORY_COLS; col++) {
          const ref = rand() < 0.1 ? null : (order.pop() ?? null)
          truth.push(ref?.name ?? null)
          const cx = gx + col * t.cell
          const cy = gy + row * t.cell
          for (let py = Math.floor(cy); py < Math.ceil(cy + t.cell); py++) {
            for (let px = Math.floor(cx); px < Math.ceil(cx + t.cell); px++) {
              const i = (py * w + px) * 4
              // Grid line along each cell's top/left edge.
              if (px - Math.floor(cx) < 1 || py - Math.floor(cy) < 1) {
                img[i] = 45
                img[i + 1] = 38
                img[i + 2] = 30
                continue
              }
              if (!ref) continue
              const [r, g, b, a] = sampleBilinear(icons.get(ref.name)!, (px + 0.5 - cx) / t.cell, (py + 0.5 - cy) / t.cell)
              const al = a / 255
              for (const [c, v] of [r, g, b].entries()) {
                img[i + c] = (v * t.gain + gauss() * t.noise) * al + img[i + c] * (1 - al)
              }
            }
          }
        }
      }
      const t0 = performance.now()
      const { cells: results } = scanGrid({ pixels: img, width: w, height: h }, { x: gx + t.shift, y: gy + t.shift, cell: t.cell })
      scanMs += performance.now() - t0
      scans++
      results.forEach((r, i) => {
        const want = truth[i]
        if (want === null) {
          emptyTotal++
          if (r.status === 'empty') emptyOk++
          return
        }
        total++
        const top = r.candidates[0]?.name
        if (r.status === 'matched' && top === want) {
          correct++
          if (r.candidates.length > 1) extraCandidates++
          correctDist.push(r.distance!)
        } else if (r.status === 'matched' && r.candidates.some((c) => c.name === want)) {
          ambiguousHit++
        } else if (r.status === 'matched') {
          wrong++
          const k = `${want} -> ${top} (cell ${t.cell}, shift ${t.shift}, gain ${t.gain})`
          confusions.set(k, (confusions.get(k) ?? 0) + 1)
        } else {
          unknown++
          if (unknown <= 5) console.log(`unread: ${want} as ${r.status} d=${r.distance?.toFixed(1)} (cell ${t.cell}, shift ${t.shift}, gain ${t.gain})`)
        }
      })
    }
    console.log(`cell ${t.cell} shift ${t.shift} gain ${t.gain}: ${pct(correct - before.correct, total - before.total)} correct`)
  }

  correctDist.sort((a, b) => a - b)
  console.log(`gems: ${total}  correct ${pct(correct, total)}  listed-as-alternative ${pct(ambiguousHit, total)}  wrong ${pct(wrong, total)}  unread ${pct(unknown, total)}`)
  console.log(`correct but shown with look-alikes: ${pct(extraCandidates, total)}`)
  console.log(`mean scan time ${(scanMs / scans).toFixed(0)} ms over ${scans} scans`)
  console.log(`empty cells detected: ${pct(emptyOk, emptyTotal)} of ${emptyTotal}`)
  console.log(`correct-match distance p50 ${correctDist[correctDist.length >> 1]?.toFixed(1)}  p99 ${correctDist[Math.floor(correctDist.length * 0.99)]?.toFixed(1)}  max ${correctDist.at(-1)?.toFixed(1)}`)
  for (const [k, v] of [...confusions].slice(0, 15)) console.log(`  confused x${v}: ${k}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
