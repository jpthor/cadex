import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const iconDir = join(root, "src-tauri", "icons");
const iconsetDir = join(iconDir, "icon.iconset");

mkdirSync(iconDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

const pngTargets = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

const iconsetTargets = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

for (const [name, size] of pngTargets) {
  writeFileSync(join(iconDir, name), makePng(size));
}

for (const [name, size] of iconsetTargets) {
  writeFileSync(join(iconsetDir, name), makePng(size));
}

writeFileSync(join(iconDir, "icon.ico"), makeIco([16, 32, 48, 64, 128, 256]));

function makeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: makePng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size === 256 ? 0 : image.size;
    directory[entry + 1] = image.size === 256 ? 0 : image.size;
    directory[entry + 2] = 0;
    directory[entry + 3] = 0;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 512;
  const supersample = size < 128 ? 3 : 2;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = (x + (sx + 0.5) / supersample) / scale;
          const py = (y + (sy + 0.5) / supersample) / scale;
          const color = sampleIcon(px, py);
          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }

      const samples = supersample * supersample;
      const i = row + 1 + x * 4;
      raw[i] = Math.round(r / samples);
      raw[i + 1] = Math.round(g / samples);
      raw[i + 2] = Math.round(b / samples);
      raw[i + 3] = Math.round(a / samples);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function sampleIcon(x, y) {
  if (!roundedRect(x, y, 24, 24, 464, 464, 92)) {
    return [0, 0, 0, 0];
  }

  const t = (x + y) / 1024;
  let color = mix([14, 21, 28], [18, 49, 58], t);

  for (let i = 0; i < 7; i += 1) {
    const gx = 78 + i * 58;
    if (Math.abs(x - gx) < 1.2 && y > 96 && y < 416) {
      color = blend(color, [64, 91, 103], 0.28);
    }
    const gy = 92 + i * 52;
    if (Math.abs(y - gy) < 1.2 && x > 72 && x < 438) {
      color = blend(color, [64, 91, 103], 0.2);
    }
  }

  const wing = wingDistance(x, y);
  if (wing < 0) {
    const highlight = Math.max(0, 1 - Math.abs(wing) / 42);
    color = blend([207, 230, 238], [102, 204, 224], highlight * 0.72);
  }

  const centerLine = Math.abs(y - (288 - 0.22 * (x - 120)));
  if (x > 112 && x < 410 && centerLine < 5) {
    color = blend(color, [12, 26, 32], 0.72);
  }

  const ring = Math.hypot(x - 150, y - 300);
  if (ring > 23 && ring < 32) {
    color = [249, 115, 22];
  } else if (ring <= 12) {
    color = [255, 237, 213];
  }

  if (Math.abs(x - 150) < 2.4 && y > 252 && y < 348) {
    color = [249, 115, 22];
  }
  if (Math.abs(y - 300) < 2.4 && x > 102 && x < 198) {
    color = [249, 115, 22];
  }

  return [...color, 255];
}

function wingDistance(x, y) {
  const leading = 172 + 0.0009 * (x - 276) ** 2 - 0.18 * (x - 276);
  const trailing = 340 - 0.00055 * (x - 276) ** 2 - 0.37 * (x - 276);
  const nose = x > 86 && x < 428;
  const taperedTip = x < 386 || y > 220 + (x - 386) * 0.9;
  return nose && taperedTip && y > leading && y < trailing ? -Math.min(y - leading, trailing - y) : 1;
}

function roundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  const cx = clamp(x, left + radius, right - radius);
  const cy = clamp(y, top + radius, bottom - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function blend(base, top, alpha) {
  return base.map((channel, index) => Math.round(channel * (1 - alpha) + top[index] * alpha));
}

function mix(start, end, t) {
  return start.map((channel, index) => Math.round(channel + (end[index] - channel) * t));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
