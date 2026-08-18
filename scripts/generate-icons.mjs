// Génère les PNG des icônes PWA à partir de formes géométriques simples, en pur Node
// (zlib intégré) — aucune dépendance, aucun outil système (rsvg-convert, Inkscape...).
// Le dessin (fond dégradé + trou de serrure blanc) doit rester cohérent avec les
// masters SVG dans asset/icons/{icon,icon-maskable}.svg si ceux-ci sont modifiés.
//
// Usage : node scripts/generate-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pwaIconsDir = path.join(__dirname, "..", "asset", "icons");
const extensionIconsDir = path.join(__dirname, "..", "extension", "icons");

const ACCENT = [0x7c, 0x5c, 0xff];
const ACCENT_2 = [0x35, 0xd6, 0xc4];
const WHITE = [0xff, 0xff, 0xff];

// Formes exprimées dans un espace de conception 512x512 (même repère que les SVG masters).
const DESIGN_SIZE = 512;
const ROUNDED_RECT = { x0: 48, y0: 48, x1: 464, y1: 464, r: 96 };
const KEYHOLE_CIRCLE = { cx: 256, cy: 224, r: 56 };
const KEYHOLE_STEM = { yTop: 256, yBottom: 360, halfWidthTop: 20, halfWidthBottom: 40, cx: 256 };

function insideRoundedRect(px, py, rect) {
  const { x0, y0, x1, y1, r } = rect;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const nearInCornerX = px < x0 + r || px > x1 - r;
  const nearInCornerY = py < y0 + r || py > y1 - r;
  if (nearInCornerX && nearInCornerY) {
    const nx = px < x0 + r ? x0 + r : x1 - r;
    const ny = py < y0 + r ? y0 + r : y1 - r;
    const dx = px - nx;
    const dy = py - ny;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function insideKeyhole(px, py) {
  const dx = px - KEYHOLE_CIRCLE.cx;
  const dy = py - KEYHOLE_CIRCLE.cy;
  if (dx * dx + dy * dy <= KEYHOLE_CIRCLE.r * KEYHOLE_CIRCLE.r) return true;

  const { yTop, yBottom, halfWidthTop, halfWidthBottom, cx } = KEYHOLE_STEM;
  if (py < yTop || py > yBottom) return false;
  const t = (py - yTop) / (yBottom - yTop);
  const halfWidth = halfWidthTop + (halfWidthBottom - halfWidthTop) * t;
  return Math.abs(px - cx) <= halfWidth;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function backgroundColor(px, py) {
  const t = (px + py) / (2 * DESIGN_SIZE);
  return [
    Math.round(lerp(ACCENT[0], ACCENT_2[0], t)),
    Math.round(lerp(ACCENT[1], ACCENT_2[1], t)),
    Math.round(lerp(ACCENT[2], ACCENT_2[2], t)),
  ];
}

// Rendu supersamplé (facteur 4) puis réduit par moyenne de blocs, pour des bords
// anti-aliasés sans dépendre d'une bibliothèque de rendu externe.
const SUPERSAMPLE = 4;

function renderIcon({ size, fullBleed }) {
  const superSize = size * SUPERSAMPLE;
  const scale = DESIGN_SIZE / size; // pixel de sortie -> unités de conception
  const superPixels = new Float64Array(superSize * superSize * 4);

  for (let sy = 0; sy < superSize; sy++) {
    for (let sx = 0; sx < superSize; sx++) {
      const designX = ((sx + 0.5) / SUPERSAMPLE) * scale;
      const designY = ((sy + 0.5) / SUPERSAMPLE) * scale;

      const inBackground = fullBleed || insideRoundedRect(designX, designY, ROUNDED_RECT);
      let rgb = [0, 0, 0];
      let alpha = 0;

      if (inBackground) {
        rgb = insideKeyhole(designX, designY) ? WHITE : backgroundColor(designX, designY);
        alpha = 255;
      }

      const idx = (sy * superSize + sx) * 4;
      superPixels[idx] = rgb[0];
      superPixels[idx + 1] = rgb[1];
      superPixels[idx + 2] = rgb[2];
      superPixels[idx + 3] = alpha;
    }
  }

  const pixels = new Uint8Array(size * size * 4);
  const blockArea = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let by = 0; by < SUPERSAMPLE; by++) {
        for (let bx = 0; bx < SUPERSAMPLE; bx++) {
          const sx = x * SUPERSAMPLE + bx;
          const sy = y * SUPERSAMPLE + by;
          const idx = (sy * superSize + sx) * 4;
          r += superPixels[idx];
          g += superPixels[idx + 1];
          b += superPixels[idx + 2];
          a += superPixels[idx + 3];
        }
      }
      const outIdx = (y * size + x) * 4;
      pixels[outIdx] = Math.round(r / blockArea);
      pixels[outIdx + 1] = Math.round(g / blockArea);
      pixels[outIdx + 2] = Math.round(b / blockArea);
      pixels[outIdx + 3] = Math.round(a / blockArea);
    }
  }

  return pixels;
}

// --- Encodage PNG minimal (RGBA 8 bits, sans dépendance) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  const rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filtre "None"
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), rowStart + 1);
  }
  const idat = chunk("IDAT", deflateSync(raw));

  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function generate(outDir, name, { size, fullBleed }) {
  const pixels = renderIcon({ size, fullBleed });
  const png = encodePng(pixels, size);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  writeFileSync(outPath, png);
  console.log(`  ${path.relative(path.join(__dirname, ".."), outPath)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KiB)`);
}

console.log("Génération des icônes PWA...");
generate(pwaIconsDir, "icon-192.png", { size: 192, fullBleed: false });
generate(pwaIconsDir, "icon-512.png", { size: 512, fullBleed: false });
generate(pwaIconsDir, "icon-maskable-512.png", { size: 512, fullBleed: true });
generate(pwaIconsDir, "apple-touch-icon.png", { size: 180, fullBleed: true });

console.log("Génération des icônes de l'extension...");
// Tailles standard attendues par manifest.json (Chrome/Firefox) : 16 (favicon
// barre d'outils), 48 (gestionnaire d'extensions), 128 (Chrome Web Store/install).
generate(extensionIconsDir, "icon-16.png", { size: 16, fullBleed: false });
generate(extensionIconsDir, "icon-48.png", { size: 48, fullBleed: false });
generate(extensionIconsDir, "icon-128.png", { size: 128, fullBleed: false });
console.log("Terminé.");
