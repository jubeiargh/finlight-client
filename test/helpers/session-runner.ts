import { FinlightClient } from '../../src/client';
import type { FinlightConfig } from '../../src/config';
import {
  FinlightApiError,
  ForbiddenError,
  InternalServerError,
  PreemptedError,
  RateLimitedError,
  UnauthorizedError,
  ValidationFailedError,
  type FinlightError,
} from '../../src/errors';
import type { StreamEvent } from '../../src/models';
import {
  setStreamTestHooks,
  type AdmittedInfo,
  type FinlightStream,
  type QuotaWaitInfo,
  type ReconnectInfo,
} from '../../src/stream';
import { FakeClock, flushIo, waitFor } from './fake-clock';
import { KIT_API_KEY } from './kit';
import type { ServerConn, WsMock } from './ws-mock';

/** Everything a session test can observe. */
export class StreamProbe {
  readonly items: StreamEvent[] = [];
  readonly admitted: AdmittedInfo[] = [];
  readonly reconnects: ReconnectInfo[] = [];
  readonly errors: FinlightError[] = [];
  readonly scheduled: Array<{ delayMs: number; reason: string }> = [];
  readonly duplicates: string[] = [];
  readonly quotaWaits: QuotaWaitInfo[] = [];
  frames = 0;
  pongs = 0;
  pingsSent = 0;
  terminal: unknown = undefined;
  done = false;
  readonly clock = new FakeClock();
  stream!: FinlightStream;
  client!: FinlightClient;
  private pump: Promise<void> | null = null;

  constructor(
    private readonly ws: WsMock,
    private readonly opts: {
      raw: boolean;
      params: Record<string, unknown>;
      apiKey?: string;
      nonce?: string;
      config?: Partial<FinlightConfig>;
      takeover?: boolean;
    },
  ) {}

  start(): this {
    this.client = new FinlightClient({
      apiKey: this.opts.apiKey ?? KIT_API_KEY,
      wssUrl: this.ws.url,
      baseUrl: 'http://127.0.0.1:9',
      clock: this.clock,
      ...(this.opts.config ?? {}),
    });
    const options = {
      onAdmitted: (a: AdmittedInfo) => this.admitted.push(a),
      onReconnect: (r: ReconnectInfo) => this.reconnects.push(r),
      onError: (e: FinlightError) => this.errors.push(e),
      onQuotaWait: (q: QuotaWaitInfo) => this.quotaWaits.push(q),
      ...(this.opts.takeover ? { takeover: true } : {}),
    };
    this.stream = this.opts.raw
      ? this.client.rawStream(this.opts.params, options)
      : this.client.stream(this.opts.params, options);
    const nonce = this.opts.nonce;
    setStreamTestHooks(this.stream, {
      ...(nonce ? { nonce: () => nonce } : {}),
      onFrame: () => (this.frames += 1),
      onPong: () => (this.pongs += 1),
      onPingSent: () => (this.pingsSent += 1),
      onDuplicate: (id) => this.duplicates.push(id),
      onReconnectScheduled: (info) => this.scheduled.push(info),
    });
    this.pump = (async () => {
      try {
        for await (const item of this.stream) this.items.push(item);
      } catch (err) {
        this.terminal = err;
      } finally {
        this.done = true;
      }
    })();
    return this;
  }

  /** Advances the fake clock; with auto-pong on, waits for each pong before the next timer. */
  async advance(ms: number): Promise<void> {
    await this.clock.advance(ms, async () => {
      if (this.ws.autoPong) await waitFor(() => this.pongs >= this.pingsSent, 'pong for every ping');
    });
  }

  async stop(): Promise<void> {
    await this.stream.close();
    await this.pump;
  }
}

function isSubscribe(frame: unknown): frame is Record<string, unknown> {
  return (
    typeof frame === 'object' &&
    frame !== null &&
    'payloadVersion' in frame &&
    !('type' in frame) &&
    !('action' in frame)
  );
}

function withoutKeys(frame: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...frame };
  for (const k of keys) delete out[k];
  return out;
}

/** Maps the kit's clientConfig (base words) onto this SDK's config keys. */
function clientConfigFrom(input: Record<string, unknown> | undefined): Partial<FinlightConfig> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    // Durations are base words without unit; TS takes milliseconds with an Ms suffix.
    out[typeof value === 'number' && !/Threshold|Size|Pages|Retries/.test(key) ? `${key}Ms` : key] = value;
  }
  return out as Partial<FinlightConfig>;
}

