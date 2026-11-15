import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'app');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type);
  const payload = Buffer.concat([typeBytes, data]);
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE(crc32(payload), payload.length + 4);
  return result;
}

function iconPng(size) {
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);
  const scale = size / 512;
  const center = size / 2;
  const radius = 154 * scale;
  const stroke = 24 * scale;
  const corner = 112 * scale;
  for (let y = 0; y < size; y += 1) {
    const row = y * rowLength;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(corner - x, 0, x - (size - corner - 1));
      const dy = Math.max(corner - y, 0, y - (size - corner - 1));
      const inRoundedSquare = dx * dx + dy * dy <= corner * corner;
      if (!inRoundedSquare) continue;
      const offset = row + 1 + x * 4;
      const distance = Math.hypot(x - center, y - center);
      const isRing = Math.abs(distance - radius) <= stroke;
      raw[offset] = isRing ? 255 : 31;
      raw[offset + 1] = isRing ? 255 : 79;
      raw[offset + 2] = isRing ? 255 : 216;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND'),
  ]);
}

for (const size of [192, 512]) await writeFile(join(output, `icon-${size}.png`), iconPng(size));
