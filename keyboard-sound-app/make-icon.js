// 生成应用/托盘图标 icon.png（一个渐变圆角键盘图标），无外部依赖
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 64; // 画布
// ---- CRC32 表 ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const scan = Buffer.alloc(S * (1 + S * 4)); // filter byte + RGBA per row
  for (let y = 0; y < S; y++) {
    const row = y * (1 + S * 4);
    scan[row] = 0; // filter none
    raw.copy(scan, row + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const px = Buffer.alloc(S * S * 4);
const R = 14; // 圆角
const cx = S / 2, cy = S / 2;
const round = (x, y) =>
  (x < R && y < R ? (x - R) ** 2 + (y - R) ** 2 <= R * R :
   x > S - R && y < R ? (x - (S - R)) ** 2 + (y - R) ** 2 <= R * R :
   x < R && y > S - R ? (x - R) ** 2 + (y - (S - R)) ** 2 <= R * R :
   x > S - R && y > S - R ? (x - (S - R)) ** 2 + (y - (S - R)) ** 2 <= R * R : true);

// 键盘字形：若干小矩形按键
const keys = [];
const o = 10, g = 2.5, kh = 7;
const rows = [ [6,4], [5,4], [5,4], [6,4] ]; // 每行按键个数
let ky = o;
for (let r = 0; r < rows.length; r++) {
  const n = rows[r][0], kw = (S - o * 2 - g * (n - 1)) / n;
  let kx = o;
  for (let c = 0; c < n; c++) { keys.push([kx, ky, kw, kh]); kx += kw + g; }
  ky += kh + g;
}
// 空格
keys.push([o, ky, S - o * 2, kh]);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let i = (y * S + x) * 4;
    let r = 0, g2 = 0, b = 0, a = 0;
    if (round(x, y)) {
      // 渐变 body
      const t = (x + y) / (2 * S);
      r = 74 + 60 * t; g2 = 118 + 70 * (1 - t); b = 190 + 40 * t;
      a = 255;
      // 按键（白色）
      for (const [kx, ky, kw, kh] of keys) {
        if (x >= kx && x < kx + kw && y >= ky && y < ky + kh) { r = 240; g2 = 246; b = 255; break; }
      }
    }
    px[i] = r; px[i + 1] = g2; px[i + 2] = b; px[i + 3] = a;
  }
}
const png = encodePNG(px);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);

// 同时生成 icon.ico（含 PNG 的 ICO，Vista+ 支持）
function buildIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: icon
  header.writeUInt16LE(1, 4);       // count
  const entry = Buffer.alloc(16);
  entry[0] = 64; entry[1] = 64;     // 64x64
  entry[2] = 0; entry[3] = 0;       // colors
  entry.writeUInt16LE(1, 4);        // planes
  entry.writeUInt16LE(32, 6);       // bit count
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);  // data offset
  return Buffer.concat([header, entry, pngBuf]);
}
fs.writeFileSync(path.join(__dirname, 'icon.ico'), buildIco(png));
console.log('icon.png + icon.ico created');