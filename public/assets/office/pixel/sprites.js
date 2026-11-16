/**
 * Pixel sprites for the office — every colleague, drawn from text.
 *
 * Each frame is a 16×20 grid of characters, one per pixel, composed from a body
 * template (by direction and pose), an ear layer and a face-marking layer per
 * species, then coloured from the species' fur and the colleague's coat. Drawing
 * them here rather than shipping a sprite sheet keeps every pixel ours (no asset
 * licence to carry) and lets one template dress ten animals in eight coats.
 *
 * Template key:
 *   .  transparent       o  outline           f  fur          F  fur shade
 *   w  muzzle / light    E  ear               I  inner ear    e  eye
 *   n  nose              k  blush             m  marking      c  coat
 *   C  coat shade        t  coat trim         p  paw          -  closed eye
 */

export const FRAME_W = 16;
export const FRAME_H = 20;

/* ---------- bodies ---------- */

const FRONT_HEAD = [
  '................',
  '................',
  '................',
  '................',
  '....oooooooo....',
  '...offffffffo...',
  '..offffffffFFo..',
  '..offffffffffo..',
  '..offeffffeffo..',
  '..offeffffeffo..',
  '..okwwwnnwwwko..',
  '..oFwwwwwwwwFo..',
  '...oFFffffFFo...',
];

const FRONT_BODY = {
  stand: [
    '....occttcco....',
    '...occcttccco...',
    '..opcccccccCpo..',
    '..opcccccccCpo..',
    '...oCCCCCCCCo...',
    '....offo.offo...',
    '....oooo.oooo...',
  ],
  stepA: [
    '....occttcco....',
    '...occcttccco...',
    '..opcccccccCpo..',
    '...occcccccCpo..',
    '...oCCCCCCCCo...',
    '....offo..oo....',
    '....oooo........',
  ],
  stepB: [
    '....occttcco....',
    '...occcttccco...',
    '..opcccccccCpo..',
    '..opcccccccCo...',
    '...oCCCCCCCCo...',
    '.....oo..offo...',
    '.........oooo...',
  ],
};

const BACK_HEAD = [
  '................',
  '................',
  '................',
  '................',
  '....oooooooo....',
  '...offffffffo...',
  '..offffffffffo..',
  '..offffffffffo..',
  '..offffffffffo..',
  '..oFffffffffFo..',
  '..oFffffffffFo..',
  '..oFFffffffFFo..',
  '...oFFFFFFFFo...',
];

const BACK_BODY = {
  stand: [
    '....occcccco....',
    '...occcccccco...',
    '..opcccccccCpo..',
    '..opcccccccCpo..',
    '...oCCCCCCCCo...',
    '....offo.offo...',
    '....oooo.oooo...',
  ],
  stepA: [
    '....occcccco....',
    '...occcccccco...',
    '..opcccccccCpo..',
    '...occcccccCpo..',
    '...oCCCCCCCCo...',
    '....offo..oo....',
    '....oooo........',
  ],
  stepB: [
    '....occcccco....',
    '...occcccccco...',
    '..opcccccccCpo..',
    '..opcccccccCo...',
    '...oCCCCCCCCo...',
    '.....oo..offo...',
    '.........oooo...',
  ],
};

/* Facing right; facing left is the same frame mirrored. */
const SIDE_HEAD = [
  '................',
  '................',
  '................',
  '................',
  '....ooooooo.....',
  '...oFffffffo....',
  '..oFfffffffoo...',
  '..oFffffffffo...',
  '..oFffffffefo...',
  '..oFffffffefwo..',
  '..oFfffffkwwno..',
  '..oFFffffwwwo...',
  '...oFFFFffoo....',
];

