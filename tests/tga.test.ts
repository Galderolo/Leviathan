import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../src/main/png'
import { decodeTga } from '../src/shared/tga'

/** A TGA header: image type, size, bits per pixel, descriptor (bit 5: rows from the top; low bits: alpha bits). */
function header(type: number, width: number, height: number, depth: number, descriptor: number, map?: number[]) {
  const h = new Uint8Array(18)
  h[1] = map ? 1 : 0
  h[2] = type
  if (map) {
    h[5] = map[0] & 0xff
    h[6] = map[0] >> 8
    h[7] = map[1]
  }
  h[12] = width & 0xff
  h[13] = width >> 8
  h[14] = height & 0xff
  h[15] = height >> 8
  h[16] = depth
  h[17] = descriptor
  return [...h]
}
const tga = (...parts: number[][]) => Uint8Array.from(parts.flat())
const pixels = (rgba: Uint8Array) => [...rgba]

describe('decodeTga', () => {
  it('reads 24-bit colour stored from the bottom row up, as most TGAs are', () => {
    // 2×2: bottom row red, green; top row blue, white (stored blue-green-red).
    const image = decodeTga(tga(header(2, 2, 2, 24, 0), [0, 0, 255, 0, 255, 0], [255, 0, 0, 255, 255, 255]))
    expect([image.width, image.height]).toEqual([2, 2])
    expect(pixels(image.rgba)).toEqual([0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('reads 32-bit colour with alpha, stored from the top row down', () => {
    const image = decodeTga(tga(header(2, 2, 1, 32, 0x28), [10, 20, 30, 128, 40, 50, 60, 0]))
    expect(pixels(image.rgba)).toEqual([30, 20, 10, 128, 60, 50, 40, 0])
  })

  it('takes 32-bit pixels as opaque when the header says they have no alpha', () => {
    const image = decodeTga(tga(header(2, 1, 1, 32, 0x20), [10, 20, 30, 0]))
    expect(pixels(image.rgba)).toEqual([30, 20, 10, 255])
  })

  it('reads run-length encoded pixels, runs and raw packets alike', () => {
    // A run of 3 red pixels, then 1 raw blue one, in a 4×1 image.
    const image = decodeTga(tga(header(10, 4, 1, 24, 0x20), [0x82, 0, 0, 255, 0x00, 255, 0, 0]))
    expect(pixels(image.rgba)).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255])
  })

  it('reads greyscale and colour-mapped images', () => {
    expect(pixels(decodeTga(tga(header(3, 2, 1, 8, 0x20), [0, 200])).rgba)).toEqual([0, 0, 0, 255, 200, 200, 200, 255])
    // A map of two 24-bit colours (green, red), then indexes 1 and 0.
    const mapped = decodeTga(tga(header(1, 2, 1, 8, 0x20, [2, 24]), [0, 255, 0, 0, 0, 255], [1, 0]))
    expect(pixels(mapped.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('reads 16-bit colour, five bits a channel', () => {
    // 0x7c00: red at full; 0x001f: blue at full (little-endian).
    const image = decodeTga(tga(header(2, 2, 1, 16, 0x20), [0x00, 0x7c, 0x1f, 0x00]))
    expect(pixels(image.rgba)).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  it('refuses what is not a TGA it can read', () => {
    expect(() => decodeTga(Uint8Array.from([1, 2, 3]))).toThrow()
    expect(() => decodeTga(tga(header(2, 4, 4, 24, 0), [1, 2, 3]))).toThrow()
    expect(() => decodeTga(tga(header(5, 1, 1, 24, 0), [1, 2, 3]))).toThrow()
    // A run as big as the header claims, in a few bytes.
    expect(() => decodeTga(tga(header(10, 16384, 16384, 24, 0), [0xff, 0, 0, 0]))).toThrow()
  })
})

describe('encodePng', () => {
  it('writes the pixels as a PNG', async () => {
    const png = await encodePng(2, 1, Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 128]))
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(2)
    expect(png.readUInt32BE(20)).toBe(1)
    const idat = png.indexOf('IDAT')
    const data = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))
    expect([...data]).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 128])
  })
})
