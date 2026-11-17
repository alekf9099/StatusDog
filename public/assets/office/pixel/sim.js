/**
 * What each colleague is doing, moment to moment.
 *
 * A colleague works through a queue of small tasks — walk somewhere, sit and
 * type, stand and sip a coffee, sleep — and when the queue runs dry, plans more
 * from its mood. The mood still comes from mood.js and the site's real state; this
 * only decides how that mood looks when acted out:
 *
 *   working   types in short stretches, then gets up: coffee, water, the window,
 *             the bookshelf, a sit on the sofa, a stroll, a chat with whoever
 *             else is up — often two or three of those in one outing
 *   strained  typing fast with a sweat drop, dashing out for coffee
 *   uneasy    restless: sits, gets up, paces by the desk, looks around
 *   alarmed   runs to the server rack and back, over and over
 *   offDuty   asleep — on the sofa if there is room, at the desk if not
 *
 * Free of the DOM and of real time (the caller passes `dt` and a random source),
 * so a test can run a colleague through a mood and watch where it ends up.
 */
import { CELL, findPath } from './world.js';

export const WALK_SPEED = 22;
export const RUN_SPEED = 48;
/** How fast a colleague gets up to speed, and how hard it can stop (px/s²). */
const ACCEL = 110;
const DECEL = 90;
/** Pixels of floor per frame of the walk cycle, so feet never slide. */
const STRIDE_PX = 4;
/** Getting up from a chair takes a moment before the first step. */
const RISE_S = 0.3;
/** Nobody walks through a colleague: within this distance ahead, they slow to let them by. */
const PERSONAL_SPACE = 9;

const between = (rng, lo, hi) => lo + rng() * (hi - lo);
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

export function createAgent(uid, seat) {
  return {
    uid,
    x: seat.x,
    y: seat.y,
    seat,
    dir: 'down',
    flip: false,
    mood: null,
    queue: [],
    task: null,
    path: null,
    clock: 0,
    stride: 0,
    /** Current walking speed, ramped up and down rather than switched. */
    speed: 0,
    /** Seconds to wait before moving, e.g. while getting up. */
    delay: 0,
    /** What the renderer shows: sitting at the desk, asleep, and so on. */
    sitting: true,
    sleeping: false,
    typing: null,
    bubble: null,
    shake: false,
    claim: null,
  };
}

/** Move a colleague to a new seat (the room was re-laid out). */
export function reseat(agent, seat) {
  const moved = agent.seat.x !== seat.x || agent.seat.y !== seat.y;
  agent.seat = seat;
  if (moved) {
    agent.queue = [];
    agent.task = null;
  }
}

/**
 * Change what a colleague is feeling. Plans are thrown away at once — an alarm
 * should not wait for a coffee to be finished — but the colleague walks on from
 * wherever it is standing, it does not teleport.
 */
export function setMood(agent, mood, world) {
  if (agent.mood === mood) return;
  agent.mood = mood;
  agent.queue = [];
  agent.task = null;
  release(agent, world);
}

/** Put a colleague where its mood would have it, without the walk. For reduced motion. */
export function settle(agent, world) {
  release(agent, world);
  agent.queue = [];
  agent.task = null;
  agent.path = null;
  agent.dir = 'down';
  agent.flip = false;
  agent.sleeping = false;
  agent.shake = false;
  agent.typing = null;
  agent.bubble = moodBubble(agent.mood);
  let spot = agent.seat;
  if (agent.mood === 'alarmed') {
    spot = world.spots.rack;
    agent.dir = 'up';
  } else if (agent.mood === 'offDuty') {
    const sofa = claimSofa(agent, world);
    if (sofa) spot = sofa;
    agent.sleeping = true;
  }
  agent.x = spot.x;
  agent.y = spot.y;
  agent.sitting = spot === agent.seat || agent.mood === 'offDuty';
}

function moodBubble(mood) {
  return { alarmed: 'alert', uneasy: 'question', strained: 'sweat', offDuty: 'sleep' }[mood] ?? null;
}