const SIDE_BODY = {
  stand: [
    '.....occco......',
    '....occcco......',
    '....occpCo......',
    '....occpCo......',
    '....oCCCCo......',
    '.....offo.......',
    '.....oooo.......',
  ],
  stepA: [
    '.....occco......',
    '....occcco......',
    '....occcpo......',
    '....occcpo......',
    '....oCCCCo......',
    '....offoffo.....',
    '....ooo.ooo.....',
  ],
  stepB: [
    '.....occco......',
    '....occcco......',
    '....opccCo......',
    '....opccCo......',
    '....oCCCCo......',
    '....offoffo.....',
    '....ooo.ooo.....',
  ],
};

/* ---------- species ---------- */

/**
 * Ears and markings per species, as overlays on the head rows (0–12). A `.` in
 * an overlay leaves the template alone; anything else replaces it. `side` and
 * `back` fall back to the front ears when a species has nothing special there.
 */
const EARS = {
  dog: {
    front: [
      '................',
      '................',
      '................',
      '................',
      '..oo........oo..',
      '.oEEo......oEEo.',
      '.oEEo......oEEo.',
      '.oEEo......oEEo.',
      '.oEEo......oEEo.',
      '..oo........oo..',
    ],
    side: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '....oo..........',
      '...oEEo.........',
      '...oEEo.........',
      '...oEEo.........',
      '....oo..........',
    ],
  },
  cat: {
    front: [
      '................',
      '................',
      '...o........o...',
      '..oEo......oEo..',
      '..oIEo....oEIo..',
    ],
    side: [
      '................',
      '................',
      '.....o..........',
      '....oEo.........',
      '....oIEo........',
    ],
  },
  fox: {
    front: [
      '................',
      '..o..........o..',
      '..oo........oo..',
      '..oEo......oEo..',
      '..oIEo....oEIo..',
    ],
    side: [
      '................',
      '....o...........',
      '....oo..........',
      '....oEo.........',
      '....oIEo........',
    ],
  },
  hamster: {
    front: [
      '................',
      '................',
      '................',
      '...oo......oo...',
      '..oIEo....oEIo..',
    ],
    side: [
      '................',
      '................',
      '................',
      '....oo..........',
      '...oIEo.........',
    ],
  },
  rabbit: {
    front: [
      '....oo....oo....',
      '...oEEo..oEEo...',
      '...oIEo..oEIo...',
      '...oIEo..oEIo...',
      '...oIEooooEIo...',
    ],
    side: [
      '.....oo.........',
      '....oEEo........',
      '....oIEo........',
      '....oIEo........',
      '....oIEo........',
    ],
  },
  bear: {
    front: [
      '................',
      '................',
      '................',
      '..ooo......ooo..',
      '..oEIo....oIEo..',
    ],
    side: [
      '................',
      '................',
      '................',
      '...ooo..........',
      '...oEIo.........',
    ],
  },
  panda: null, // filled below: a bear's ears
  raccoon: null, // a cat's ears
  koala: {
    front: [
      '................',
      '................',
      '................',
      'oooo........oooo',
      'oEIEo......oEIEo',
      'oEIIo......oIIEo',
      '.oEo........oEo.',
    ],
    side: [
      '................',
      '................',
      '................',
      '..oooo..........',
      '..oEIEo.........',
      '..oEIIo.........',
      '...oEo..........',
    ],
  },
  tiger: null, // a bear's ears
};
EARS.panda = EARS.bear;
EARS.raccoon = EARS.cat;
EARS.tiger = EARS.bear;

/** Face markings, front and side. Rows 0–12 like the ears. */
const MARKINGS = {
  panda: {
    front: [
      '', '', '', '', '', '', '',
      '...mmm....mmm...',
      '...mem....mem...',
      '...mem....mem...',
    ],
    side: ['', '', '', '', '', '', '', '........mmm.....', '........mem.....', '........mem.....'],
  },
  raccoon: {
    front: ['', '', '', '', '', '', '', '', '..ommeffffemmo..', '..ommeffffemmo..'],
    side: ['', '', '', '', '', '', '', '', '........mmeo....', '........mmeo....'],
  },
  tiger: {
    front: ['', '', '', '', '', '....m.mm.m.....', '.....m..m......', '', '', '', '', '', '..........m.....'],
    side: ['', '', '', '', '', '...m.m.m........', '....m.m.........'],
  },
  koala: {
    front: ['', '', '', '', '', '', '', '', '', '', '..okwwwmmwwwko..', '..oFwwwmmwwwFo..'],
    side: ['', '', '', '', '', '', '', '', '', '', '..oFfffffkwmmo..'],
  },
  fox: {
    front: ['', '', '', '', '', '', '', '', '', '..offeffffeffo..', '..owwwwnnwwwwo..', '..owwwwwwwwwwo..'],
  },
};

