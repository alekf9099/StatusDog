/**
 * The office floor plan: where the desks, the coffee and the sofa are, and
 * which parts of the floor a colleague can walk on.
 *
 * Pure geometry, no DOM, so the layout and the paths can be unit-tested. Units
 * are logical pixels — the canvas is drawn at this size and scaled up whole.
 *
 * The view is the usual top-down three-quarter one: the back wall stands across
 * the top, and everything on the floor is drawn in order of where it touches the
 * floor, so a colleague walking behind a desk is hidden by it.
 */

export const TILE = 16;
/** Pathfinding works on a finer grid than the tiles, so routes hug furniture. */
export const CELL = 8;
/** Height of the back wall, including the skirting board. */
export const WALL = 48;

const SLOT_W = 64;
const SLOT_H = 48;
/** Desks start below the things that stand against the wall. */
const DESK_TOP = 72;
/** A lounge column on the right needs this much room; narrower rooms put it at the bottom. */
const LOUNGE_W = 96;
const LOUNGE_MIN_ROOM = 320;

/**
 * Lay out a room for `count` colleagues, `width` logical pixels wide.
 *
 * Returns `{ width, height, seats, desks, spots, furniture, grid }`:
 *   seats      where each colleague sits, in the order given
 *   desks      the desk under each seat
 *   spots      named places to walk to: rack, coffee, cooler, window, plant, sofa[]
 *   furniture  everything to draw, each with the `kind` the renderer knows
 *   grid       the walkable floor, for findPath
 */
export function buildLayout(count, width = 384) {
  const W = Math.max(192, Math.floor(width / TILE) * TILE);
  const loungeRight = W >= LOUNGE_MIN_ROOM;
  const deskAreaW = W - (loungeRight ? LOUNGE_W : 0) - 16;
  const cols = Math.max(1, Math.floor(deskAreaW / SLOT_W));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  // Centre the desk block in its area so a room of two does not hug the wall.
  const usedCols = Math.min(cols, Math.max(count, 1));
  const left = 8 + Math.floor((deskAreaW - usedCols * SLOT_W) / 2 / CELL) * CELL;

  const desksBottom = DESK_TOP + rows * SLOT_H;
  const height = loungeRight
    ? Math.max(desksBottom + 8, 184)
    : desksBottom + 56;

  const seats = [];
  const desks = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = left + col * SLOT_W;
    const y0 = DESK_TOP + row * SLOT_H;
    seats.push({ x: x0 + 32, y: y0 + 14, desk: i });
    desks.push({
      index: i,
      x: x0 + 12,
      y: y0 + 10,
      w: 40,
      h: 20,
      // The floor in front, where a visitor stands to talk.
      front: { x: x0 + 32, y: y0 + 38 },
    });
  }

  // Against the back wall, left to right: the server rack, then the kitchen corner.
  const furniture = [
    { kind: 'rack', x: 8, y: 22, w: 24, h: 42 },
    { kind: 'coffee', x: W - 92, y: 34, w: 18, h: 26 },
    { kind: 'cooler', x: W - 68, y: 30, w: 14, h: 30 },
    { kind: 'plant', x: W - 26, y: 36, w: 16, h: 24 },
  ];

  // On the wall itself: the door, the status board, windows, a clock over the kitchen.
  const windows = [];
  for (let x = 124; x + 32 <= W - 104; x += 52) windows.push(x);
  const wall = { door: { x: 52 }, board: { x: 72 }, windows, clock: { x: W - 61 } };

  const spots = {
    rack: { x: 20, y: 72 },
    coffee: { x: W - 83, y: 68 },
    cooler: { x: W - 61, y: 68 },
    plant: { x: W - 30, y: 68 },
    // Under a window to look out of, or by the board when the room has none.
    window: { x: windows.length ? windows[0] + 16 : 92, y: 62 },
    door: { x: 52, y: WALL + 12 },
    sofa: [],
  };

  if (loungeRight) {
    const sx = W - 88;
    const sy = height - 44;
    furniture.push(
      { kind: 'rug', x: W - 92, y: 92, w: 80, h: 56, floor: true },
      { kind: 'sofa', x: sx, y: sy, w: 64, h: 28 },
      { kind: 'plant', x: W - 20, y: height - 46, w: 14, h: 22, small: true },
      { kind: 'shelf', x: W - 90, y: 76, w: 30, h: 14 },
    );
    spots.sofa.push({ x: sx + 20, y: sy + 21 }, { x: sx + 44, y: sy + 21 });
    spots.shelf = { x: W - 75, y: 98 };
  } else {
    const sx = 16;
    const sy = height - 40;
    furniture.push(
      { kind: 'rug', x: 8, y: height - 52, w: W - 16, h: 46, floor: true },
      { kind: 'sofa', x: sx, y: sy, w: 64, h: 28 },
      { kind: 'plant', x: 86, y: height - 44, w: 14, h: 22, small: true },
    );
    spots.sofa.push({ x: sx + 20, y: sy + 21 }, { x: sx + 44, y: sy + 21 });
  }

  // A printer in the left-hand corner, if the desks leave room for one.
  if (desksBottom + 40 <= height - 4 || !loungeRight) {
    const py = loungeRight ? height - 34 : desksBottom + 4;
    const px = loungeRight ? 12 : W - 40;
    furniture.push({ kind: 'printer', x: px, y: py, w: 22, h: 20 });
    spots.printer = { x: px + 11, y: py + 30 > height - 6 ? py - 4 : py + 28 };
  }

  for (const desk of desks) {
    furniture.push({ kind: 'desk', x: desk.x, y: desk.y, w: desk.w, h: desk.h, desk: desk.index });
  }

  const grid = walkableGrid(W, height, furniture);
  return { width: W, height, seats, desks, spots, furniture, wall, grid, cols, rows };
}

