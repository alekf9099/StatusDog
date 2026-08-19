import { EventEmitter } from 'node:events';
import type { ProbeResult, ResolvedConfig, ResolvedTarget } from '../config/types.js';
import { probe } from './probe.js';
import { HistoryStore, type HistoryRecord, type TargetStats } from './store.js';
import {
  applyResult,
  INITIAL_STATE,
  type StateSnapshot,
  type TargetState,
  type TransitionEvent,
} from './transition.js';

export type { TargetState, TransitionEvent };

export interface TargetStatus {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  state: TargetState;
  /** When the target entered its current state. */
  since: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastResult: ProbeResult | null;
  stats: TargetStats;
  intervalMs: number;
}

export interface CheckEvent {
  target: ResolvedTarget;
  result: ProbeResult;
  record: HistoryRecord;
}

interface InternalState extends StateSnapshot {
  lastResult: ProbeResult | null;
  timer: NodeJS.Timeout | null;
  inFlight: Promise<ProbeResult> | null;
}

export interface Monitor {
  on(event: 'check', listener: (e: CheckEvent) => void): this;
  on(event: 'up', listener: (e: TransitionEvent) => void): this;
  on(event: 'down', listener: (e: TransitionEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Schedules probes for every configured target and tracks up/down state.
 *
 * A target only flips state after `failureThreshold` consecutive failures (or
 * `recoveryThreshold` consecutive successes), which keeps a single blip from
 * triggering a fallback page.
 */
export class Monitor extends EventEmitter {
  readonly store: HistoryStore;
  private readonly targets = new Map<string, ResolvedTarget>();
  private readonly states = new Map<string, InternalState>();
  private running = false;

  constructor(
    readonly config: ResolvedConfig,
    store?: HistoryStore,
  ) {
    super();
    this.store = store ?? new HistoryStore(config.storage.file, config.storage.historyLimit);
    for (const target of config.targets) {
      this.targets.set(target.id, target);
      this.states.set(target.id, {
        ...INITIAL_STATE,
        lastResult: null,
        timer: null,
        inFlight: null,
      });
    }
    // Nothing else listens for 'error' by default; swallow instead of crashing.
    this.on('error', () => {});
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Begin the check loop. Each target probes immediately, then on its interval. */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const target of this.targets.values()) {
      if (!target.enabled) continue;
      void this.loop(target.id);
    }
  }

  /** Stop scheduling. In-flight probes are allowed to settle. */
  stop(): void {
    this.running = false;
    for (const state of this.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }
  }

  listTargets(): ResolvedTarget[] {
    return [...this.targets.values()];
  }

  getTarget(id: string): ResolvedTarget | undefined {
    return this.targets.get(id);
  }

  /** Run a check now, outside the schedule. Concurrent calls share one probe. */
  async check(id: string): Promise<ProbeResult> {
    const target = this.targets.get(id);
    const state = this.states.get(id);
    if (!target || !state) throw new Error(`Unknown target "${id}".`);
    if (state.inFlight) return state.inFlight;

    const pending = probe(target).then((result) => {
      state.inFlight = null;
      this.record(target, state, result);
      return result;
    });
    state.inFlight = pending;
    return pending;
  }

  /** Check every enabled target once, in parallel. */
  async checkAll(): Promise<ProbeResult[]> {
    const enabled = this.listTargets().filter((t) => t.enabled);
    return Promise.all(enabled.map((t) => this.check(t.id)));
  }

  getStatus(id: string): TargetStatus | undefined {
    const target = this.targets.get(id);
    const state = this.states.get(id);
    if (!target || !state) return undefined;
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      enabled: target.enabled,
      state: state.state,
      since: state.since,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveSuccesses: state.consecutiveSuccesses,
      lastResult: state.lastResult,
      stats: this.store.stats(target.id),
      intervalMs: target.intervalMs,
    };
  }

  getStatuses(): TargetStatus[] {
    return this.listTargets()
      .map((target) => this.getStatus(target.id))
      .filter((status): status is TargetStatus => status !== undefined);
  }

  /** True only once a target has confirmed as down (used by the fallback middleware). */
  isDown(id: string): boolean {
    return this.states.get(id)?.state === 'down';
  }

  history(id: string, limit?: number): HistoryRecord[] {
    return this.store.get(id, limit);
  }

  private async loop(id: string): Promise<void> {
    const target = this.targets.get(id);
    const state = this.states.get(id);
    if (!target || !state) return;

    try {
      await this.check(id);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }

    if (!this.running) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.loop(id);
    }, target.intervalMs);
  }

  private record(target: ResolvedTarget, state: InternalState, result: ProbeResult): void {
    const previous = state.state;
    state.lastResult = result;

    const { next, transitioned } = applyResult(state, result, target);
    state.state = next.state;
    state.since = next.since;
    state.consecutiveFailures = next.consecutiveFailures;
    state.consecutiveSuccesses = next.consecutiveSuccesses;

    const record = this.store.add(target.id, result);
    this.emit('check', { target, result, record } satisfies CheckEvent);

    if (!transitioned) return;

    const event: TransitionEvent = {
      target,
      from: previous,
      to: next.state,
      result,
      at: result.checkedAt,
    };
    this.emit(next.state === 'up' ? 'up' : 'down', event);
  }
}

export { HistoryStore };
export type { HistoryRecord, TargetStats };