/**
 * Colours per species. `fur`/`furShade` come from dogs.js (sampled from the
 * portraits the office used before); the rest are what a 16px face needs.
 */
const SPECIES_PALETTE = {
  dog: { light: '#f7dcb8', ear: '#9a6142', inner: '#9a6142', nose: '#3a2a26', mark: '#3a2a26' },
  cat: { light: '#fde7a8', ear: '#df9b1f', inner: '#f2a3a8', nose: '#e0717a', mark: '#c8781a' },
  fox: { light: '#fff3e6', ear: '#c8601c', inner: '#3b2b26', nose: '#2d2523', mark: '#fff3e6' },
  hamster: { light: '#fff1de', ear: '#d98b62', inner: '#f3a6a0', nose: '#d86b70', mark: '#d98b62' },
  rabbit: { light: '#ffffff', ear: '#e6e6ec', inner: '#f5aab5', nose: '#e57a8a', mark: '#b6b6c3' },
  bear: { light: '#d8b39e', ear: '#6d4337', inner: '#c49482', nose: '#2b211e', mark: '#2b211e' },
  panda: { light: '#ffffff', ear: '#26232d', inner: '#26232d', nose: '#26232d', mark: '#26232d', face: '#f7f7fa' },
  raccoon: { light: '#ecebf0', ear: '#83838e', inner: '#4a4954', nose: '#26232d', mark: '#3a3944' },
  koala: { light: '#e8e8ee', ear: '#a3a3ab', inner: '#f2f2f5', nose: '#2f2d36', mark: '#2f2d36' },
  tiger: { light: '#fff3e6', ear: '#cf651c', inner: '#3b2b26', nose: '#e0717a', mark: '#3b2b26' },
};

/* ---------- composition ---------- */

function overlay(base, layer) {
  if (!layer) return base;
  return base.map((row, y) => {
    const over = layer[y];
    if (!over) return row;
    let out = '';
    for (let x = 0; x < FRAME_W; x++) {
      const ch = over[x] ?? '.';
      out += ch === '.' || ch === undefined ? row[x] : ch;
    }
    return out;
  });
}

function mirror(rows) {
  return rows.map((row) => [...row].reverse().join(''));
}

/**
 * Every frame for one species, as character grids: `{ down, up, side }`, each
 * `{ stand, stepA, stepB }`, plus `down.sleep` (eyes shut) and `down.blink`.
 */
export function frameGrids(speciesKey) {
  const ears = EARS[speciesKey] ?? EARS.dog;
  const marks = MARKINGS[speciesKey] ?? null;

  const frontHead = overlay(overlay(FRONT_HEAD, marks?.front), ears.front);
  const sideHead = overlay(overlay(SIDE_HEAD, marks?.side), ears.side ?? null);
  // From behind, ears sit where they do from the front; a face marking does not show.
  const backHead = overlay(BACK_HEAD, ears.front);

  const build = (head, bodies) => Object.fromEntries(
    Object.entries(bodies).map(([pose, body]) => [pose, [...head, ...body]]),
  );

  const down = build(frontHead, FRONT_BODY);
  // Eyes shut: the upper eye pixel takes the colour beside it, the lower becomes a lash line.
  const closed = (rows) => rows.map((row, y) => (
    y === 8 ? row.replace(/e/g, (_, x) => row[x - 1]) : y === 9 ? row.replace(/e/g, '-') : row
  ));
  down.blink = closed(down.stand);
  down.sleep = closed(down.stand);

  return { down, up: build(backHead, BACK_BODY), side: build(sideHead, SIDE_BODY) };
}

