/**
 * Image utilities that run on the main thread or in a worker: decoding,
 * downscaling, WebP encoding, thumbnails, perceptual hash, colour extraction.
 */
import type { Palette } from '../engine/palette'

export const MAX_EDGE = 1280
export const THUMB_EDGE = 320
export const WEBP_QUALITY = 0.82

export interface ProcessedPhoto {
  photo: Blob
  thumb: Blob
  width: number
  height: number
}

export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    throw new Error(`UNSUPPORTED_IMAGE:${file.type || 'unknown'}:${(error as Error).message}`)
  }
}

export function fit(width: number, height: number, maxEdge: number): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

export function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function draw(source: CanvasImageSource, width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/** Draws onto an opaque white canvas: a cutout keeps a white background in every theme and in every export. */
export function drawOnWhite(source: CanvasImageSource, width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

export async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, type = 'image/webp', quality = WEBP_QUALITY): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type, quality })
    if (blob.type === type) return blob
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, quality)
  })
}

/** Downscale to 1280 px, WebP (JPEG where WebP is unsupported), plus a 320 px thumbnail. */
export async function processPhoto(bitmap: ImageBitmap): Promise<ProcessedPhoto> {
  const [w, h] = fit(bitmap.width, bitmap.height, MAX_EDGE)
  const canvas = draw(bitmap, w, h)
  const photo = await encode(canvas)
  const [tw, th] = fit(w, h, THUMB_EDGE)
  const thumb = await encode(draw(canvas as CanvasImageSource, tw, th), 'image/webp', 0.8)
  return { photo, thumb, width: w, height: h }
}

export function imageData(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = draw(source, width, height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  return ctx.getImageData(0, 0, width, height)
}

// ---------------------------------------------------------------- perceptual hash

function dct1d(input: number[]): number[] {
  const n = input.length
  const out = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += input[i] * Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n))
    out[k] = sum * (k === 0 ? Math.SQRT1_2 : 1)
  }
  return out
}

/** 64-bit pHash (32×32 grey → DCT → top-left 8×8 → median) as 16 hex chars. */
export function perceptualHash(pixels: ImageData): string {
  const size = 32
  if (pixels.width !== size || pixels.height !== size) throw new Error('perceptualHash expects 32×32 ImageData')
  const grey: number[][] = []
  for (let y = 0; y < size; y++) {
    const row: number[] = []
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      row.push(0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2])
    }
    grey.push(row)
  }
  const rows = grey.map(dct1d)
  const cols: number[][] = []
  for (let x = 0; x < 8; x++) cols.push(dct1d(rows.map((r) => r[x])).slice(0, 8))
  const values: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) values.push(cols[x][y])
  const sorted = [...values].sort((a, b) => a - b)
  const median = (sorted[31] + sorted[32]) / 2
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (values[i + b] > median ? 1 : 0)
    hex += nibble.toString(16)
  }
  return hex
}

export function hammingDistance(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

// ---------------------------------------------------------------- colour

export interface Lab {
  l: number
  a: number
  b: number
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const f = (c: number) => {
    c /= 255
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92
  }
  const R = f(r)
  const G = f(g)
  const B = f(b)
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = g2(x)
  y = g2(y)
  z = g2(z)
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
}

export function hexToLab(hex: string): Lab {
  const n = parseInt(hex.replace('#', ''), 16)
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b)
}

export interface ColourResult {
  primary: string
  secondary: string | null
  /** share of counted pixels per palette id */
  shares: Record<string, number>
}

/**
 * Dominant colours by k-means (k=4) in CIELAB over the garment pixels, then
 * the nearest palette colour per cluster. Pixels with alpha < 128 are ignored
 * (background removed); without alpha, pixels close to the border colour are
 * treated as background.
 */
export function dominantColours(pixels: ImageData, palette: Palette, hasAlpha: boolean): ColourResult {
  const { data, width, height } = pixels
  const points: Lab[] = []
  let border: Lab | null = null
  if (!hasAlpha) {
    const samples: Lab[] = []
    const step = Math.max(1, Math.floor(width / 16))
    for (let x = 0; x < width; x += step) {
      samples.push(labAt(data, x, 0, width), labAt(data, x, height - 1, width))
    }
    for (let y = 0; y < height; y += step) {
      samples.push(labAt(data, 0, y, width), labAt(data, width - 1, y, width))
    }
    border = {
      l: samples.reduce((s, p) => s + p.l, 0) / samples.length,
      a: samples.reduce((s, p) => s + p.a, 0) / samples.length,
      b: samples.reduce((s, p) => s + p.b, 0) / samples.length,
    }
  }
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)))
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4
      // Only fully opaque pixels: downscaled cutout edges blend towards black.
      if (hasAlpha && data[i + 3] < 240) continue
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2])
      if (border && deltaE(lab, border) < 12) continue
      points.push(lab)
    }
  }
  if (points.length < 8) {
    return { primary: 'grey', secondary: null, shares: {} }
  }
  const k = Math.min(4, points.length)
  let centroids = points.filter((_, i) => i % Math.floor(points.length / k) === 0).slice(0, k)
  let assignment = new Array<number>(points.length).fill(0)
  for (let iter = 0; iter < 12; iter++) {
    assignment = points.map((p) => {
      let best = 0
      let bestD = Infinity
      centroids.forEach((c, ci) => {
        const d = deltaE(p, c)
        if (d < bestD) {
          bestD = d
          best = ci
        }
      })
      return best
    })
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, n: 0 }))
    points.forEach((p, i) => {
      const s = sums[assignment[i]]
      s.l += p.l
      s.a += p.a
      s.b += p.b
      s.n += 1
    })
    centroids = sums.map((s, i) => (s.n ? { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n } : centroids[i]))
  }
  const counts = centroids.map((_, ci) => assignment.filter((a) => a === ci).length)
  const paletteLab = palette.colours.map((c) => ({ id: c.id, lab: hexToLab(c.hex) }))
  const shares: Record<string, number> = {}
  centroids.forEach((c, ci) => {
    let best = paletteLab[0]
    let bestD = Infinity
    for (const p of paletteLab) {
      const d = deltaE(c, p.lab)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    shares[best.id] = (shares[best.id] ?? 0) + counts[ci] / points.length
  })
  const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1])
  return { primary: ranked[0][0], secondary: ranked[1] && ranked[1][1] >= 0.15 ? ranked[1][0] : null, shares }
}

function labAt(data: Uint8ClampedArray, x: number, y: number, width: number): Lab {
  const i = (y * width + x) * 4
  return rgbToLab(data[i], data[i + 1], data[i + 2])
}
