'use strict';

// Generates the placeholder app/driver images (green background, white battery with bolt).
// Usage: node tools/makepng.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const table = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x / w, y / h, w / h);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bolt = [[35, 18], [24, 36], [32, 36], [29, 50], [41, 30], [33, 30]].map(([x, y]) => [x / 64, y / 64]);
function pixel(u, v, aspect) {
  let x = u; let y = v;
  if (aspect > 1) x = (u - 0.5) * aspect + 0.5; else y = (v - 0.5) / aspect + 0.5;
  const green = [31, 138, 76]; const white = [255, 255, 255];
  const body = x > 14 / 64 && x < 50 / 64 && y > 10 / 64 && y < 58 / 64;
  const inner = x > 18 / 64 && x < 46 / 64 && y > 14 / 64 && y < 54 / 64;
  const cap = x > 24 / 64 && x < 40 / 64 && y > 4 / 64 && y <= 10 / 64;
  if (inPoly(x, y, bolt) || cap || (body && !inner)) return white;
  return green;
}

const root = path.join(__dirname, '..');
const out = (p, w, h) => fs.writeFileSync(path.join(root, p), png(w, h, pixel));
out('assets/images/small.png', 250, 175);
out('assets/images/large.png', 500, 350);
out('assets/images/xlarge.png', 1000, 700);
out('tools/images/driver-small.png', 75, 75);
out('tools/images/driver-large.png', 500, 500);
out('tools/images/driver-xlarge.png', 1000, 1000);
// Widget previews: price bars coloured by planned action
function widgetPixel(bg, fg) {
  const prices = [18, 17, 16, 15, 14, 16, 22, 26, 21, 15, 10, 8, 7, 8, 12, 17, 24, 29, 30, 28, 25, 22, 20, 19];
  const actions = prices.map((p, i) => (i >= 11 && i <= 13 ? 'c' : p >= 25 ? 'd' : 'h'));
  const col = { c: [31, 138, 76], d: [208, 138, 30], h: [154, 165, 173] };
  return (u, v) => {
    const x0 = 0.08; const x1 = 0.92; const yBase = 0.78; const yTop = 0.28;
    if (u > x0 && u < x1 && v > yTop - 0.02 && v < yBase) {
      const i = Math.floor(((u - x0) / (x1 - x0)) * prices.length);
      const frac = (((u - x0) / (x1 - x0)) * prices.length) % 1;
      const top = yBase - (prices[i] / 32) * (yBase - yTop);
      if (frac > 0.12 && frac < 0.88 && v > top) return col[actions[i]];
    }
    // "SoC" text block placeholder
    if (v > 0.1 && v < 0.18 && u > 0.08 && u < 0.3) return fg;
    if (v > 0.12 && v < 0.16 && u > 0.34 && u < 0.7) return fg.map((c) => Math.round((c + bg[0]) / 2));
    return bg;
  };
}
fs.writeFileSync(path.join(root, 'widgets/plan/preview-light.png'), png(1024, 1024, widgetPixel([255, 255, 255], [29, 37, 43])));
fs.writeFileSync(path.join(root, 'widgets/plan/preview-dark.png'), png(1024, 1024, widgetPixel([28, 30, 33], [235, 238, 240])));
console.log('images written');
