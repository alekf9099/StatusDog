/**
 * Draw the app icons from the office's own pixel dog.
 *
 *   node scripts/generate-icons.mjs
 *
 * Run by hand when the sprite changes; the PNGs are committed. Uses the same
 * sprite grids as the office (public/assets/office/pixel/sprites.js) and writes
 * PNG with node:zlib, so there is still no dependency to install.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => import(pathToFileURL(path.join(root, 'public/assets/office', file)).href);
const { frameGrids, paletteFor } = await load('pixel/sprites.js');
const { speciesByKey, coatByKey } = await load('dogs.js');

const BACKGROUND = '#251d2b';
const STATUS = '#3fb950';

/** The head and collar of the front-facing dog: rows 3–17 of the frame. */
const grid = frameGrids('dog').down.stand.slice(3, 18);
const palette = paletteFor(speciesByKey('dog'), coatByKey('slate'));

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * One icon: the dog `scale` pixels per art pixel, centred on the background,
 * with a green status lamp in the corner unless the icon may be masked.
 */
function render(size, scale, { lamp = true } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const [br, bg, bb] = rgb(BACKGROUND);
  for (let i = 0; i < size * size; i++) pixels.set([br, bg, bb, 255], i * 4);

  const paint = (x0, y0, w, h, colour) => {
    const [r, g, b] = rgb(colour);
    for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) pixels.set([r, g, b, 255], (y * size + x) * 4);
    }
  };

  const w = grid[0].length * scale;
  const h = grid.length * scale;
  const left = Math.round((size - w) / 2);
  const top = Math.round((size - h) / 2) + Math.round(scale / 2);
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch]) paint(left + x * scale, top + y * scale, scale, scale, palette[ch]);
    });
  });

  if (lamp) {
    const s = Math.round(size * 0.11);
    paint(size - s * 2, s, s, s, STATUS);
  }
  return encodePng(size, size, pixels);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- the logo, as SVG ---------- */

/** One <rect> per horizontal run of a colour, so the file stays small. */
function runs(rows, colourOf, x0 = 0, y0 = 0) {
  const out = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = colourOf(row[x]);
      let end = x + 1;
      while (end < row.length && colourOf(row[end]) === fill) end++;
      if (fill) out.push(`<rect x="${x0 + x}" y="${y0 + y}" width="${end - x}" height="1" ${fill}/>`);
      x = end;
    }
  });
  return out.join('');
}

/** The pixel dog on its own, for the header. */
function markSvg() {
  const body = runs(grid, (ch) => (palette[ch] ? `fill="${palette[ch]}"` : null));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid[0].length} ${grid.length}" shape-rendering="crispEdges">${body}</svg>\n`;
}

/* A 5×9 pixel face for the wordmark: ascenders in rows 0–1, baseline at row 6, descenders below. */
const GLYPHS = {
  S: ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.', '.....', '.....'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.', '.....', '.....'],
  t: ['..#..', '..#..', '#####', '..#..', '..#..', '..#..', '...##', '.....', '.....'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####', '.....', '.....'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#', '.....', '.....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.', '.....', '.....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....', '.....'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
};

/**
 * "StatusDog" in pixels: "Status" in the page's text colour (dark or light with
 * the theme), "Dog" in the office's warm orange.
 */
function wordmarkSvg() {
  const word = 'StatusDog';
  const parts = [];
  let x = 0;
  for (const [i, letter] of [...word].entries()) {
    const cls = i >= 6 ? 'ac' : 'fg';
    parts.push(runs(GLYPHS[letter], (ch) => (ch === '#' ? `class="${cls}"` : null), x, 0));
    x += 6;
  }
  const style = '.fg{fill:#1b1f24}.ac{fill:#e8772e}@media (prefers-color-scheme:dark){.fg{fill:#f1ece4}.ac{fill:#ffa24c}}';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x - 1} 9" shape-rendering="crispEdges"><style>${style}</style>${parts.join('')}</svg>\n`;
}

const out = path.join(root, 'public/assets/app');
mkdirSync(out, { recursive: true });
const icons = {
  'icon-192.png': render(192, 9),
  'icon-512.png': render(512, 24),
  // Maskable icons are cropped to a circle or squircle: keep the dog in the
  // middle 80% and leave the lamp off, since a corner would be cut away.
  'icon-maskable-512.png': render(512, 18, { lamp: false }),
  'apple-touch-icon.png': render(180, 8),
  'favicon-32.png': render(32, 2, { lamp: false }),
};
icons['mark.svg'] = Buffer.from(markSvg());
icons['wordmark.svg'] = Buffer.from(wordmarkSvg());
for (const [name, file] of Object.entries(icons)) {
  writeFileSync(path.join(out, name), file);
  console.log(`${name}  ${file.length} bytes`);
}