/** Shade a hex colour toward black (negative) or white (positive). */
export function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift) => {
    const c = (value >> shift) & 255;
    return Math.round(c + (target - c) * t);
  };
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

/** The colour for every template character, for one colleague. */
export function paletteFor(species, coat) {
  const extra = SPECIES_PALETTE[species.key] ?? SPECIES_PALETTE.dog;
  const fur = extra.face ?? species.fur;
  return {
    o: shade(species.furShade, -0.55),
    f: fur,
    F: extra.face ? shade(fur, -0.12) : species.furShade,
    w: extra.light,
    E: extra.ear,
    I: extra.inner,
    e: '#1d1a22',
    '-': '#1d1a22',
    n: extra.nose,
    k: '#f59aa6',
    m: extra.mark,
    c: coat.body,
    C: coat.ear,
    t: coat.patch,
    p: species.key === 'panda' ? extra.ear : species.fur,
  };
}

/** Paint one grid into a context at (x, y), one canvas pixel per character. */
export function paintGrid(ctx, grid, palette, x = 0, y = 0, flip = false) {
  for (let row = 0; row < grid.length; row++) {
    const line = flip ? [...grid[row]].reverse().join('') : grid[row];
    for (let col = 0; col < line.length; col++) {
      const colour = palette[line[col]];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
}

/**
 * A sprite sheet for one colleague: an offscreen canvas holding every frame in a
 * row, and where each one is. Built once per look and cached, so the render loop
 * only ever blits.
 */
const sheetCache = new Map();

const SHEET_ORDER = [
  ['down', 'stand'], ['down', 'stepA'], ['down', 'stepB'], ['down', 'blink'], ['down', 'sleep'],
  ['up', 'stand'], ['up', 'stepA'], ['up', 'stepB'],
  ['side', 'stand'], ['side', 'stepA'], ['side', 'stepB'],
];

export function spriteSheet(dog) {
  const key = `${dog.species.key}/${dog.coat.key}`;
  const cached = sheetCache.get(key);
  if (cached) return cached;

  const grids = frameGrids(dog.species.key);
  const palette = paletteFor(dog.species, dog.coat);
  // Two rows: as drawn, and mirrored, so facing left is a plain blit too.
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W * SHEET_ORDER.length;
  canvas.height = FRAME_H * 2;
  const ctx = canvas.getContext('2d');
  const index = {};
  SHEET_ORDER.forEach(([dir, pose], i) => {
    paintGrid(ctx, grids[dir][pose], palette, i * FRAME_W, 0);
    paintGrid(ctx, grids[dir][pose], palette, i * FRAME_W, FRAME_H, true);
    index[`${dir}.${pose}`] = i;
  });

  const sheet = { canvas, index, palette };
  sheetCache.set(key, sheet);
  return sheet;
}

/** Blit one frame. `flip` mirrors, for facing left. */
export function drawFrame(ctx, sheet, dir, pose, x, y, flip = false) {
  const i = sheet.index[`${dir}.${pose}`] ?? sheet.index[`${dir}.stand`] ?? 0;
  ctx.drawImage(sheet.canvas, i * FRAME_W, flip ? FRAME_H : 0, FRAME_W, FRAME_H, x, y, FRAME_W, FRAME_H);
}

/**
 * A still portrait as a data URL, for places outside the canvas: the roster
 * cards and the report header. Cropped to the head and shoulders.
 */
const avatarCache = new Map();
export function avatarUrl(dog, scale = 4) {
  const key = `${dog.species.key}/${dog.coat.key}/${scale}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  const sheet = spriteSheet(dog);
  const canvas = document.createElement('canvas');
  const top = 0;
  const height = 17;
  canvas.width = FRAME_W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.canvas, 0, top, FRAME_W, height, 0, 0, FRAME_W * scale, height * scale);
  const url = canvas.toDataURL('image/png');
  avatarCache.set(key, url);
  return url;
}
