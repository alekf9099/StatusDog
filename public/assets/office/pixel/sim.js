/**
 * What each colleague is doing, moment to moment.
 *
 * A colleague works through a queue of small tasks — walk somewhere, sit and
 * type, stand and sip a coffee, sleep — and when the queue runs dry, plans more
 * from its mood. The mood still comes from mood.js and the site's real state; this
 * only decides how that mood looks when acted out:
 *
 *   working   mostly at the desk typing, with coffee, water and chats in between
 *   strained  typing fast with a sweat drop, dashing out for coffee
 *   uneasy    restless: sits, gets up, paces by the desk, looks around
 *   alarmed   runs to the server rack and back, over and over
 *   offDuty   asleep — on the sofa if there is room, at the desk if not
 *
 * Free of the DOM and of real time (the caller passes `dt` and a random source),
 * so a test can run a colleague through a mood and watch where it ends up.
 */
import { findPath } from './world.js';

export const WALK_SPEED = 22;
export const RUN_SPEED = 48;
/** Steps per second of the walk cycle at walking pace. */
const STRIDE_HZ = 7;

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

/** Somewhere to go on a break, and what to do there. */
function breakPlan(agent, world, rng, others) {
  const options = [
    () => ({ to: world.spots.coffee, face: 'up', bubble: 'coffee' }),
    () => ({ to: world.spots.cooler, face: 'up', bubble: 'water' }),
    () => ({ to: world.spots.plant, face: 'up', bubble: 'heart' }),
    () => ({ to: world.spots.window, face: 'up', bubble: 'sun' }),
  ];
  if (world.spots.printer) options.push(() => ({ to: world.spots.printer, face: 'down', bubble: 'doc' }));
  const colleague = others.filter((other) => other !== agent && other.sitting && !other.sleeping);
  if (colleague.length > 0) {
    options.push(() => {
      const friend = pick(rng, colleague);
      const desk = world.desks[friend.seat.desk];
      return { to: desk?.front ?? friend.seat, face: 'up', bubble: 'chat' };
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
      const tasks = [home, { kind: 'sit', dur: between(rng, 14, 34), typing: 'calm' }];
      if (rng() < 0.55) {
        const trip = breakPlan(agent, world, rng, others);
        tasks.push(
          { kind: 'go', to: trip.to },
          { kind: 'idle', dur: between(rng, 2.5, 5), face: trip.face, bubble: trip.bubble },
        );
      }
      return tasks;
    }
  }
}

function faceToward(agent, dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
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
  agent.task = task;
  agent.clock = 0;
  agent.sitting = false;
  agent.sleeping = false;
  agent.typing = null;
  agent.shake = false;
  agent.bubble = null;
  if (task.kind === 'go') {
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
    const speed = task.run ? RUN_SPEED : WALK_SPEED;
    let budget = speed * dt;
    while (budget > 0 && agent.path && agent.path.length > 0) {
      const next = agent.path[0];
      const dx = next.x - agent.x;
      const dy = next.y - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) faceToward(agent, dx, dy);
      if (dist <= budget) {
        agent.x = next.x;
        agent.y = next.y;
        agent.path.shift();
        budget -= dist;
      } else {
        agent.x += (dx / dist) * budget;
        agent.y += (dy / dist) * budget;
        budget = 0;
      }
    }
    agent.stride += dt * STRIDE_HZ * (speed / WALK_SPEED);
    if (!agent.path || agent.path.length === 0) agent.task = null;
    return;
  }

  if (task.kind === 'sleep') return;
  if (agent.clock >= task.dur) agent.task = null;
}

/** Which walk frame to show. */
export function walkPose(agent) {
  if (agent.task?.kind !== 'go') return 'stand';
  const phase = Math.floor(agent.stride) % 4;
  return phase === 0 ? 'stepA' : phase === 2 ? 'stepB' : 'stand';
}