const SUBCLASS: Record<string, unknown> = {
  validation_failed: ValidationFailedError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  rate_limited: RateLimitedError,
  internal_error: InternalServerError,
};

function checkApiError(err: any, step: any): void {
  expect(err).toBeInstanceOf(FinlightApiError);
  expect(err.kind).toBe('api');
  if (step.apiKind) {
    expect(err.apiKind).toBe(step.apiKind);
    if (SUBCLASS[step.apiKind]) expect(err).toBeInstanceOf(SUBCLASS[step.apiKind] as any);
  }
  if (step.status !== undefined) expect(err.status).toBe(step.status);
  if (step.code !== undefined) expect(err.code).toBe(step.code);
}

function checkReported(probe: StreamProbe, index: number, r: any): void {
  expect(r.hook).toBe('onQuotaWait');
  const info = probe.quotaWaits[index];
  expect(info).toBeDefined();
  if (r.attempt !== undefined) expect(info.attempt).toBe(r.attempt);
  if (r.error === 'PreemptedError') {
    expect(info.error).toBeInstanceOf(PreemptedError);
    expect((info.error as PreemptedError).reason).toBe(r.reason);
    expect((info.error as PreemptedError).newLeaseId).toBe(r.newLeaseId);
  } else {
    checkApiError(info.error, r);
  }
  // A quota wait goes to onQuotaWait only, not to onError.
  expect(probe.errors.some((e) => e === info.error)).toBe(false);
}

export interface SessionOptions {
  /** Keys the fixture's subscribe carries that the SDK refuses to send. */
  forbiddenKeys?: string[];
  autoPong?: boolean;
  /** Client config overrides for this session. */
  config?: Partial<FinlightConfig>;
  /** Extra checks after the scripted steps. */
  after?: (ctx: SessionContext) => Promise<void>;
  /** Extra checks right after the first admitted item expectation. */
}

export interface SessionContext {
  probe: StreamProbe;
  ws: WsMock;
  subscribe: Record<string, unknown>;
  conn: () => ServerConn | null;
}

/** Plays a ws-sessions fixture against the SDK and checks every `expect` step. */
export async function runSession(ws: WsMock, fixture: any, options: SessionOptions = {}): Promise<void> {
  const steps: any[] = fixture.steps;
  const raw = fixture.endpoint === 'raw';
  const forbidden = options.forbiddenKeys ?? [];
  ws.autoPong = options.autoPong ?? true;

  const firstSubscribe = steps.find((s) => s.step === 'clientSends' && isSubscribe(s.frame))?.frame ?? {
    payloadVersion: 3,
    query: 'ticker:XMPL',
  };
  const subscribe = withoutKeys(firstSubscribe, forbidden);
  const params = withoutKeys(subscribe, ['payloadVersion', 'clientNonce']);
  for (const step of steps) {
    if (step.step === 'dial') ws.dialScript.push(step.server.status === 101 ? { status: 101 } : step.server);
  }
  const firstDial = steps.find((s) => s.step === 'dial');
  const apiKey = firstDial?.expectRequestHeaders?.['x-api-key'] ?? KIT_API_KEY;

  const probe = new StreamProbe(ws, {
    raw,
    params,
    apiKey,
    nonce: (firstSubscribe.clientNonce as string | undefined) ?? 'c-test',
    config: { ...clientConfigFrom(fixture.clientConfig), ...(options.config ?? {}) },
  }).start();

  let conn: ServerConn | null = null;
  let subscribedOn: ServerConn | null = null;
  let checked: Checked = {
    admitted: 0,
    items: 0,
    pongs: 0,
    scheduled: 0,
    errors: 0,
    duplicates: 0,
    quota: 0,
  };
  const ctx: SessionContext = { probe, ws, subscribe, conn: () => conn };

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      switch (step.step) {
        case 'dial': {
          const dial = await ws.nextDial(`dial (step ${i})`);
          expect(dial.path).toBe(raw ? '/raw' : '/');
          expect(dial.url).not.toMatch(/apiKey=/i);
          const key = step.expectRequestHeaders?.['x-api-key'];
          if (key !== undefined) expect(dial.headers['x-api-key']).toBe(key);
          conn = dial.conn;
          break;
        }
        case 'clientSends': {
          const frame = step.frame;
          if (step.match) {
            const msg = (await conn!.next(`client frame matching ${JSON.stringify(step.match)}`)) as any;
            expect(msg).toMatchObject(step.match);
            if (step.match.action === 'ping') expect(typeof msg.t).toBe('number');
            break;
          }
          if (typeof frame === 'string') break; // a broken frame no SDK sends
          if (frame?.action === 'ping') {
            // A ping may or may not precede the subscribe; take it only if it is there.
            const head = conn!.peek() as any;
            if (head?.action === 'ping') conn!.skip();
            break;
          }
          if (!isSubscribe(frame)) break; // e.g. a malformed ping on $default
          if (subscribedOn === conn) break; // the SDK subscribes once per connection
          const msg = (await conn!.next('subscribe frame')) as Record<string, unknown>;
          expect(msg).toEqual(withoutKeys(frame, forbidden));
          expect(typeof msg.payloadVersion).toBe('number');
          expect(msg.payloadVersion).toBe(3);
          for (const key of forbidden) expect(key in msg).toBe(false);
          subscribedOn = conn;
          break;
        }
        case 'serverSends': {
          const before = probe.frames;
          conn!.send(step.frame);
          await waitFor(
            () => probe.frames > before || probe.done,
            `client to process ${JSON.stringify(step.frame).slice(0, 80)}`,
          );
          break;
        }
        case 'serverCloses':
          if (conn?.open) conn.ws.close(1000);
          await flushIo();
          break;
        case 'advance':
          await probe.advance(step.ms);
          break;
        case 'expect':
          checked = await checkExpect(step, probe, ws, ctx, checked, steps[i + 1]);
          break;
        default:
          throw new Error(`unknown step ${step.step}`);
      }
    }
    if (options.after) await options.after(ctx);
  } finally {
    await probe.stop();
  }
  // Stopping closes every socket and clears every timer.
  expect(probe.clock.pending()).toBe(0);
  await waitFor(() => ws.openConnections() === 0, 'all sockets closed');
}

