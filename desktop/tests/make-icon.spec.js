// The icon set is generated from code, so the "monochrome" rule and the PNG/ICO/
// ICNS containers are themselves testable: a regression here ships a coloured or
// malformed icon that no reviewer looks at (the files are git-ignored and
// regenerated on every build).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_ICONS_DIR,
  adler32,
  crc32,
  deflateStored,
  encodePng,
  main,
  makeIcon,
  makeIco,
  makeIcns,
  paint,
  writeIconSet,
} from '../scripts/make-icon.mjs'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const roots = []

function tempDir() {
  const root = mkdtempSync(join(tmpdir(), 'agentbuddy-icon-'))
  roots.push(root)
  return root
}

const pngSize = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)]

/** Walk the chunk list, so the container itself can be asserted, not guessed. */
function chunks(png) {
  const found = []
  for (let off = 8; off < png.length; ) {
    const length = png.readUInt32BE(off)
    const type = png.subarray(off + 4, off + 8).toString('ascii')
    const data = png.subarray(off + 8, off + 8 + length)
    found.push({ type, data, crc: png.readUInt32BE(off + 8 + length) })
    off += 12 + length
  }
  return found
}

const idat = (png) => {
  const parts = chunks(png)
    .filter((chunk) => chunk.type === 'IDAT')
    .map((chunk) => chunk.data)
  return Buffer.concat(parts)
}

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('checksums', () => {
  it('matches the reference values for "abc"', () => {
    const bytes = Buffer.from('abc', 'ascii')
    expect(adler32(bytes)).toBe(0x024d0127)
    expect(crc32(bytes)).toBe(0x352441c2)
  })

  it('wraps adler32 at the modulus instead of overflowing', () => {
    // 256 x 0xff pushes both sums past 65521, so the modulo is exercised.
    const big = Buffer.alloc(256, 0xff)
    expect(adler32(big)).toBeGreaterThanOrEqual(0)
    expect(adler32(big)).toBeLessThan(65521 * 65521)
    expect(crc32(big)).toBeGreaterThanOrEqual(0)
  })
})

describe('deflateStored', () => {
  it('keeps a small payload in a single stored block', () => {
    const out = deflateStored(Buffer.from('icons', 'ascii'))
    expect([...out.subarray(0, 2)]).toEqual([0x78, 0x01])
    // BFINAL|BTYPE byte, then the little-endian length and its complement.
    expect(out[2]).toBe(0x01)
    expect(out.readUInt16LE(3)).toBe(5)
    expect(out.readUInt16LE(5)).toBe(0xfffa)
    expect(out.length).toBe(2 + 5 + 5 + 4)
  })

  it('splits a payload past 65535 bytes into several blocks', () => {
    const data = Buffer.alloc(70000, 0x41)
    const out = deflateStored(data)
    expect(out[2] & 0x01).toBe(0) // first block is not the last
    expect(out[2 + 5 + 65535] & 0x01).toBe(1) // second block is
    expect(out.length).toBe(2 + (5 + 65535) + (5 + 4465) + 4)
  })
})

describe('encodePng', () => {
  it('writes a signature, an IHDR, the filtered scanlines and an IEND', () => {
    const size = 2
    const rgba = Buffer.alloc(size * size * 4)
    rgba.fill(0x7f)
    const png = encodePng(rgba, size)
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC)
    expect(pngSize(png)).toEqual([size, size])
    expect(chunks(png).map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    for (const chunk of chunks(png)) {
      // Every chunk carries crc32(type + data), so a corrupt icon cannot pass.
      expect(chunk.crc).toBe(crc32(Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data])))
    }
    expect(chunks(png).at(-1).data.length).toBe(0)
  })

  it('deflates to scanlines a real inflater accepts', () => {
    // Regression: the stored-block header used to put BFINAL in bit 7, so the
    // IDAT was an unterminated stream and every decoder answered "unexpected
    // end of file" — a PNG container around bytes that could never be decoded.
    for (const size of [32, 128]) {
      const raw = inflateSync(idat(makeIcon(size)))
      expect(raw.length).toBe((size * 4 + 1) * size)
      for (let y = 0; y < size; y++) {
        expect(raw[y * (size * 4 + 1)]).toBe(0) // filter type: none
      }
    }
  })
})

describe('paint', () => {
  it('leaves the corner transparent and the tile opaque', () => {
    expect(paint(0, 0, 32)).toEqual([0, 0, 0, 0])
    const centre = paint(16, 16, 32)
    expect(centre[3]).toBe(255)
    expect(centre[0]).toBe(centre[1])
    expect(centre[1]).toBe(centre[2])
  })

  it('never leaves the greyscale axis, glyph ink included', () => {
    const inked = []
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const [r, g, b, a] = paint(x, y, 32)
        expect([r, g, b]).toEqual([g, g, g])
        if (a === 255 && g > 0x18) inked.push(g)
        if (a > 0 && a < 255) expect(a).toBeGreaterThan(0)
      }
    }
    // The "A" is drawn: at least one opaque pixel is lighter than the tile ink.
    expect(inked.length).toBeGreaterThan(0)
  })

  it('ramps the anti-aliased edge between transparent and opaque', () => {
    const alphas = new Set()
    for (let x = 0; x < 32; x++) alphas.add(paint(x, 0, 32)[3])
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true)
  })
})