function release(agent, world) {
  if (agent.claim && world.claims) world.claims.delete(agent.claim);
  agent.claim = null;
}

function claimSofa(agent, world) {
  world.claims ??= new Map();
  for (let i = 0; i < world.spots.sofa.length; i++) {
    const key = `sofa:${i}`;
    const holder = world.claims.get(key);
    if (!holder || holder === agent.uid) {
      world.claims.set(key, agent.uid);
      agent.claim = key;
      return world.spots.sofa[i];
    }
  }
  return null;
}

/** Anywhere on open floor, for a stroll with no errand. */
function strollPoint(world, rng) {
  const { grid } = world;
  for (let tries = 0; tries < 40; tries++) {
    const c = Math.floor(rng() * grid.cols);
    const r = Math.floor(rng() * grid.rows);
    if (grid.open[r * grid.cols + c] !== 1) continue;
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
  }
  return world.spots.window;
}

/**
 * One stop on an outing: where to go, and what to do there. Returns a list of
 * tasks, since some stops are more than standing about.
 */
function breakStop(agent, world, rng, others) {
  const stand = (to, face, bubble, lo = 2.5, hi = 5) => [
    { kind: 'go', to },
    { kind: 'idle', dur: between(rng, lo, hi), face, bubble, lookAround: !bubble },
  ];
  const options = [
    () => stand(world.spots.coffee, 'up', 'coffee'),
    () => stand(world.spots.cooler, 'up', 'water'),
    () => stand(world.spots.plant, 'up', 'heart'),
    () => stand(world.spots.window, 'up', 'sun', 3, 6),
    // A wander with no errand, looking about.
    () => stand(strollPoint(world, rng), 'down', null, 1.5, 3.5),
    () => stand(strollPoint(world, rng), 'down', null, 1.5, 3.5),
  ];
  if (world.spots.printer) options.push(() => stand(world.spots.printer, 'down', 'doc'));
  if (world.spots.shelf) options.push(() => stand(world.spots.shelf, 'up', 'doc', 3, 6));

  // A sit on the sofa with a coffee, if a seat is free.
  options.push(() => {
    const sofa = claimSofa(agent, world);
    return sofa
      ? [{ kind: 'go', to: sofa }, { kind: 'lounge', dur: between(rng, 5, 10), bubble: 'coffee' }]
      : stand(world.spots.coffee, 'up', 'coffee');
  });

  // A chat: with someone already up and about, face to face; otherwise at a desk.
  const standing = others.filter((other) => other !== agent && !other.sitting && other.task?.kind === 'idle');
  const seated = others.filter((other) => other !== agent && other.sitting && !other.sleeping);
  if (standing.length > 0) {
    options.push(() => {
      const friend = pick(rng, standing);
      const side = friend.x > world.width / 2 ? -12 : 12;
      return [
        { kind: 'go', to: { x: friend.x + side, y: friend.y } },
        { kind: 'idle', dur: between(rng, 3, 5), face: side > 0 ? 'left' : 'right', bubble: 'chat' },
      ];
    });
  }
  if (seated.length > 0) {
    options.push(() => {
      const friend = pick(rng, seated);
      const desk = world.desks[friend.seat.desk];
      return stand(desk?.front ?? friend.seat, 'up', 'chat');
    });
  }
  return pick(rng, options)();
}

