/**
 * PixelOffice — the office as a little pixel-art room, drawn on a canvas.
 *
 * Everything is drawn at a small logical size (a 16px tile grid) onto an
 * offscreen canvas and blown up by a whole number of device pixels, so the art
 * stays crisp at any width. The furniture is drawn from rectangles here; the
 * colleagues come from sprites.js and move as sim.js tells them.
 *
 * The canvas is decoration for sighted readers. The same people, with the same
 * facts, are in the roster under it as real buttons; this only adds the life.
 */
import { FRAME_H, FRAME_W, drawFrame, spriteSheet } from './sprites.js';
import { CELL, WALL, baseline, buildLayout } from './world.js';
import { createAgent, reseat, setMood, settle, step, walkBob, walkPose } from './sim.js';

const MOOD_COLOUR = {
  working: '#3fb950',
  strained: '#f0a830',
  uneasy: '#e3b341',
  alarmed: '#f85149',
  offDuty: '#8b949e',
};

/** Draw no faster than this; pixel art does not need sixty frames a second. */
const FRAME_MS = 1000 / 24;
const MIN_ROOM = 192;
const MAX_ROOM = 480;

/* 5×5 icons for the speech bubbles. */
const ICONS = {
  alert: { colour: '#e5534b', rows: ['..#..', '..#..', '..#..', '.....', '..#..'] },
  question: { colour: '#2f81f7', rows: ['.###.', '...#.', '..##.', '.....', '..#..'] },
  coffee: { colour: '#8a5a3c', rows: ['.#.#.', '.....', '####.', '#####', '####.'] },
  water: { colour: '#39a0e8', rows: ['..#..', '.###.', '#####', '#####', '.###.'] },
  heart: { colour: '#e8577d', rows: ['##.##', '#####', '#####', '.###.', '..#..'] },
  sun: { colour: '#e8a91c', rows: ['#.#.#', '.###.', '#####', '.###.', '#.#.#'] },
  chat: { colour: '#6e7781', rows: ['.....', '.....', '#.#.#', '.....', '.....'] },
  doc: { colour: '#6e7781', rows: ['###..', '#.##.', '#..##', '#...#', '#####'] },
};

