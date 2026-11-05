// Icon fingerprints: an N x N area-averaged downsample of an RGBA image region.
// Used both at build time (on GGG's CDN icons) and at runtime (on captured
// inventory cells), so both sides go through the exact same sampling code.

export const FP_SIZE = 16

export interface Fingerprint {
  /** N*N*3 alpha-weighted mean colour per sample cell, 0..255 */
  rgb: Uint8Array
  /** N*N mean alpha per sample cell, 0..255 (all 255 for screen captures) */
  alpha: Uint8Array
}

export interface RgbaImage {
  pixels: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** Downsample the rectangle (x, y, w, h) of `img` (fractional px allowed) to
 *  an N x N fingerprint. Each output cell averages every source pixel whose
 *  centre falls inside it, weighting colour by alpha so transparent icon
 *  margins don't drag colours toward black. */
export function fingerprintRegion(img: RgbaImage, x: number, y: number, w: number, h: number, n = FP_SIZE): Fingerprint {
  const rgb = new Uint8Array(n * n * 3)
  const alpha = new Uint8Array(n * n)
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(img.width, Math.ceil(x + w))
  const y1 = Math.min(img.height, Math.ceil(y + h))
  const sumR = new Float64Array(n * n)
  const sumG = new Float64Array(n * n)
  const sumB = new Float64Array(n * n)
  const sumA = new Float64Array(n * n)
  const count = new Float64Array(n * n)
  for (let py = y0; py < y1; py++) {
    const cy = Math.floor(((py + 0.5 - y) / h) * n)
    if (cy < 0 || cy >= n) continue
    for (let px = x0; px < x1; px++) {
      const cx = Math.floor(((px + 0.5 - x) / w) * n)
      if (cx < 0 || cx >= n) continue
      const i = (py * img.width + px) * 4
      const a = img.pixels[i + 3]
      const k = cy * n + cx
      sumR[k] += img.pixels[i] * a
      sumG[k] += img.pixels[i + 1] * a
      sumB[k] += img.pixels[i + 2] * a
      sumA[k] += a
      count[k]++
    }
  }
  for (let k = 0; k < n * n; k++) {
    if (sumA[k] > 0) {
      rgb[k * 3] = Math.round(sumR[k] / sumA[k])
      rgb[k * 3 + 1] = Math.round(sumG[k] / sumA[k])
      rgb[k * 3 + 2] = Math.round(sumB[k] / sumA[k])
    }
    alpha[k] = count[k] > 0 ? Math.round(sumA[k] / count[k]) : 0
  }
  return { rgb, alpha }
}

function luma(rgb: Uint8Array, k: number): number {
  return 0.299 * rgb[k * 3] + 0.587 * rgb[k * 3 + 1] + 0.114 * rgb[k * 3 + 2]
}

/** Reference alpha below this counts as background for estimating the
 *  inventory colour behind the icon. */
const BG_ALPHA = 16
/** Weight of fully transparent reference pixels relative to opaque ones.
 *  Non-zero so an icon's footprint (e.g. a glow one variant has and its
 *  look-alike lacks) still counts. */
const BG_WEIGHT = 0.3

/** Distance between a captured cell and a reference icon, in mean absolute
 *  per-channel difference (0..255). The reference is composited over the
 *  cell's own background colour (estimated from where the icon is
 *  transparent), and the icon part of the capture is gain-matched to the
 *  reference so in-game lighting/gamma shifts don't dominate. */
export function distance(cell: Fingerprint, ref: Fingerprint): number {
  const n = ref.alpha.length
  const bg = [0, 0, 0]
  let bgCount = 0
  for (let k = 0; k < n; k++) {
    if (ref.alpha[k] >= BG_ALPHA) continue
    for (let c = 0; c < 3; c++) bg[c] += cell.rgb[k * 3 + c]
    bgCount++
  }
  for (let c = 0; c < 3; c++) bg[c] = bgCount ? bg[c] / bgCount : 0
  const bgLuma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]

  let wSum = 0
  let cellLuma = 0
  let refLuma = 0
  for (let k = 0; k < n; k++) {
    const a = ref.alpha[k] / 255
    if (a === 0) continue
    cellLuma += a * (luma(cell.rgb, k) - bgLuma)
    refLuma += a * a * luma(ref.rgb, k)
  }
  const gain = cellLuma > 0 ? Math.min(1.5, Math.max(0.67, refLuma / cellLuma)) : 1

  let diff = 0
  for (let k = 0; k < n; k++) {
    const a = ref.alpha[k] / 255
    const w = BG_WEIGHT + (1 - BG_WEIGHT) * a
    wSum += w
    for (let c = 0; c < 3; c++) {
      const got = bg[c] + (cell.rgb[k * 3 + c] - bg[c]) * gain
      const want = ref.rgb[k * 3 + c] * a + bg[c] * (1 - a)
      diff += w * Math.abs(got - want)
    }
  }
  return diff / (wSum * 3)
}

/** Luminance standard deviation of a capture fingerprint. Empty inventory
 *  cells are near-uniform dark texture, so a low value means "nothing here". */
export function lumaStdDev(fp: Fingerprint): number {
  const n = fp.alpha.length
  let sum = 0
  let sq = 0
  for (let k = 0; k < n; k++) {
    const l = luma(fp.rgb, k)
    sum += l
    sq += l * l
  }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sq / n - mean * mean))
}

export function encodeBytes(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function decodeBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
