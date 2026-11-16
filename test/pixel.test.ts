import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (file: string) => import(pathToFileURL(path.resolve(`public/assets/office/${file}`)).href);

type Point = { x: number; y: number };
type Grid = { cols: number; rows: number; open: Uint8Array };
type Layout = {
  width: number;
  height: number;
  seats: Array<Point & { desk: number }>;
  desks: Array<{ x: number; y: number; w: number; h: number; front: Point }>;
  spots: Record<string, Point> & { sofa: Point[] };
  furniture: Array<{ kind: string; x: number; y: number; w: number; h: number; floor?: boolean }>;
  grid: Grid;
  claims?: Map<string, string>;
};
type Agent = Point & {
  mood: string | null;
  task: { kind: string } | null;
  sitting: boolean;
  sleeping: boolean;
  bubble: string | null;
  seat: Point;
  claim: string | null;
};

const world = (await load('pixel/world.js')) as {
  buildLayout: (count: number, width?: number) => Layout;
  findPath: (grid: Grid, from: Point, to: Point) => Point[];
  footprint: (item: { kind: string; x: number; y: number; w: number; h: number }) => { x: number; y: number; w: number; h: number };
  CELL: number;
};
const sim = (await load('pixel/sim.js')) as {
  createAgent: (uid: string, seat: Point & { desk: number }) => Agent;
  setMood: (agent: Agent, mood: string, layout: Layout) => void;
  settle: (agent: Agent, layout: Layout) => void;
  step: (agent: Agent, dt: number, layout: Layout, rng: () => number, others?: Agent[]) => void;
};
const sprites = (await load('pixel/sprites.js')) as {
  frameGrids: (species: string) => Record<string, Record<string, string[]>>;
  paletteFor: (species: object, coat: object) => Record<string, string>;
  FRAME_W: number;
  FRAME_H: number;
};
const dogs = (await load('dogs.js')) as {
  SPECIES_KEYS: string[];
  COAT_KEYS: string[];
  speciesByKey: (key: string) => object;
  coatByKey: (key: string) => object;
};

/** A repeatable random source, so a simulated day plays out the same every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function isOpenAt(grid: Grid, p: Point) {
  const c = Math.floor(p.x / world.CELL);
  const r = Math.floor(p.y / world.CELL);
  return grid.open[r * grid.cols + c] === 1;
}

function run(agent: Agent, layout: Layout, seconds: number, others: Agent[] = [agent], rng = seeded()) {
  for (let t = 0; t < seconds; t += 0.05) sim.step(agent, 0.05, layout, rng, others);
}

/* ---------- layout ---------- */

test('every colleague gets a seat, and no two desks overlap', () => {
  for (const [count, width] of [[1, 384], [3, 336], [7, 384], [12, 480], [5, 192]]) {
    const layout = world.buildLayout(count, width);
    assert.equal(layout.seats.length, count);
    for (let i = 0; i < layout.desks.length; i++) {
      for (let j = i + 1; j < layout.desks.length; j++) {
        const a = layout.desks[i];
        const b = layout.desks[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `desks ${i} and ${j} overlap in a room of ${count}`);
      }
    }
    for (const desk of layout.desks) {
      assert.ok(desk.x >= 0 && desk.x + desk.w <= layout.width, 'desk inside the room');
      assert.ok(desk.y + desk.h <= layout.height, 'desk above the bottom wall');
    }
  }
});

test('a narrow room puts the lounge at the bottom instead of the side', () => {
  const wide = world.buildLayout(3, 384);
  const narrow = world.buildLayout(3, 192);
  const sofa = (layout: Layout) => layout.furniture.find((item) => item.kind === 'sofa')!;
  assert.ok(sofa(wide).x > wide.width / 2, 'wide room: sofa on the right');
  assert.ok(sofa(narrow).y > Math.max(...narrow.desks.map((desk) => desk.y)), 'narrow room: sofa below the desks');
});

test('every seat and every place to visit can be reached from every other', () => {
  for (const [count, width] of [[3, 336], [8, 384], [4, 192]]) {
    const layout = world.buildLayout(count, width);
    const places: Point[] = [
      ...layout.seats,
      ...layout.desks.map((desk) => desk.front),
      layout.spots.rack, layout.spots.coffee, layout.spots.cooler, layout.spots.window,
      ...layout.spots.sofa,
    ];
    for (const from of places) {
      for (const to of places) {
        const route = world.findPath(layout.grid, from, to);
        const end = route[route.length - 1];
        assert.deepEqual({ x: end.x, y: end.y }, { x: to.x, y: to.y });
        // Every waypoint but the last (the exact spot) is on open floor.
        for (const point of route.slice(0, -1)) {
          assert.ok(isOpenAt(layout.grid, point), `route from ${JSON.stringify(from)} crosses furniture`);
        }
      }
    }
  }
});

test('a seat is behind its desk, on open floor, not inside the desk', () => {
  const layout = world.buildLayout(4, 384);
  layout.seats.forEach((seat, i) => {
    const foot = world.footprint({ kind: 'desk', ...layout.desks[i] });
    assert.ok(seat.y < foot.y, 'the seat is behind the desk');
    assert.ok(isOpenAt(layout.grid, seat), 'the seat can be walked to');
  });
});

/* ---------- behaviour ---------- */