/** Plan the next stretch of tasks from the mood. */
export function plan(agent, world, rng, others = []) {
  const seat = agent.seat;
  const home = { kind: 'go', to: seat };
  switch (agent.mood) {
    case 'alarmed':
      return [
        { kind: 'go', to: world.spots.rack, run: true },
        { kind: 'idle', dur: between(rng, 2, 3.5), face: 'up', bubble: 'alert', shake: true },
        { kind: 'go', to: seat, run: true },
        { kind: 'sit', dur: between(rng, 1.5, 3), typing: 'fast', bubble: 'alert' },
      ];
    case 'offDuty': {
      const sofa = claimSofa(agent, world);
      return sofa
        ? [{ kind: 'go', to: sofa }, { kind: 'sleep', at: 'sofa' }]
        : [home, { kind: 'sleep', at: 'desk' }];
    }
    case 'uneasy': {
      const side = rng() < 0.5 ? -1 : 1;
      const desk = world.desks[seat.desk];
      const front = desk?.front ?? { x: seat.x, y: seat.y + 24 };
      return [
        home,
        { kind: 'sit', dur: between(rng, 3, 6), typing: 'calm', bubble: 'question' },
        { kind: 'go', to: { x: front.x + side * 18, y: front.y } },
        { kind: 'idle', dur: between(rng, 1, 2), face: 'down', bubble: 'question' },
        { kind: 'go', to: { x: front.x - side * 18, y: front.y } },
        { kind: 'idle', dur: between(rng, 0.8, 1.6), face: side > 0 ? 'left' : 'right', bubble: 'question' },
      ];
    }
    case 'strained': {
      const tasks = [home, { kind: 'sit', dur: between(rng, 7, 14), typing: 'fast', bubble: 'sweat' }];
      if (rng() < 0.35) {
        tasks.push(
          { kind: 'go', to: world.spots.coffee, run: true },
          { kind: 'idle', dur: between(rng, 1.5, 2.5), face: 'up', bubble: 'coffee' },
        );
      }
      return tasks;
    }
    case 'working':
    default: {
      // Short stretches at the desk, and most of the time an outing after:
      // about half the day is spent on the move, as in a management game.
      const tasks = [home, { kind: 'sit', dur: between(rng, 7, 16), typing: 'calm' }];
      if (rng() < 0.85) {
        const stops = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < stops; i++) tasks.push(...breakStop(agent, world, rng, others));
      }
      return tasks;
    }
  }
}

/**
 * Face the way you are going — with some reluctance to change, so a walk at
 * 45° does not flicker between the side view and the back view every frame.
 */
function faceToward(agent, dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const keepSide = agent.dir === 'side' && ax > ay * 0.6;
  const keepVertical = agent.dir !== 'side' && ay > ax * 0.6;
  if (keepSide || (!keepVertical && ax > ay)) {
    agent.dir = 'side';
    agent.flip = dx < 0;
  } else {
    agent.dir = dy < 0 ? 'up' : 'down';
    agent.flip = false;
  }
}

function applyFace(agent, face) {
  if (face === 'left' || face === 'right') {
    agent.dir = 'side';
    agent.flip = face === 'left';
  } else if (face) {
    agent.dir = face;
    agent.flip = false;
  }
}

function begin(agent, task, world) {
  const wasSeated = agent.sitting;
  agent.task = task;
  agent.clock = 0;
  agent.sitting = false;
  agent.sleeping = false;
  agent.typing = null;
  agent.shake = false;
  agent.bubble = null;
  if (task.kind === 'go') {
    // Someone in a chair stands up before they set off.
    agent.delay = wasSeated ? RISE_S : 0;
    agent.speed = 0;
    agent.path = findPath(world.grid, agent, task.to);
  } else if (task.kind === 'sit') {
    agent.x = agent.seat.x;
    agent.y = agent.seat.y;
    agent.dir = 'down';
    agent.flip = false;
    agent.sitting = true;
    agent.typing = task.typing ?? null;
    agent.bubble = task.bubble ?? null;
  } else if (task.kind === 'idle') {
    applyFace(agent, task.face);
    agent.bubble = task.bubble ?? null;
    agent.shake = Boolean(task.shake);
  } else if (task.kind === 'lounge') {
    // On the sofa, awake, with a coffee.
    agent.dir = 'down';
    agent.flip = false;
    agent.sitting = true;
    agent.bubble = task.bubble ?? null;
  } else if (task.kind === 'sleep') {
    agent.dir = 'down';
    agent.flip = false;
    agent.sitting = true;
    agent.sleeping = true;
    agent.bubble = 'sleep';
  }
}

