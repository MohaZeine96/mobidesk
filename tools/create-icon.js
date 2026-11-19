const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const size = 256;
const pixels = Buffer.alloc(size * size * 4);
const insideRoundRect = (x, y, left, top, right, bottom, radius) => {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const t = Math.max(0, Math.min(1, (x + y) / (size * 2)));
    const bg = insideRoundRect(x + .5, y + .5, 8, 8, 248, 248, 54);
    if (!bg) continue;
    pixels[i] = Math.round(97 - 40 * t);
    pixels[i + 1] = Math.round(125 - 37 * t);
    pixels[i + 2] = Math.round(245 - 26 * t);
    pixels[i + 3] = 255;

    const px = x + .5; const py = y + .5;
    const outer = insideRoundRect(px, py, 79, 36, 177, 220, 19);
    const inner = insideRoundRect(px, py, 88, 47, 168, 205, 11);
    const home = insideRoundRect(px, py, 111, 209, 145, 215, 3);
    if ((outer && !inner) || home) {
      pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255; pixels[i + 3] = 255;
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const scanlines = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) {
  const row = y * (1 + size * 4);
  scanlines[row] = 0;
  for (let x = 0; x < size; x++) {
    const source = (y * size + x) * 4;
    const target = row + 1 + x * 4;
    scanlines[target] = pixels[source];
    scanlines[target + 1] = pixels[source + 1];
    scanlines[target + 2] = pixels[source + 2];
    scanlines[target + 3] = pixels[source + 3];
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
header[8] = 8; header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(scanlines)),
  chunk('IEND', Buffer.alloc(0))
]);
const iconHeader = Buffer.alloc(6); iconHeader.writeUInt16LE(0, 0); iconHeader.writeUInt16LE(1, 2); iconHeader.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16); entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const output = path.join(__dirname, '..', 'assets', 'mobidesk.ico');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([iconHeader, entry, png]));
process.stdout.write(`Wrote ${output}\n`);
