import type { Clock } from '../../src/clock';

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

export function flushIo(times = 3): Promise<void> {
  return new Promise((resolve) => {
    let n = 0;
    const step = (): void => {
      n += 1;
      if (n >= times) resolve();
      else setImmediate(step);
    };
    setImmediate(step);
  });
}

/** Manual clock: time moves only through advance(). No real waiting. */
export class FakeClock implements Clock {
  private t: number;
  private seq = 0;
  private timers: Timer[] = [];
  readonly scheduled: number[] = [];

  constructor(start = Date.parse('2026-11-23T21:04:05.123Z')) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.scheduled.push(ms);
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  pending(): number {
    return this.timers.length;
  }

  /** Runs every timer due within `ms`, in order, letting I/O settle after each one. */
  async advance(ms: number, afterEach?: () => Promise<void>): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await flushIo();
      if (afterEach) await afterEach();
    }
    this.t = target;
    await flushIo();
  }
}

/**
 * Clock whose sleeps finish at once (virtual time jumps forward). Records every delay.
 */
export class InstantClock implements Clock {
  private t = Date.parse('2026-11-23T21:04:05.123Z');
  readonly sleeps: number[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    this.sleeps.push(ms);
    return setImmediate(() => {
      this.t += ms;
      fn();
    });
  }

  clearTimeout(handle: unknown): void {
    clearImmediate(handle as NodeJS.Immediate);
  }
}

export async function waitFor(cond: () => boolean, what = 'condition', timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