interface Checked {
  admitted: number;
  items: number;
  pongs: number;
  scheduled: number;
  errors: number;
  duplicates: number;
  quota: number;
  pendingRedial?: boolean;
}

async function checkExpect(
  step: any,
  probe: StreamProbe,
  ws: WsMock,
  ctx: SessionContext,
  checked: Checked,
  nextStep: any,
): Promise<Checked> {
  const c: Checked = { ...checked };
  switch (step.outcome) {
    case 'admitted': {
      await waitFor(() => probe.admitted.length > c.admitted, 'admitted');
      const a = probe.admitted[c.admitted++];
      if (step.leaseId) expect(a.leaseId).toBe(step.leaseId);
      if (step.clientNonce) expect(a.clientNonce).toBe(step.clientNonce);
      break;
    }
    case 'noAdmitted':
      await flushIo();
      expect(probe.admitted.length).toBe(c.admitted);
      expect(probe.terminal).toBeUndefined();
      break;
    case 'item': {
      await waitFor(() => probe.items.slice(c.items).some((i) => i.kind !== 'other'), 'item');
      while (probe.items[c.items].kind === 'other') c.items++;
      const item = probe.items[c.items++];
      expect(item.kind).toBe(step.kind);
      if (step.id) expect(item.data?.id).toBe(step.id);
      break;
    }
    case 'duplicateDropped':
      await waitFor(() => probe.duplicates.length > c.duplicates, 'duplicate dropped');
      expect(probe.duplicates[c.duplicates++]).toBe(step.id ?? probe.duplicates[c.duplicates - 1]);
      expect(probe.items.filter((i) => i.kind !== 'other').length).toBeLessThanOrEqual(probe.items.length);
      break;
    case 'liveness':
      await waitFor(() => probe.pongs > c.pongs, 'pong refreshing the watchdog');
      c.pongs = probe.pongs;
      expect(probe.terminal).toBeUndefined();
      expect(probe.scheduled.length).toBe(c.scheduled);
      break;
    case 'logOnly': {
      await waitFor(
        () => probe.errors.length > c.errors || probe.items.slice(c.items).some((i) => i.kind === 'other'),
        'a reported error or an "other" item',
      );
      if (step.code) {
        expect(probe.errors.slice(c.errors).map((e) => (e as FinlightApiError).code)).toContain(step.code);
      }
      c.errors = probe.errors.length;
      while (c.items < probe.items.length && probe.items[c.items].kind === 'other') c.items++;
      await flushIo();
      expect(probe.terminal).toBeUndefined();
      expect(probe.done).toBe(false);
      expect(probe.scheduled.length).toBe(c.scheduled);
      expect(ctx.conn()?.open).toBe(true);
      break;
    }
    case 'terminalError': {
      await waitFor(() => probe.done, 'terminal error');
      const err = probe.terminal as any;
      expect(err).toBeDefined();
      if (step.error === 'PreemptedError') {
        expect(err).toBeInstanceOf(PreemptedError);
        expect(err.kind).toBe('preempted');
        expect(err.reason).toBe(step.reason);
        expect(err.newLeaseId).toBe(step.newLeaseId);
      } else if (step.error === 'FinlightApiError') {
        checkApiError(err, step);
        if (step.apiKind === 'validation_failed') {
          expect(err.errors.length).toBeGreaterThan(0);
          expect(typeof err.errors[0].field).toBe('string');
          expect(err.errors[0].constraints).toBeDefined();
        }
      } else {
        throw new Error(`unknown terminal error ${step.error}`);
      }
      expect(probe.scheduled.length).toBe(c.scheduled);
      break;
    }
    case 'reported': {
      await waitFor(() => probe.quotaWaits.length > c.quota, 'a report to onQuotaWait');
      checkReported(probe, c.quota++, step);
      // The quota wait is scheduled together with the report.
      await waitFor(() => probe.scheduled.length > c.scheduled, 'the scheduled quota redial');
      expect(probe.scheduled[c.scheduled].reason).toBe('quota_exceeded');
      expect(probe.done).toBe(false);
      c.scheduled++;
      c.pendingRedial = true;
      break;
    }
    case 'noReconnect': {
      const dials = ws.dialCount;
      await probe.advance(0);
      await new Promise((r) => setTimeout(r, 30));
      expect(probe.scheduled.length).toBe(c.scheduled);
      expect(ws.dialCount).toBe(dials);
      break;
    }
    case 'reconnect': {
      if (c.pendingRedial) {
        // Already scheduled with a report; the script advanced the clock.
        c.pendingRedial = false;
        const last = probe.scheduled[c.scheduled - 1];
        if (step.reason) expect(last.reason).toBe(step.reason);
        if (nextStep?.step !== 'dial') {
          const dial = await ws.nextDial('redial after the quota wait');
          if (step.resubscribe) {
            const msg = await dial.conn!.next('re-subscribe');
            expect(withoutKeys(msg as Record<string, unknown>, ['clientNonce'])).toEqual(
              withoutKeys(ctx.subscribe, ['clientNonce']),
            );
          }
        }
        break;
      }
      await waitFor(() => probe.scheduled.length > c.scheduled, 'a scheduled reconnect');
      const s = probe.scheduled[c.scheduled++];
      if (step.reported) {
        await waitFor(() => probe.quotaWaits.length > c.quota, 'a report to onQuotaWait');
        checkReported(probe, c.quota++, step.reported);
      }
      if (step.backoff === 'quota') expect(s.reason).toBe('quota_exceeded');
      expect(probe.done).toBe(false);
      if (step.backoff === 'long') expect(s.delayMs).toBeGreaterThanOrEqual(60_000);
      if (step.firstRetryMinMs) expect(s.delayMs).toBeGreaterThanOrEqual(step.firstRetryMinMs);
      if (step.exactDelayMs) expect(s.delayMs).toBe(step.exactDelayMs);
      if (step.backoff === true) expect(s.delayMs).toBeGreaterThan(0);
      if (step.reason) expect(s.reason).toBe(step.reason);
      if (step.hint === 'takeover') {
        expect(
          probe.errors.some((e) => /takeover/.test(e.message + ((e as FinlightApiError).detail ?? ''))),
        ).toBe(true);
      }
      const dialsBefore = ws.dialCount;
      if (s.delayMs > 0) {
        await probe.advance(s.delayMs - 1);
        expect(ws.dialCount).toBe(dialsBefore);
        await probe.advance(1);
      }
      if (nextStep?.step !== 'dial') {
        const dial = await ws.nextDial('redial');
        if (step.resubscribe) {
          const msg = await dial.conn!.next('re-subscribe');
          // Only clientNonce may differ between connections.
          expect(withoutKeys(msg as Record<string, unknown>, ['clientNonce'])).toEqual(
            withoutKeys(ctx.subscribe, ['clientNonce']),
          );
        }
      }
      break;
    }
    default:
      throw new Error(`unknown outcome ${step.outcome}`);
  }
  return c;
}
