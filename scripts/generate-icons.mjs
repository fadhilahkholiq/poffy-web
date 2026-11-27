import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function hexToRgba(hex) {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    255
  ];
}

function fillRoundedRect(buf, w, h, rx, ry, rw, rh, radius, color) {
  const [r, g, b, a] = hexToRgba(color);
  const x0 = Math.max(0, Math.floor(rx));
  const y0 = Math.max(0, Math.floor(ry));
  const x1 = Math.min(w, Math.ceil(rx + rw));
  const y1 = Math.min(h, Math.ceil(ry + rh));
  const rad = Math.max(0, radius);

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      let inside = true;
      if (rad > 0) {
        const cx =
          x < rx + rad ? rx + rad : x > rx + rw - rad ? rx + rw - rad : x;
        const cy =
          y < ry + rad ? ry + rad : y > ry + rh - rad ? ry + rh - rad : y;
        const dx = x - cx;
        const dy = y - cy;
        if (
          (x < rx + rad || x > rx + rw - rad) &&
          (y < ry + rad || y > ry + rh - rad) &&
          dx * dx + dy * dy > rad * rad
        ) {
          inside = false;
        }
      }
      if (inside) {
        const idx = (y * w + x) * 4;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = a;
      }
    }
  }
}

// 1. PWA 192x192 & 512x512 PNG icons matching iOS / Apple Light Studio SVG emblem
function buildAppIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 192;
  fillRoundedRect(buf, size, size, 0, 0, size, size, 44 * s, '#0071e3');
  fillRoundedRect(buf, size, size, 34 * s, 28 * s, 88 * s, 114 * s, 18 * s, '#73b5f4');
  fillRoundedRect(buf, size, size, 70 * s, 50 * s, 88 * s, 114 * s, 18 * s, '#ffffff');
  fillRoundedRect(buf, size, size, 88 * s, 76 * s, 44 * s, 10 * s, 5 * s, '#0071e3');
  fillRoundedRect(buf, size, size, 88 * s, 98 * s, 52 * s, 8 * s, 4 * s, '#d1d1d6');
  fillRoundedRect(buf, size, size, 88 * s, 116 * s, 38 * s, 8 * s, 4 * s, '#e5e5ea');
  return encodePng(size, size, buf);
}

// 2. Social Open Graph 1200x630 PNG card in iOS / macOS Light Studio palette
function buildOgCard() {
  const w = 1200;
  const h = 630;
  const buf = Buffer.alloc(w * h * 4);
  fillRoundedRect(buf, w, h, 0, 0, w, h, 0, '#ffffff');
  // Recessed studio showcase panel
  fillRoundedRect(buf, w, h, 48, 48, 1104, 534, 36, '#f5f5f7');
  // iOS blue app tile + layered white document sheets on right
  fillRoundedRect(buf, w, h, 720, 130, 340, 340, 76, '#0071e3');
  fillRoundedRect(buf, w, h, 780, 182, 156, 202, 32, '#73b5f4');
  fillRoundedRect(buf, w, h, 844, 222, 156, 202, 32, '#ffffff');
  fillRoundedRect(buf, w, h, 874, 268, 80, 18, 9, '#0071e3');
  fillRoundedRect(buf, w, h, 874, 306, 96, 14, 7, '#d1d1d6');
  fillRoundedRect(buf, w, h, 874, 336, 70, 14, 7, '#e5e5ea');
  // Status pill & clean typographic blocks on left
  fillRoundedRect(buf, w, h, 100, 120, 220, 44, 22, '#e8f8ed');
  fillRoundedRect(buf, w, h, 122, 134, 16, 16, 8, '#34c759');
  fillRoundedRect(buf, w, h, 100, 198, 480, 54, 14, '#1d1d1f');
  fillRoundedRect(buf, w, h, 100, 274, 390, 36, 12, '#6e6e73');
  fillRoundedRect(buf, w, h, 100, 344, 140, 80, 20, '#e8f2ff');
  fillRoundedRect(buf, w, h, 256, 344, 140, 80, 20, '#e6f7fa');
  fillRoundedRect(buf, w, h, 412, 344, 140, 80, 20, '#f3ebff');
  fillRoundedRect(buf, w, h, 100, 448, 210, 52, 26, '#0071e3');
  fillRoundedRect(buf, w, h, 326, 448, 210, 52, 26, '#ffffff');
  return encodePng(w, h, buf);
}

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), buildAppIcon(192));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), buildAppIcon(512));
fs.writeFileSync(path.join(iconsDir, 'og-card.png'), buildOgCard());
console.log('Generated PNG icons: icon-192.png, icon-512.png, og-card.png');
