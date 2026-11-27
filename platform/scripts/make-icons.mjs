// Generates the installable-app icons (public/icon-192.png, icon-512.png, apple-touch-icon.png) and the browser-tab
// icon (src/app/favicon.ico): the "hola conversa" mark, a buganvilia tile (#D11C7F) with a white speech bubble and
// three dots (two tinta, one mango). No dependencies: a tiny PNG encoder over node:zlib, 4x4 supersampled edges.
// Run: node scripts/make-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size, rgba = false) {
  const bpp = rgba ? 4 : 3; // RGBA for the .ico (Next decodes it and requires RGBA)
  const bg = [0xd1, 0x1c, 0x7f], fg = [255, 255, 255], ink = [0x16, 0x13, 0x3d], mango = [0xff, 0xc5, 0x3d];
  const raw = Buffer.alloc((size * bpp + 1) * size);
  const s = size / 100; // design on a 100-unit grid
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inTail = (x, y) => { // triangle (30,66) (30,82) (46,66)
    const [ax, ay, bx, by, cx, cy] = [30, 66, 30, 82, 46, 66];
    const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const colorAt = (u, v) => {
    if ((u - 64) ** 2 + (v - 46) ** 2 <= 4.6 ** 2) return mango;
    if ([36, 50].some((cx) => (u - cx) ** 2 + (v - 46) ** 2 <= 4.6 ** 2)) return ink;
    return inRound(u, v, 20, 24, 80, 68, 12) || inTail(u, v) ? fg : bg;
  };
  const N = 4; // supersampling per axis
  for (let y = 0; y < size; y++) {
    raw[y * (size * bpp + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const c = colorAt((x + (i + 0.5) / N) / s, (y + (j + 0.5) / N) / s);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * bpp + 1) + 1 + x * bpp;
      raw[o] = Math.round(acc[0] / (N * N)); raw[o + 1] = Math.round(acc[1] / (N * N)); raw[o + 2] = Math.round(acc[2] / (N * N));
      if (rgba) raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = rgba ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), icon(size));
  console.log("wrote", name);
}

// favicon.ico = an ICO container holding one 32x32 PNG (supported by every current browser).
const png32 = icon(32, true);
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type icon, 1 image
head[6] = 32; head[7] = 32; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png32.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([head, png32]));
console.log("wrote favicon.ico");