/**
 * Advance one colleague by `dt` seconds. Returns nothing; the agent object is
 * the state the renderer reads.
 */
export function step(agent, dt, world, rng, others = []) {
  if (!agent.task) {
    if (agent.queue.length === 0) agent.queue = plan(agent, world, rng, others);
    begin(agent, agent.queue.shift(), world);
  }
  const task = agent.task;
  agent.clock += dt;

  if (task.kind === 'go') {
    if (agent.delay > 0) {
      agent.delay -= dt;
      return;
    }
    const top = task.run ? RUN_SPEED : WALK_SPEED;
    // Ease in, and ease out so as to stop on the spot rather than at it.
    const remaining = pathLength(agent);
    const braking = Math.sqrt(2 * DECEL * remaining);
    let target = Math.min(top, Math.max(braking, 6));
    if (blockedAhead(agent, others)) target = Math.min(target, top * 0.25);
    agent.speed = agent.speed < target
      ? Math.min(target, agent.speed + ACCEL * dt)
      : Math.max(target, agent.speed - DECEL * dt);

    let budget = agent.speed * dt;
    let moved = 0;
    while (budget > 0 && agent.path && agent.path.length > 0) {
      const next = agent.path[0];
      const dx = next.x - agent.x;
      const dy = next.y - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) faceToward(agent, dx, dy);
      if (dist <= budget) {
        agent.x = next.x;
        agent.y = next.y;
        agent.path.shift();
        budget -= dist;
        moved += dist;
      } else {
        agent.x += (dx / dist) * budget;
        agent.y += (dy / dist) * budget;
        moved += budget;
        budget = 0;
      }
    }
    agent.stride += moved / STRIDE_PX;
    if (!agent.path || agent.path.length === 0) {
      agent.task = null;
      agent.speed = 0;
    }
    return;
  }

  if (task.kind === 'sleep') return;
  // Standing about with nothing in hand: look one way, then the other.
  if (task.kind === 'idle' && task.lookAround) {
    const phase = Math.floor(agent.clock / 1.2) % 4;
    applyFace(agent, ['down', 'left', 'down', 'right'][phase]);
  }
  if (agent.clock >= task.dur) {
    if (task.kind === 'lounge') release(agent, world);
    agent.task = null;
  }
}

function pathLength(agent) {
  let total = 0;
  let from = agent;
  for (const point of agent.path ?? []) {
    total += Math.hypot(point.x - from.x, point.y - from.y);
    from = point;
  }
  return total;
}

/**
 * Is someone standing or walking just ahead? Only one of two people who meet
 * gives way — the one with the later name — so they never both stop dead.
 */
function blockedAhead(agent, others) {
  const next = agent.path?.[0];
  if (!next) return false;
  const hx = next.x - agent.x;
  const hy = next.y - agent.y;
  const len = Math.hypot(hx, hy) || 1;
  for (const other of others) {
    if (other === agent || other.sitting) continue;
    const ox = other.x - agent.x;
    const oy = other.y - agent.y;
    const dist = Math.hypot(ox, oy);
    if (dist > PERSONAL_SPACE || dist < 0.01) continue;
    const ahead = (ox * hx + oy * hy) / (len * dist);
    if (ahead > 0.5 && (other.task?.kind !== 'go' || agent.uid > other.uid)) return true;
  }
  return false;
}

/** Which walk frame to show. Still while getting up from a chair. */
export function walkPose(agent) {
  if (agent.task?.kind !== 'go' || agent.delay > 0) return 'stand';
  const phase = Math.floor(agent.stride) % 4;
  return phase === 0 ? 'stepA' : phase === 2 ? 'stepB' : 'stand';
}

/** The little lift of each step: up on the passing frames, down on the strides. */
export function walkBob(agent) {
  if (agent.task?.kind !== 'go' || agent.delay > 0 || agent.speed < 1) return 0;
  return Math.floor(agent.stride) % 2 === 1 ? -1 : 0;
}