/**
 * Which 8px cells can be walked on. The wall band is off limits, and so is the
 * floor each piece of furniture stands on — its lower part, not its whole
 * picture, so walking behind a desk to its chair works.
 */
function walkableGrid(W, H, furniture) {
  const cols = Math.floor(W / CELL);
  const rows = Math.floor(H / CELL);
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cy = r * CELL + CELL / 2;
      const cx = c * CELL + CELL / 2;
      open[r * cols + c] = cy > WALL + 8 && cy < H - 4 && cx > 4 && cx < W - 4 ? 1 : 0;
    }
  }
  for (const item of furniture) {
    if (item.floor) continue;
    const foot = footprint(item);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * CELL + CELL / 2;
        const cy = r * CELL + CELL / 2;
        if (cx > foot.x && cx < foot.x + foot.w && cy > foot.y && cy < foot.y + foot.h) open[r * cols + c] = 0;
      }
    }
  }
  return { cols, rows, open };
}

/** The floor a piece of furniture occupies. */
export function footprint(item) {
  if (item.kind === 'desk') return { x: item.x, y: item.y + 6, w: item.w, h: item.h - 4 };
  if (item.kind === 'sofa') return { x: item.x, y: item.y + item.h - 12, w: item.w, h: 12 };
  return { x: item.x, y: item.y + item.h - 10, w: item.w, h: 10 };
}

/** Where on the floor this item's base is, for drawing in depth order. */
export function baseline(item) {
  return item.y + item.h;
}

function cellOf(grid, x, y) {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / CELL)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / CELL)));
  return { c, r };
}

function isOpen(grid, c, r) {
  return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.open[r * grid.cols + c] === 1;
}

/** The nearest walkable cell to a point, searching outward. */
function nearestOpen(grid, x, y) {
  const start = cellOf(grid, x, y);
  if (isOpen(grid, start.c, start.r)) return start;
  for (let radius = 1; radius < Math.max(grid.cols, grid.rows); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        if (isOpen(grid, start.c + dc, start.r + dr)) return { c: start.c + dc, r: start.r + dr };
      }
    }
  }
  return start;
}

const STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * A walkable route from one point to another, as a list of points ending at the
 * destination itself. Breadth-first on the cell grid — a room is a few hundred
 * cells — with diagonals allowed only where both sides are clear, so nobody cuts
 * the corner of a desk.
 */
export function findPath(grid, from, to) {
  const start = nearestOpen(grid, from.x, from.y);
  const goal = nearestOpen(grid, to.x, to.y);
  const key = (c, r) => r * grid.cols + c;
  const came = new Int32Array(grid.cols * grid.rows).fill(-2);
  const queue = [key(start.c, start.r)];
  came[queue[0]] = -1;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === key(goal.c, goal.r)) break;
    const c = current % grid.cols;
    const r = Math.floor(current / grid.cols);
    for (const [dc, dr] of STEPS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isOpen(grid, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (!isOpen(grid, c + dc, r) || !isOpen(grid, c, r + dr))) continue;
      const next = key(nc, nr);
      if (came[next] !== -2) continue;
      came[next] = current;
      queue.push(next);
    }
  }

  const goalKey = key(goal.c, goal.r);
  if (came[goalKey] === -2) return [{ x: to.x, y: to.y }];

  const cells = [];
  for (let at = goalKey; at !== -1; at = came[at]) cells.push(at);
  cells.reverse();
  const points = cells.slice(1).map((at) => ({
    x: (at % grid.cols) * CELL + CELL / 2,
    y: Math.floor(at / grid.cols) * CELL + CELL / 2,
  }));
  const route = smooth(grid, from, points);
  // Finish on the exact spot, not the middle of its cell.
  route.push({ x: to.x, y: to.y });
  return route;
}

/**
 * Is the straight line from a to b clear for someone about ten pixels wide?
 * Sampled every two pixels, checking either side of the line as well as on it.
 */
export function lineClear(grid, a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 2));
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    for (const [ox, oy] of [[0, 0], [-3, 0], [3, 0], [0, -2], [0, 2]]) {
      const c = Math.floor((x + ox) / CELL);
      const r = Math.floor((y + oy) / CELL);
      if (!isOpen(grid, c, r)) return false;
    }
  }
  return true;
}

/**
 * Straighten a cell-by-cell route: from each corner, head for the furthest
 * point still in plain sight. A grid route moves in 45° steps like a chess
 * piece; this one cuts across the floor the way a person would.
 */
function smooth(grid, from, points) {
  const out = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let far = i;
    for (let j = points.length - 1; j > i; j--) {
      if (lineClear(grid, anchor, points[j])) {
        far = j;
        break;
      }
    }
    out.push(points[far]);
    anchor = points[far];
    i = far + 1;
  }
  return out;
}