describe('makeIcon', () => {
  it('produces a square PNG of the requested size', () => {
    for (const size of [32, 128]) {
      const png = makeIcon(size)
      expect(png.subarray(0, 8)).toEqual(PNG_MAGIC)
      expect(pngSize(png)).toEqual([size, size])
      expect(png[24]).toBe(8) // bit depth
      expect(png[25]).toBe(6) // colour type: RGBA
    }
  })

  it('is deterministic', () => {
    expect(makeIcon(32).equals(makeIcon(32))).toBe(true)
  })
})

describe('containers', () => {
  it('wraps a 256px PNG in an ICO directory entry', () => {
    const ico = makeIco()
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    expect(ico.readUInt16LE(4)).toBe(1) // one image
    expect(ico[6]).toBe(0) // 0 means 256px
    expect(ico[7]).toBe(0)
    expect(ico.readUInt16LE(10)).toBe(1) // planes
    expect(ico.readUInt16LE(12)).toBe(32) // bpp
    expect(ico.readUInt32LE(14)).toBe(ico.length - 22) // payload length
    expect(ico.readUInt32LE(18)).toBe(22) // payload offset
    expect(ico.subarray(22, 30)).toEqual(PNG_MAGIC)
    expect(ico.subarray(22).equals(makeIcon(256))).toBe(true)
  })

  it('wraps a 256px PNG under the ic07 OSType in an ICNS', () => {
    const icns = makeIcns()
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    expect(icns.subarray(8, 12).toString('ascii')).toBe('ic07')
    expect(icns.readUInt32BE(12)).toBe(icns.length - 12)
    expect(icns.subarray(16).equals(makeIcon(256))).toBe(true)
  })
})

describe('writeIconSet', () => {
  it('writes the five bundler files plus the 1024px master', () => {
    const iconsDir = join(tempDir(), 'icons')
    const assetsDir = join(tempDir(), 'assets')
    const written = writeIconSet({ iconsDir, assetsDir })
    expect(written).toEqual([
      '32x32.png',
      '128x128.png',
      '128x128@2x.png',
      'icon.ico',
      'icon.icns',
      'app-icon.png',
    ])
    expect(readdirSync(iconsDir).sort()).toEqual(
      ['128x128.png', '128x128@2x.png', '32x32.png', 'icon.icns', 'icon.ico'].sort(),
    )
    expect(pngSize(readFileSync(join(iconsDir, '128x128@2x.png')))).toEqual([256, 256])
    expect(readFileSync(join(iconsDir, 'icon.ico')).subarray(0, 4)).toEqual(
      Buffer.from([0x00, 0x00, 0x01, 0x00]),
    )
    expect(readFileSync(join(iconsDir, 'icon.icns')).subarray(0, 4).toString('ascii')).toBe('icns')
    expect(pngSize(readFileSync(join(assetsDir, 'app-icon.png')))).toEqual([1024, 1024])
  })

  it('creates both directories when they are missing', () => {
    const base = tempDir()
    const iconsDir = join(base, 'deep', 'icons')
    const assetsDir = join(base, 'deep', 'assets')
    writeIconSet({ iconsDir, assetsDir })
    expect(readdirSync(iconsDir)).toHaveLength(5)
    expect(readdirSync(assetsDir)).toEqual(['app-icon.png'])
  })
})

describe('main', () => {
  it('falls back to the checkout icons directory when only assets are given', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const assetsDir = join(tempDir(), 'assets')
    expect(main({ assetsDir })).toBe(0)
    // `src-tauri/icons/` is git-ignored and regenerated on every build, so
    // writing it here proves the default without touching a tracked file.
    expect(log).toHaveBeenCalledWith('wrote monochrome icon set to', DEFAULT_ICONS_DIR)
    expect(readdirSync(DEFAULT_ICONS_DIR)).toHaveLength(5)
    expect(readdirSync(assetsDir)).toEqual(['app-icon.png'])
  })

  it('renders into the injected directories and reports them', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const iconsDir = join(tempDir(), 'icons')
    const assetsDir = join(tempDir(), 'assets')
    expect(main({ iconsDir, assetsDir })).toBe(0)
    expect(log).toHaveBeenCalledWith('wrote monochrome icon set to', iconsDir)
    expect(readdirSync(iconsDir)).toHaveLength(5)
  })
})