const rect = (ctx, colour, x, y, w, h) => {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

/** The narrowest room that seats `count` in one row, with the lounge beside it. */
function roomFor(count) {
  return Math.max(320, Math.min(count, 5) * 64 + 16 + 96);
}

/** Seoul's hour, because that is where the office is. */
function seoulHour(date = new Date()) {
  return (date.getUTCHours() + 9 + date.getUTCMinutes() / 60) % 24;
}

export class PixelOffice {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onSelect?: (uid: string) => void, interactive?: boolean, rng?: () => number }} options
   */
  constructor(canvas, { onSelect = null, interactive = true, rng = Math.random } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.interactive = interactive;
    this.rng = rng;

    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');

    /** @type {Map<string, object>} */
    this.agents = new Map();
    this.workers = [];
    this.layout = null;
    this.scale = 2;
    this.hover = null;
    this.time = 0;
    this.last = 0;
    this.drawnAt = 0;
    this.running = false;
    this.visible = true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');

    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.kick();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.kick());
    this.reduced.addEventListener?.('change', () => this.settleAll());

    if (interactive) {
      canvas.addEventListener('pointermove', (event) => this.pointer(event));
      canvas.addEventListener('pointerleave', () => { this.hover = null; this.canvas.style.cursor = ''; });
      canvas.addEventListener('click', (event) => {
        const hit = this.hitTest(event);
        if (hit && this.onSelect) this.onSelect(hit);
      });
    }
  }

  /**
   * Who is in the office now. Called on every poll: new colleagues walk in from
   * the door, people who left are gone, and everyone else just changes mood.
   *
   * @param {Array<{ monitor: { uid: string }, mood: { mood: string }, dog: object, arriving?: boolean }>} workers
   */
  setWorkers(workers) {
    this.workers = workers;
    const sizeChanged = !this.layout || this.layout.seats.length !== workers.length;
    if (sizeChanged) this.relayout();

    const present = new Set();
    workers.forEach((worker, i) => {
      const uid = worker.monitor.uid;
      present.add(uid);
      const seat = this.layout.seats[i];
      let agent = this.agents.get(uid);
      if (!agent) {
        agent = createAgent(uid, seat);
        if (worker.arriving && !this.reduced.matches) {
          agent.x = this.layout.spots.door.x;
          agent.y = this.layout.spots.door.y;
          agent.sitting = false;
        }
        this.agents.set(uid, agent);
      } else {
        reseat(agent, seat);
        if (sizeChanged && agent.task?.kind !== 'go') {
          agent.x = seat.x;
          agent.y = seat.y;
        }
      }
      agent.worker = worker;
      setMood(agent, worker.mood.mood, this.layout);
      if (this.reduced.matches) settle(agent, this.layout);
    });
    for (const uid of [...this.agents.keys()]) {
      if (!present.has(uid)) this.agents.delete(uid);
    }
    this.draw();
    this.kick();
  }

  settleAll() {
    if (!this.layout) return;
    for (const agent of this.agents.values()) {
      if (this.reduced.matches) settle(agent, this.layout);
      else { agent.task = null; agent.queue = []; }
    }
    this.kick();
  }

  /** Pick the room size for the space available, and redraw it. */
  resize() {
    if (this.relayout()) {
      for (const agent of this.agents.values()) {
        agent.x = agent.seat.x;
        agent.y = agent.seat.y;
        agent.task = null;
        agent.queue = [];
        if (this.reduced.matches) settle(agent, this.layout);
      }
      // Resizing a canvas wipes it; paint straight away rather than flash empty.
      this.draw();
    }
    this.kick();
  }

  /**
   * Whole device pixels per art pixel, never less than one and a half CSS
   * pixels, so the art is never mushy and never too small to read.
   */
  relayout() {
    const available = Math.max(200, this.canvas.parentElement.clientWidth);
    const dpr = window.devicePixelRatio || 1;
    const devW = available * dpr;
    const count = this.workers.length;
    // A room as big as the team needs, then pixels as big as the space allows:
    // three colleagues get a cosy room drawn large, not a hall drawn small.
    const needed = Math.min(MAX_ROOM, Math.max(MIN_ROOM, roomFor(count)));
    // Browsers report ratios like 2.0000000298; without the tolerance that rounds up a whole step.
    let k = Math.max(Math.ceil(1.5 * dpr - 0.01), Math.floor(devW / needed));
    // …but never so large that even the smallest room overflows its frame.
    k = Math.max(1, Math.min(k, Math.floor(devW / MIN_ROOM)));
    const width = Math.min(MAX_ROOM, Math.max(MIN_ROOM, Math.floor(devW / k / 16) * 16));

    if (this.layout && this.layout.width === width && this.layout.seats.length === count && this.scale === k) {
      return false;
    }
    const layout = buildLayout(count, width);
    layout.claims = new Map();
    this.layout = layout;
    this.scale = k;

    this.buffer.width = layout.width;
    this.buffer.height = layout.height;
    this.canvas.width = layout.width * k;
    this.canvas.height = layout.height * k;
    this.canvas.style.width = `${(layout.width * k) / dpr}px`;
    this.canvas.style.height = `${(layout.height * k) / dpr}px`;

    for (const [i, worker] of this.workers.entries()) {
      const agent = this.agents.get(worker.monitor.uid);
      if (agent) reseat(agent, layout.seats[i]);
    }
    return true;
  }

  start() {
    this.running = true;
    this.kick();
  }

  stop() {
    this.running = false;
  }

  kick() {
    if (!this.running || this.pending) return;
    this.pending = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.pending = null;
    if (!this.running || !this.layout) return;
    const hidden = document.hidden || !this.visible;

    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;

    if (!hidden) {
      this.time += dt;
      if (!this.reduced.matches) {
        const others = [...this.agents.values()];
        for (const agent of others) step(agent, dt, this.layout, this.rng, others);
      }
      if (now - this.drawnAt >= FRAME_MS) {
        this.draw();
        this.drawnAt = now;
      }
    }
    // Stop the loop while nobody can see it; visibility and scrolling restart it.
    if (hidden) {
      this.last = 0;
      return;
    }
    this.pending = requestAnimationFrame(this.frame);
  }

  /* ---------- input ---------- */

  toLogical(event) {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * this.layout.width,
      y: ((event.clientY - box.top) / box.height) * this.layout.height,
    };
  }

  hitTest(event) {
    if (!this.layout) return null;
    const { x, y } = this.toLogical(event);
    // Front-most first: whoever stands lowest on the screen is nearest.
    const agents = [...this.agents.values()].sort((a, b) => b.y - a.y);
    for (const agent of agents) {
      if (x >= agent.x - 7 && x <= agent.x + 7 && y >= agent.y - FRAME_H + 3 && y <= agent.y + 1) return agent.uid;
    }
    for (const desk of this.layout.desks) {
      if (x >= desk.x && x <= desk.x + desk.w && y >= desk.y - 12 && y <= desk.y + desk.h) {
        return this.workers[desk.index]?.monitor.uid ?? null;
      }
    }
    return null;
  }

  pointer(event) {
    const hit = this.hitTest(event);
    if (hit !== this.hover) {
      this.hover = hit;
      this.canvas.style.cursor = hit ? 'pointer' : '';
      this.kick();
    }
  }

  /* ---------- drawing ---------- */

  draw() {
    if (!this.layout) return;
    const ctx = this.bctx;
    const { width: W, height: H } = this.layout;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    const hour = seoulHour();
    const night = hour < 6 || hour >= 19;
    const dusk = !night && (hour >= 17 || hour < 7);

    this.drawFloor(ctx, W, H);
    this.drawWall(ctx, W, hour, night, dusk);

    // Depth order: everything that stands on the floor, by where it touches it.
    const items = [];
    for (const item of this.layout.furniture) {
      if (item.floor) this.drawRug(ctx, item);
      else items.push({ y: baseline(item), draw: () => this.drawItem(ctx, item) });
    }
    for (const agent of this.agents.values()) {
      // Someone on the sofa sits in front of its back, not behind the whole thing.
      const onSofa = agent.sleeping && agent.claim?.startsWith('sofa');
      items.push({ y: onSofa ? agent.y + 20 : agent.y + 0.5, draw: () => this.drawAgent(ctx, agent) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    // Paws go on the keyboard after the desks, or the desks would cover them.
    for (const agent of this.agents.values()) this.drawPaws(ctx, agent);
    for (const agent of this.agents.values()) this.drawBubble(ctx, agent);

    if (night) {
      ctx.fillStyle = 'rgba(16, 20, 48, 0.28)';
      ctx.fillRect(0, 0, W, H);
      this.drawGlows(ctx);
    }
    if (this.workers.some((worker) => worker.mood.mood === 'alarmed' && worker.monitor.kind !== 'intern')) {
      const pulse = this.reduced.matches ? 0.08 : 0.06 + 0.06 * Math.sin(this.time * 6);
      ctx.fillStyle = `rgba(248, 81, 73, ${pulse.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    const out = this.ctx;
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, this.canvas.width, this.canvas.height);
    out.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    this.drawLabels(out);
  }

  drawFloor(ctx, W, H) {
    rect(ctx, '#c08a58', 0, WALL, W, H - WALL);
    // Planks: 8px rows, seams staggered row by row.
    for (let y = WALL, row = 0; y < H; y += 8, row++) {
      rect(ctx, '#b07a4a', 0, y + 7, W, 1);
      rect(ctx, '#cc976a', 0, y, W, 1);
      for (let x = (row % 2) * 24; x < W; x += 48) rect(ctx, '#a8703f', x, y + 1, 1, 6);
    }
    // A soft shadow where the floor meets the wall.
    rect(ctx, 'rgba(60, 30, 10, 0.18)', 0, WALL, W, 3);
  }

  drawWall(ctx, W, hour, night, dusk) {
    rect(ctx, '#efe3cc', 0, 0, W, WALL);
    rect(ctx, '#e3d3b6', 0, 28, W, 16);
    rect(ctx, '#d5c29f', 0, 28, W, 1);
    rect(ctx, '#7a5236', 0, WALL - 4, W, 4);
    rect(ctx, '#93653f', 0, WALL - 4, W, 1);

    const { wall } = this.layout;
    // The door new hires walk in through.
    const door = wall.door;
    rect(ctx, '#8c5c37', door.x - 9, 10, 18, WALL - 10);
    rect(ctx, '#a8724a', door.x - 7, 12, 14, WALL - 14);
    rect(ctx, '#e8c25a', door.x + 4, 28, 2, 2);

    // Windows, with the sky as it is in Seoul right now.
    const sky = night ? '#1d2650' : dusk ? '#f2a46a' : '#8fd0f5';
    const skyLow = night ? '#2d3a6e' : dusk ? '#f7c98c' : '#c7ecff';
    for (const x of wall.windows) {
      rect(ctx, '#f7f2e8', x - 1, 5, 34, 22);
      rect(ctx, sky, x + 1, 7, 30, 10);
      rect(ctx, skyLow, x + 1, 17, 30, 8);
      if (night) {
        rect(ctx, '#fff6c8', x + 6, 10, 1, 1);
        rect(ctx, '#fff6c8', x + 22, 9, 1, 1);
        rect(ctx, '#fff6c8', x + 15, 13, 1, 1);
      } else {
        rect(ctx, '#ffffff', x + 5, 11, 7, 2);
        rect(ctx, '#ffffff', x + 7, 10, 4, 1);
      }
      rect(ctx, '#f7f2e8', x + 15, 7, 2, 18);
      rect(ctx, '#d8cdb8', x - 1, 27, 34, 2);
    }

    // The clock, telling Seoul time.
    const cx = wall.clock.x;
    rect(ctx, '#5b4636', cx - 6, 6, 13, 13);
    rect(ctx, '#fbf8f1', cx - 5, 7, 11, 11);
    const minutes = (hour % 1) * 60;
    const hand = (len, angle, colour) => {
      for (let i = 1; i <= len; i++) {
        rect(ctx, colour, cx + Math.round(Math.sin(angle) * i), 12 - Math.round(Math.cos(angle) * i), 1, 1);
      }
    };
    hand(3, ((hour % 12) / 12) * Math.PI * 2, '#2b2b2b');
    hand(4, (minutes / 60) * Math.PI * 2, '#c0392b');
    rect(ctx, '#2b2b2b', cx, 12, 1, 1);

    this.drawBoard(ctx, wall.board.x);
  }

  /** The whiteboard: each colleague's recent checks as a strip of coloured squares. */
  drawBoard(ctx, x) {
    rect(ctx, '#9aa3ad', x - 1, 5, 42, 26);
    rect(ctx, '#ffffff', x, 6, 40, 24);
    const rows = this.workers.slice(0, 5);
    rows.forEach((worker, r) => {
      const history = (worker.monitor.history ?? []).slice(-12);
      for (let i = 0; i < 12; i++) {
        const record = history[history.length - 12 + i];
        const colour = !record ? '#e3e6ea' : record.ok ? '#3fb950' : '#f85149';
        rect(ctx, colour, x + 3 + i * 3, 9 + r * 4, 2, 3);
      }
    });
    rect(ctx, '#c9ced6', x + 6, 30, 28, 2);
  }

  drawRug(ctx, item) {
    rect(ctx, '#b5523b', item.x, item.y, item.w, item.h);
    rect(ctx, '#d8a35d', item.x + 2, item.y + 2, item.w - 4, item.h - 4);
    rect(ctx, '#c8774d', item.x + 5, item.y + 5, item.w - 10, item.h - 10);
    rect(ctx, '#e6bd7a', item.x + 7, item.y + 7, item.w - 14, item.h - 14);
  }

  drawItem(ctx, item) {
    switch (item.kind) {
      case 'desk': return this.drawDesk(ctx, item);
      case 'rack': return this.drawRack(ctx, item);
      case 'coffee': return this.drawCoffee(ctx, item);
      case 'cooler': return this.drawCooler(ctx, item);
      case 'plant': return this.drawPlant(ctx, item);
      case 'sofa': return this.drawSofa(ctx, item);
      case 'shelf': return this.drawShelf(ctx, item);
      case 'printer': return this.drawPrinter(ctx, item);
      default: return undefined;
    }
  }

  drawDesk(ctx, desk) {
    const worker = this.workers[desk.desk];
    const mood = worker?.mood.mood ?? 'offDuty';
    const { x, y, w } = desk;
    const hovered = worker && this.hover === worker.monitor.uid;

    // Shadow, legs, front panel, top.
    rect(ctx, 'rgba(60, 30, 10, 0.25)', x + 1, y + 20, w, 2);
    rect(ctx, '#6e4426', x + 1, y + 8, 2, 12);
    rect(ctx, '#6e4426', x + w - 3, y + 8, 2, 12);
    rect(ctx, '#8e5c35', x + 3, y + 8, w - 6, 9);
    rect(ctx, '#7a4d2b', x + 3, y + 16, w - 6, 1);
    rect(ctx, hovered ? '#e0aa75' : '#c88f5c', x, y, w, 8);
    rect(ctx, hovered ? '#f0c08c' : '#dba674', x, y, w, 1);
    rect(ctx, '#9c6a40', x, y + 7, w, 1);

    // Nameplate in the mood's colour, on the front of the desk.
    rect(ctx, '#3b2a1e', x + w / 2 - 6, y + 10, 12, 4);
    rect(ctx, MOOD_COLOUR[mood], x + w / 2 - 5, y + 11, 10, 2);

    // The monitor, seen from behind, with a status light on top.
    // Kept to the left of the chair so it never covers a face.
    rect(ctx, '#2e333d', x + 1, y - 9, 11, 10);
    rect(ctx, '#3d4350', x + 2, y - 8, 9, 8);
    rect(ctx, '#2e333d', x + 5, y + 1, 3, 2);
    const blink = mood === 'alarmed' && !this.reduced.matches && Math.floor(this.time * 4) % 2 === 0;
    rect(ctx, blink ? '#5a1d1a' : MOOD_COLOUR[mood], x + 3, y - 10, 7, 2);

    // Keyboard, mug.
    rect(ctx, '#e3e7ec', x + 15, y + 2, 12, 3);
    rect(ctx, '#b9c0c9', x + 15, y + 4, 12, 1);
    rect(ctx, '#f4f4f4', x + w - 8, y - 2, 4, 4);
    rect(ctx, '#7a4a2a', x + w - 7, y - 2, 2, 1);
    rect(ctx, '#f4f4f4', x + w - 4, y - 1, 1, 2);
  }

  /** The chair behind a seated colleague. */
  drawChair(ctx, seat) {
    rect(ctx, '#3f4862', seat.x - 8, seat.y - 10, 16, 8);
    rect(ctx, '#56618a', seat.x - 7, seat.y - 9, 14, 5);
  }

  drawRack(ctx, item) {
    const alarm = this.workers.some((worker) => worker.mood.mood === 'alarmed' && worker.monitor.kind !== 'intern');
    const { x, y, w, h } = item;
    rect(ctx, 'rgba(0, 0, 0, 0.25)', x + 1, y + h - 1, w, 2);
    rect(ctx, '#232832', x, y, w, h);
    rect(ctx, '#323947', x + 2, y + 2, w - 4, h - 4);
    for (let row = 0; row < 6; row++) {
      const ry = y + 4 + row * 6;
      rect(ctx, '#1b1f27', x + 3, ry, w - 6, 4);
      for (let led = 0; led < 3; led++) {
        const on = this.reduced.matches || Math.floor(this.time * 3 + row * 1.7 + led * 2.3) % 3 !== 0;
        const colour = alarm ? (on ? '#ff5a4f' : '#5a1d1a') : on ? '#4be37a' : '#1f4d2c';
        rect(ctx, colour, x + 5 + led * 3, ry + 1, 2, 2);
      }
      rect(ctx, '#56607a', x + w - 7, ry + 1, 3, 2);
    }
    // A beacon on top that turns when something is down.
    if (alarm) {
      const on = this.reduced.matches || Math.floor(this.time * 5) % 2 === 0;
      rect(ctx, on ? '#ff3b30' : '#a8281f', x + w / 2 - 3, y - 4, 6, 4);
      if (on) rect(ctx, 'rgba(255, 80, 70, 0.35)', x + w / 2 - 8, y - 7, 16, 9);
    } else {
      rect(ctx, '#4a5262', x + w / 2 - 3, y - 2, 6, 2);
    }
  }

  drawCoffee(ctx, item) {
    const { x, y, w, h } = item;
    rect(ctx, '#7c5a3c', x - 3, y + 12, w + 6, h - 12);
    rect(ctx, '#94704d', x - 3, y + 12, w + 6, 2);
    rect(ctx, '#2f3238', x, y, w, 14);
    rect(ctx, '#44484f', x + 2, y + 2, w - 4, 5);
    rect(ctx, '#d64545', x + 3, y + 3, 3, 3);
    rect(ctx, '#1d1f23', x + 6, y + 9, 6, 4);
    rect(ctx, '#f4f4f4', x + 7, y + 10, 4, 3);
    if (!this.reduced.matches && Math.floor(this.time * 2) % 2 === 0) rect(ctx, 'rgba(255,255,255,0.7)', x + 8, y + 6, 1, 2);
  }

  drawCooler(ctx, item) {
    const { x, y, w, h } = item;
    rect(ctx, '#7fc9f0', x + 2, y, w - 4, 11);
    rect(ctx, '#b6e3fa', x + 3, y + 1, 3, 9);
    rect(ctx, '#e9edf1', x, y + 11, w, h - 11);
    rect(ctx, '#cfd6dd', x, y + h - 3, w, 3);
    rect(ctx, '#3b8fd6', x + 3, y + 15, 2, 2);
    rect(ctx, '#d64545', x + w - 5, y + 15, 2, 2);
  }

  drawPlant(ctx, item) {
    const { x, y, w, h } = item;
    const sway = this.reduced.matches ? 0 : Math.round(Math.sin(this.time * 1.3 + x) * 0.6);
    rect(ctx, '#b35f37', x + 3, y + h - 8, w - 6, 8);
    rect(ctx, '#c97445', x + 3, y + h - 8, w - 6, 2);
    rect(ctx, '#2f7d4a', x + 2 + sway, y + 4, w - 4, h - 12);
    rect(ctx, '#3f9e5c', x + 4 + sway, y + 1, w - 8, h - 14);
    rect(ctx, '#57b873', x + 5 + sway, y + 3, 3, 4);
    rect(ctx, '#57b873', x + w - 8 + sway, y + 7, 3, 3);
    rect(ctx, '#2f7d4a', x + sway, y + 8, 3, 4);
    rect(ctx, '#2f7d4a', x + w - 3 + sway, y + 6, 3, 5);
  }

  drawSofa(ctx, item) {
    const { x, y, w, h } = item;
    rect(ctx, 'rgba(0, 0, 0, 0.2)', x + 2, y + h - 1, w - 2, 2);
    rect(ctx, '#3e5fae', x, y, w, h - 4);
    rect(ctx, '#5a7fd6', x + 2, y + 1, w - 4, 9);
    rect(ctx, '#4a6cc0', x + 4, y + 11, w - 8, 8);
    rect(ctx, '#6a8fe6', x + 5, y + 11, w / 2 - 6, 2);
    rect(ctx, '#6a8fe6', x + w / 2 + 1, y + 11, w / 2 - 6, 2);
    rect(ctx, '#3e5fae', x + w / 2 - 1, y + 11, 1, 8);
    rect(ctx, '#34508f', x, y + 4, 4, h - 8);
    rect(ctx, '#34508f', x + w - 4, y + 4, 4, h - 8);
    rect(ctx, '#2a3f73', x + 2, y + h - 4, 3, 4);
    rect(ctx, '#2a3f73', x + w - 5, y + h - 4, 3, 4);
  }

  drawPrinter(ctx, item) {
    const { x, y, w, h } = item;
    rect(ctx, 'rgba(0, 0, 0, 0.2)', x + 1, y + h - 1, w, 2);
    rect(ctx, '#8d96a3', x, y + 8, w, h - 8);
    rect(ctx, '#c9d0d8', x + 1, y + 6, w - 2, 8);
    rect(ctx, '#e9edf1', x + 1, y + 6, w - 2, 1);
    rect(ctx, '#ffffff', x + 4, y + 1, w - 8, 6);
    rect(ctx, '#d8dde3', x + 5, y + 3, w - 10, 1);
    rect(ctx, '#2f3540', x + 3, y + 15, w - 6, 2);
    rect(ctx, '#3fb950', x + w - 4, y + 9, 2, 1);
  }

  drawShelf(ctx, item) {
    const { x, y, w, h } = item;
    rect(ctx, '#7a5236', x, y, w, h);
    rect(ctx, '#5e3f29', x + 1, y + 1, w - 2, h - 2);
    const books = ['#d64545', '#3b8fd6', '#e8a91c', '#3f9e5c', '#8e6cc9', '#e8577d'];
    for (let i = 0; i < Math.floor((w - 4) / 3); i++) {
      rect(ctx, books[i % books.length], x + 2 + i * 3, y + 3 + (i % 3 === 0 ? 1 : 0), 2, h - 5 - (i % 3 === 0 ? 1 : 0));
    }
  }

  drawAgent(ctx, agent) {
    const sheet = spriteSheet(agent.worker.dog);
    const seatedAtDesk = agent.sitting && agent.x === agent.seat.x && agent.y === agent.seat.y;
    if (seatedAtDesk) this.drawChair(ctx, agent.seat);

    let pose = walkPose(agent);
    let dir = agent.dir;
    let flip = agent.flip;
    if (agent.sitting) {
      dir = 'down';
      flip = false;
      pose = agent.sleeping ? 'sleep' : this.blinking(agent) ? 'blink' : 'stand';
    }

    let ox = 0;
    let oy = 0;
    if (agent.shake && !this.reduced.matches) ox = Math.floor(this.time * 20) % 2 === 0 ? -1 : 1;
    if (agent.sleeping && !this.reduced.matches) oy = Math.floor(this.time * 0.8 + agent.seat.x) % 2;
    if (agent.typing === 'fast' && agent.sitting && !this.reduced.matches) oy = Math.floor(this.time * 8) % 2;
    if (!agent.sitting) oy += walkBob(agent);

    // A shadow under anyone on their feet.
    if (!agent.sitting) rect(ctx, 'rgba(40, 20, 5, 0.25)', agent.x - 5, agent.y - 1, 10, 2);
    drawFrame(ctx, sheet, dir, pose, Math.round(agent.x - FRAME_W / 2 + ox), Math.round(agent.y - FRAME_H + 1 + oy), flip);
  }

  blinking(agent) {
    if (this.reduced.matches) return false;
    const phase = (this.time + (agent.seat.x % 7) * 0.53) % 4.2;
    return phase < 0.14;
  }

  drawPaws(ctx, agent) {
    if (!agent.sitting || agent.sleeping) return;
    if (agent.x !== agent.seat.x || agent.y !== agent.seat.y) return;
    const sheet = spriteSheet(agent.worker.dog);
    const fur = sheet.palette.p;
    const line = sheet.palette.o;
    const desk = this.layout.desks[agent.seat.desk];
    if (!desk) return;
    const rate = agent.typing === 'fast' ? 14 : agent.typing === 'calm' ? 6 : 0;
    const tick = this.reduced.matches || rate === 0 ? 0 : Math.floor(this.time * rate) % 2;
    const py = desk.y + 1;
    const left = agent.x - 5;
    const right = agent.x + 2;
    rect(ctx, line, left - 1, py - (tick ? 1 : 0) - 1, 5, 4);
    rect(ctx, fur, left, py - (tick ? 1 : 0), 3, 2);
    rect(ctx, line, right - 1, py - (tick ? 0 : 1) - 1, 5, 4);
    rect(ctx, fur, right, py - (tick ? 0 : 1), 3, 2);
  }

  drawBubble(ctx, agent) {
    const kind = agent.bubble;
    if (!kind) return;
    const headX = Math.round(agent.x);
    const headY = Math.round(agent.y - FRAME_H + 4);
    const bob = this.reduced.matches ? 0 : Math.round(Math.sin(this.time * 3 + agent.seat.x) * 0.6);

    if (kind === 'sleep') {
      const t = this.reduced.matches ? 0 : (this.time * 0.7 + agent.seat.x * 0.1) % 1;
      const zx = headX + 6 + Math.round(t * 4);
      const zy = headY - 2 - Math.round(t * 6);
      this.glyphZ(ctx, zx, zy, '#7fa8ff');
      if (t > 0.4) this.glyphZ(ctx, zx + 4, zy - 5, '#a9c4ff');
      return;
    }
    if (kind === 'sweat') {
      const t = this.reduced.matches ? 0.3 : (this.time * 1.2) % 1;
      const sx = headX + 6;
      const sy = headY + 1 + Math.round(t * 5);
      rect(ctx, '#7cc8ff', sx, sy, 2, 3);
      rect(ctx, '#7cc8ff', sx + 1 - 1, sy - 1, 1, 1);
      rect(ctx, '#d6f0ff', sx, sy, 1, 1);
      return;
    }

    const icon = ICONS[kind];
    if (!icon) return;
    const bx = headX + 3;
    const by = headY - 11 + bob;
    rect(ctx, '#2b2b33', bx - 1, by - 1, 11, 10);
    rect(ctx, '#ffffff', bx, by, 9, 8);
    rect(ctx, '#2b2b33', bx + 1, by + 8, 3, 1);
    rect(ctx, '#ffffff', bx + 2, by + 8, 1, 1);
    rect(ctx, '#2b2b33', bx + 1, by + 9, 1, 1);
    icon.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#') rect(ctx, icon.colour, bx + 2 + rx, by + 1 + ry, 1, 1);
      }
    });
  }

  glyphZ(ctx, x, y, colour) {
    rect(ctx, colour, x, y, 4, 1);
    rect(ctx, colour, x + 2, y + 1, 1, 1);
    rect(ctx, colour, x + 1, y + 2, 1, 1);
    rect(ctx, colour, x, y + 3, 4, 1);
  }

  /** At night, each screen lights the face in front of it. */
  drawGlows(ctx) {
    for (const desk of this.layout.desks) {
      const worker = this.workers[desk.index];
      const colour = MOOD_COLOUR[worker?.mood.mood ?? 'offDuty'];
      const glow = ctx.createRadialGradient(desk.x + 10, desk.y - 4, 1, desk.x + 10, desk.y - 4, 22);
      glow.addColorStop(0, `${colour}55`);
      glow.addColorStop(1, `${colour}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(desk.x - 14, desk.y - 28, 48, 48);
    }
  }

  /** The name over whoever the pointer is on, in real text so it stays sharp. */
  drawLabels(ctx) {
    if (!this.hover) return;
    const agent = this.agents.get(this.hover);
    if (!agent) return;
    const worker = agent.worker;
    const k = this.scale;
    const name = worker.label ?? worker.monitor.name;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(12 * dpr);
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    const textW = ctx.measureText(name).width;
    const padX = 6 * dpr;
    const boxW = textW + padX * 2 + 10 * dpr;
    const boxH = size + 8 * dpr;
    let x = agent.x * k - boxW / 2;
    const y = (agent.y - FRAME_H - 6) * k - boxH;
    x = Math.max(4, Math.min(this.canvas.width - boxW - 4, x));
    ctx.fillStyle = 'rgba(20, 22, 28, 0.88)';
    ctx.beginPath();
    ctx.roundRect?.(x, Math.max(4, y), boxW, boxH, 6 * dpr);
    if (!ctx.roundRect) ctx.rect(x, Math.max(4, y), boxW, boxH);
    ctx.fill();
    ctx.fillStyle = MOOD_COLOUR[worker.mood.mood];
    ctx.beginPath();
    ctx.arc(x + padX + 3 * dpr, Math.max(4, y) + boxH / 2, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + padX + 10 * dpr, Math.max(4, y) + boxH / 2 + dpr);
  }
}

export { MOOD_COLOUR, CELL };