function freshRoom(count = 3) {
  const layout = world.buildLayout(count, 336);
  layout.claims = new Map();
  return layout;
}

test('working: at the desk typing to begin with', () => {
  const layout = freshRoom();
  const agent = sim.createAgent('a', layout.seats[0]);
  sim.setMood(agent, 'working', layout);
  run(agent, layout, 1);
  assert.equal(agent.task?.kind, 'sit');
  assert.ok(agent.sitting);
  assert.deepEqual({ x: agent.x, y: agent.y }, { x: layout.seats[0].x, y: layout.seats[0].y });
});

test('alarmed: runs to the server rack with an alert', () => {
  const layout = freshRoom();
  const agent = sim.createAgent('a', layout.seats[2]);
  sim.setMood(agent, 'alarmed', layout);
  let reached = false;
  for (let t = 0; t < 15 && !reached; t += 0.05) {
    sim.step(agent, 0.05, layout, seeded(), [agent]);
    reached = Math.hypot(agent.x - layout.spots.rack.x, agent.y - layout.spots.rack.y) < 1 && agent.bubble === 'alert';
  }
  assert.ok(reached, 'got to the rack and raised the alarm');
});

test('offDuty: two sleep on the sofa, the third at the desk', () => {
  const layout = freshRoom(3);
  const agents = layout.seats.map((seat, i) => sim.createAgent(`a${i}`, seat));
  for (const agent of agents) sim.setMood(agent, 'offDuty', layout);
  const rng = seeded(3);
  for (let t = 0; t < 30; t += 0.05) for (const agent of agents) sim.step(agent, 0.05, layout, rng, agents);
  assert.ok(agents.every((agent) => agent.sleeping), 'everyone is asleep');
  const onSofa = agents.filter((agent) => agent.claim?.startsWith('sofa'));
  assert.equal(onSofa.length, layout.spots.sofa.length, 'the sofa is full');
  const atDesk = agents.filter((agent) => !agent.claim);
  assert.equal(atDesk.length, 1);
  assert.deepEqual({ x: atDesk[0].x, y: atDesk[0].y }, { x: atDesk[0].seat.x, y: atDesk[0].seat.y });
});

test('a mood change interrupts a plan, and waking up frees the sofa', () => {
  const layout = freshRoom(1);
  const agent = sim.createAgent('a', layout.seats[0]);
  sim.setMood(agent, 'offDuty', layout);
  run(agent, layout, 20);
  assert.ok(agent.sleeping);
  sim.setMood(agent, 'alarmed', layout);
  assert.equal(layout.claims!.size, 0, 'the sofa spot is released');
  run(agent, layout, 0.2);
  assert.ok(!agent.sleeping, 'up and moving');
});

test('reduced motion: settle puts everyone where the mood says, without walking', () => {
  const layout = freshRoom(2);
  const alarmed = sim.createAgent('a', layout.seats[0]);
  sim.setMood(alarmed, 'alarmed', layout);
  sim.settle(alarmed, layout);
  assert.deepEqual({ x: alarmed.x, y: alarmed.y }, layout.spots.rack);
  assert.equal(alarmed.bubble, 'alert');

  const working = sim.createAgent('b', layout.seats[1]);
  sim.setMood(working, 'working', layout);
  sim.settle(working, layout);
  assert.ok(working.sitting);
  assert.deepEqual({ x: working.x, y: working.y }, { x: layout.seats[1].x, y: layout.seats[1].y });
});

test('a long working day never leaves anyone inside the furniture', () => {
  const layout = freshRoom(5);
  const agents = layout.seats.map((seat, i) => sim.createAgent(`a${i}`, seat));
  for (const agent of agents) sim.setMood(agent, 'working', layout);
  const rng = seeded(11);
  for (let t = 0; t < 300; t += 0.1) {
    for (const agent of agents) {
      sim.step(agent, 0.1, layout, rng, agents);
      if (agent.task?.kind === 'go') {
        assert.ok(agent.x >= 0 && agent.x <= layout.width && agent.y >= 0 && agent.y <= layout.height, 'inside the room');
      }
    }
  }
});

/* ---------- sprites ---------- */

test('every frame of every species is a full 16×20 grid with known colours', () => {
  for (const key of dogs.SPECIES_KEYS) {
    const grids = sprites.frameGrids(key);
    const palette = sprites.paletteFor(dogs.speciesByKey(key), dogs.coatByKey(dogs.COAT_KEYS[0]));
    for (const [dir, poses] of Object.entries(grids)) {
      for (const [pose, rows] of Object.entries(poses)) {
        assert.equal(rows.length, sprites.FRAME_H, `${key} ${dir}.${pose} height`);
        for (const row of rows) {
          assert.equal(row.length, sprites.FRAME_W, `${key} ${dir}.${pose} width`);
          for (const ch of row) assert.ok(ch === '.' || palette[ch], `${key} ${dir}.${pose} uses unknown "${ch}"`);
        }
      }
    }
  }
});

test('a sleeping face has its eyes shut', () => {
  for (const key of dogs.SPECIES_KEYS) {
    const { down } = sprites.frameGrids(key);
    assert.ok(down.stand.join('').includes('e'), `${key} has eyes`);
    assert.ok(!down.sleep.join('').includes('e'), `${key} closes them`);
  }
});
