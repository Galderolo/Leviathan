/** A picture as 8-bit RGBA pixels, row by row from the top-left corner. */
export interface Pixels {
  width: number
  height: number
  rgba: Uint8Array
}

/** Larger images are not drawn: a small run-length encoded file could claim any size (4096 × 4096 is 64 MB). */
const MAX_PIXELS = 4096 * 4096

/**
 * Reads a TGA image (Truevision's format, common for game textures): colour-mapped, true-colour or greyscale,
 * uncompressed or run-length encoded, 8, 15, 16, 24 or 32 bits a pixel, stored from either corner. Throws for
 * anything else or a file cut short.
 */
export function decodeTga(bytes: Uint8Array): Pixels {
  if (bytes.length < 18) throw new Error('Not a TGA image')
  const idLength = bytes[0]
  const mapType = bytes[1]
  const type = bytes[2]
  const mapFirst = bytes[3] | (bytes[4] << 8)
  const mapLength = bytes[5] | (bytes[6] << 8)
  const mapDepth = bytes[7]
  const width = bytes[12] | (bytes[13] << 8)
  const height = bytes[14] | (bytes[15] << 8)
  const depth = bytes[16]
  const descriptor = bytes[17]
  const alphaBits = descriptor & 0x0f
  const fromTop = (descriptor & 0x20) !== 0
  const fromRight = (descriptor & 0x10) !== 0

  const kind = type & 7
  const rle = (type & 8) !== 0
  if (![1, 2, 3].includes(kind) || type > 11) throw new Error(`Unsupported TGA image type ${type}`)
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('Unsupported TGA image size')
  if (kind === 1 && (mapType !== 1 || depth !== 8)) throw new Error('Unsupported colour-mapped TGA')
  if (kind === 2 && ![15, 16, 24, 32].includes(depth)) throw new Error(`Unsupported TGA depth ${depth}`)
  if (kind === 3 && depth !== 8) throw new Error(`Unsupported greyscale TGA depth ${depth}`)

  let at = 18 + idLength
  // The colour map, as RGBA entries.
  let map: Uint8Array | null = null
  if (mapType === 1) {
    const entryBytes = Math.ceil(mapDepth / 8)
    if (![2, 3, 4].includes(entryBytes)) throw new Error(`Unsupported TGA colour map depth ${mapDepth}`)
    if (at + mapLength * entryBytes > bytes.length) throw new Error('TGA image cut short')
    if (kind === 1) {
      map = new Uint8Array((mapFirst + mapLength) * 4)
      for (let i = 0; i < mapLength; i++) {
        colour(bytes, at + i * entryBytes, mapDepth, alphaBits > 0, map, (mapFirst + i) * 4)
      }
    }
    at += mapLength * entryBytes
  }

  const pixelBytes = Math.ceil(depth / 8)
  const count = width * height
  // The pixels as stored, before they are put in place.
  const stored = new Uint8Array(count * 4)
  const read = (from: number, to: number) => {
    if (kind === 3) {
      stored[to] = stored[to + 1] = stored[to + 2] = bytes[from]
      stored[to + 3] = 255
    } else if (kind === 1) {
      const index = bytes[from] * 4
      if (!map || index + 3 >= map.length) throw new Error('TGA colour index out of the map')
      stored.set(map.subarray(index, index + 4), to)
    } else {
      colour(bytes, from, depth, alphaBits > 0, stored, to)
    }
  }
  if (!rle) {
    if (at + count * pixelBytes > bytes.length) throw new Error('TGA image cut short')
    for (let i = 0; i < count; i++) read(at + i * pixelBytes, i * 4)
  } else {
    let i = 0
    while (i < count) {
      if (at >= bytes.length) throw new Error('TGA image cut short')
      const packet = bytes[at++]
      const n = Math.min((packet & 0x7f) + 1, count - i)
      if (packet & 0x80) {
        if (at + pixelBytes > bytes.length) throw new Error('TGA image cut short')
        read(at, i * 4)
        for (let k = 1; k < n; k++) stored.copyWithin((i + k) * 4, i * 4, i * 4 + 4)
        at += pixelBytes
      } else {
        if (at + n * pixelBytes > bytes.length) throw new Error('TGA image cut short')
        for (let k = 0; k < n; k++) read(at + k * pixelBytes, (i + k) * 4)
        at += n * pixelBytes
      }
      i += n
    }
  }

  // Rows from the top, each from the left.
  const rgba = new Uint8Array(count * 4)
  for (let y = 0; y < height; y++) {
    const row = fromTop ? y : height - 1 - y
    for (let x = 0; x < width; x++) {
      const column = fromRight ? width - 1 - x : x
      const from = (row * width + column) * 4
      rgba.set(stored.subarray(from, from + 4), (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

/** One stored colour (blue first; 15 and 16 bits are five a channel) as RGBA into `out` at `to`. */
function colour(bytes: Uint8Array, from: number, depth: number, alpha: boolean, out: Uint8Array, to: number): void {
  if (depth === 15 || depth === 16) {
    const v = bytes[from] | (bytes[from + 1] << 8)
    const five = (x: number) => (x << 3) | (x >> 2)
    out[to] = five((v >> 10) & 31)
    out[to + 1] = five((v >> 5) & 31)
    out[to + 2] = five(v & 31)
    out[to + 3] = depth === 16 && alpha ? (v & 0x8000 ? 255 : 0) : 255
    return
  }
  out[to] = bytes[from + 2]
  out[to + 1] = bytes[from + 1]
  out[to + 2] = bytes[from]
  out[to + 3] = depth === 32 && alpha ? bytes[from + 3] : 255
}
