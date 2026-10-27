// Zero-dependency monochrome app icon generator for agentbuddy.
//
// `tauri icon` is the real path when rsvg / ImageMagick / PIL are present, but a
// from-scratch build (CI, a minimal laptop) has none of those. This script writes
// the exact PNG set Tauri's bundler expects, in pure greyscale, so the build never
// blocks on a system image tool. It draws a rounded square with a hairline border
// and the agentbuddy glyph — no hue anywhere, matching the app's monochrome rule.
//
// Output: ../src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.ico,icon.icns}
//
// Usage: bun scripts/make-icon.mjs   (or: node scripts/make-icon.mjs)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");

// ---- minimal, dependency-free PNG encoder (8-bit RGBA, no compression frills) ----

// Adler-32 + zlib (deflate stored blocks) so we don't need any external lib.
function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function deflateStored(data) {
  // zlib header (deflate, no compression) + stored blocks + adler32 trailer.
  const out = [0x78, 0x01];
  const max = 65535;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + max, data.length);
    const block = data.subarray(i, end);
    const last = end === data.length ? 1 : 0;
    out.push((last << 7) | 0); // BFINAL + BTYPE=00 (stored)
    out.push(block.length & 0xff, (block.length >> 8) & 0xff);
    out.push((~block.length & 0xff), (~block.length >> 8) & 0xff);
    for (const b of block) out.push(b);
    i = end;
  }
  const adler = adler32(data);
  out.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Buffer.from(out);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Prepend a filter byte (0 = none) per scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateStored(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- pure greyscale glyph drawing ----

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Returns [r,g,b,a] for one pixel. Greyscale only: r=g=b.
function paint(x, y, size) {
  const u = x / (size - 1);
  const v = y / (size - 1);

  // Rounded-square tile background: a soft diagonal wash from #161616 to #2a2a2a.
  const inset = size * 0.16;
  const radius = size * 0.22;
  const dx = Math.min(x, size - 1 - x) - inset;
  const dy = Math.min(y, size - 1 - y) - inset;
  const inside = dx >= 0 && dy >= 0 && Math.hypot(Math.min(dx - radius, 0), Math.min(dy - radius, 0)) <= 0;
  if (!inside) return [0, 0, 0, 0];

  const wash = mix(0x16, 0x2a, u * 0.6 + v * 0.4);
  let r = wash;
  let g = wash;
  let b = wash;

  // Hairline border just inside the rounded edge.
  const borderDist = Math.min(dx, dy);
  if (borderDist < size * 0.012) {
    const edge = mix(0x66, 0x99, u);
    r = g = b = edge;
  }

  // The agentbuddy glyph: a central node ring with four satellites, drawn in a
  // lighter grey so it reads on the dark tile.
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const nodeR = size * 0.13;
  const sat = size * 0.3;
  const dCenter = Math.hypot(x - cx, y - cy);
  const ring = Math.abs(dCenter - nodeR);
  const ink = mix(0xc8, 0xff, (u + v) / 2);
  let glyph = -1;
  if (ring < size * 0.022) glyph = 1; // central ring
  if (dCenter < size * 0.05) glyph = 1; // central dot
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = cx + sx * sat;
    const py = cy + sy * sat;
    if (Math.hypot(x - px, y - py) < size * 0.03) glyph = 1;
  }
  if (glyph === 1) {
    r = g = b = ink;
  }

  return [r, g, b, 255];
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const o = (y * size + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return encodePng(rgba, size);
}

function makeIco() {
  // ICO wraps a 32-bit 256x256 PNG (true-color + alpha) with a directory entry.
  const png = makeIcon(256);
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); // reserved
  hdr.writeUInt16LE(1, 2); // type = icon
  hdr.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width (0 means 256)
  entry[1] = 0; // height
  entry[2] = 0; // colors
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // bytes
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([hdr, entry, png]);
}

// ICNS: a 256x256 PNG stored under the `ic07` (PNG) OSType.
function makeIcns() {
  const png = makeIcon(256);
  const body = Buffer.concat([Buffer.from("ic07", "ascii"), (() => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(png.length + 4, 0);
    return l;
  })(), png]);
  const head = Buffer.concat([Buffer.from("icns", "ascii"), (() => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(body.length + 8, 0);
    return l;
  })()]);
  return Buffer.concat([head, body]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256]]) {
  writeFileSync(resolve(OUT_DIR, name), makeIcon(size));
}
writeFileSync(resolve(OUT_DIR, "icon.ico"), makeIco());
writeFileSync(resolve(OUT_DIR, "icon.icns"), makeIcns());

// The 1024px source the `tauri icon` pipeline expects, written alongside the set
// so `bun run icons` can re-derive everything from a single greyscale master.
const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
mkdirSync(ASSETS_DIR, { recursive: true });
writeFileSync(resolve(ASSETS_DIR, "app-icon.png"), makeIcon(1024));
console.log("wrote monochrome icon set to", OUT_DIR);
