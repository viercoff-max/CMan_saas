// Generates the installable-app icons (public/icon-192.png, icon-512.png, apple-touch-icon.png): the platform
// teal (#0F766E) with a white speech bubble. No dependencies: a tiny PNG encoder over node:zlib.
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

function icon(size) {
  const bg = [0x0f, 0x76, 0x6e], fg = [255, 255, 255];
  const raw = Buffer.alloc((size * 3 + 1) * size);
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
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / s, v = (y + 0.5) / s;
      const bubble = inRound(u, v, 20, 24, 80, 68, 12) || inTail(u, v);
      const dot = [36, 50, 64].some((cx) => (u - cx) ** 2 + (v - 46) ** 2 <= 4.2 ** 2);
      const c = bubble && !dot ? fg : bg;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), icon(size));
  console.log("wrote", name);
}
