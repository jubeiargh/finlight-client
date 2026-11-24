import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FinlightClient } from '../../src/client';
import { DEFAULTS } from '../../src/config';
import { FinlightApiError, FinlightValidationError } from '../../src/errors';
import { waitFor } from '../helpers/fake-clock';
import { KIT_API_KEY, loadFixture } from '../helpers/kit';
import { StreamProbe } from '../helpers/session-runner';
import { WsMock } from '../helpers/ws-mock';

let ws: WsMock;
beforeEach(async () => {
  ws = await new WsMock().start();
});
afterEach(async () => {
  await ws.stop();
});

const ARTICLE = loadFixture('fixtures/decode/full-article.json').wire;
const RAW_ARTICLE = loadFixture('fixtures/decode/raw-skeleton.json').wire;
const admitted = {
  event: 'connection.admitted',
  payloadVersion: 3,
  data: { leaseId: 'l', serverNow: 1763932800123, clientNonce: 'c' },
};

describe('R-WS-4: liveness defaults', () => {
  test('ping every 25 s, watchdog 60 s, rotation after 115 min', () => {
    expect(DEFAULTS.pingIntervalMs).toBe(25_000);
    expect(DEFAULTS.watchdogTimeoutMs).toBe(60_000);
    expect(DEFAULTS.rotationIntervalMs).toBe(115 * 60_000);
  });

  test('the first application ping goes out after 25 s with an epoch-ms t', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: { query: 'q' } }).start();
    try {
      const dial = await ws.nextDial();
      await dial.conn!.next();
      await probe.advance(24_999);
      expect(dial.conn!.peek()).toBeUndefined();
      await probe.advance(1);
      expect(await dial.conn!.next()).toEqual({ action: 'ping', t: probe.clock.now() });
    } finally {
      await probe.stop();
    }
  });
});

describe('R-WS-2: dial refusals', () => {
  test('403 with an empty body: long wait plus an error hook, not terminal', async () => {
    ws.dialScript.push({ status: 403, body: '' });
    const probe = new StreamProbe(ws, { raw: false, params: { query: 'q' } }).start();
    try {
      await waitFor(() => probe.scheduled.length === 1, 'reconnect');
      expect(probe.scheduled[0].delayMs).toBeGreaterThanOrEqual(60_000);
      expect(probe.errors).toHaveLength(1);
      expect((probe.errors[0] as FinlightApiError).status).toBe(403);
      expect(probe.done).toBe(false);
    } finally {
      await probe.stop();
    }
  });

  test('429 on dial waits at least 60 s', async () => {
    ws.dialScript.push({ status: 429, body: '{"message":"Too Many Requests"}' });
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    try {
      await waitFor(() => probe.scheduled.length === 1, 'reconnect');
      expect(probe.scheduled[0].delayMs).toBeGreaterThanOrEqual(60_000);
      expect(probe.scheduled[0].reason).toBe('rate_limited');
    } finally {
      await probe.stop();
    }
  });

  test('close 1008 is terminal', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    const dial = await ws.nextDial();
    await dial.conn!.next();
    dial.conn!.ws.close(1008, 'policy');
    await waitFor(() => probe.done, 'terminal');
    expect((probe.terminal as FinlightApiError).status).toBe(1008);
    expect(probe.scheduled).toHaveLength(0);
    await probe.stop();
  });

  test('an unexpected close reconnects with backoff and re-sends the same subscribe', async () => {
    const probe = new StreamProbe(ws, {
      raw: false,
      params: { query: 'q', include: ['events'] },
      nonce: 'n',
    }).start();
    try {
      const first = await ws.nextDial();
      const sub = await first.conn!.next();
      first.conn!.ws.terminate();
      await waitFor(() => probe.scheduled.length === 1, 'reconnect');
      expect(probe.scheduled[0].reason).toBe('closed');
      await probe.advance(probe.scheduled[0].delayMs);
      const second = await ws.nextDial();
      expect(await second.conn!.next()).toEqual(sub);
      await waitFor(() => probe.reconnects.length === 1, 'reconnect signal');
      expect(probe.reconnects[0].lastSeenAt).toBeNull();
    } finally {
      await probe.stop();
    }
  });
});

describe('R-WS-3: dial headers', () => {
  test('the dial carries lowercase x-api-key, x-client-version and the User-Agent; no key in the URL', async () => {
    const probe = new StreamProbe(ws, { raw: true, params: {} }).start();
    try {
      const dial = await ws.nextDial();
      const raw = dial.rawHeaders;
      const names = raw.filter((_, i) => i % 2 === 0);
      expect(names).toContain('x-api-key');
      expect(names).toContain('x-client-version');
      expect(names).not.toContain('x-takeover');
      const { version } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
      expect(dial.headers['x-client-version']).toBe(version);
      expect(dial.headers['user-agent']).toBe(`finlight-client-typescript/${version}`);
      expect(dial.url).toBe('/raw');
    } finally {
      await probe.stop();
    }
  });

  test('a wssUrl with a trailing slash still reaches /raw', async () => {
    const client = new FinlightClient({ apiKey: KIT_API_KEY, wssUrl: `${ws.url}/` });
    const stream = client.rawStream();
    const it = stream[Symbol.asyncIterator]();
    void it.next().catch(() => undefined);
    const dial = await ws.nextDial();
    expect(dial.path).toBe('/raw');
    await stream.close();
  });
});

describe('R-WS-6: stream lifecycle', () => {
  test('raw: the reconnect signal carries the last firstSeenAt', async () => {
    const probe = new StreamProbe(ws, { raw: true, params: {} }).start();
    try {
      const first = await ws.nextDial();
      await first.conn!.next();
      first.conn!.send(admitted);
      first.conn!.send({ event: 'article.created', payloadVersion: 3, data: RAW_ARTICLE });
      await waitFor(() => probe.items.length === 1, 'item');
      first.conn!.ws.close(1001);
      await waitFor(() => probe.scheduled.length === 1, 'reconnect');
      await probe.advance(probe.scheduled[0].delayMs);
      await ws.nextDial();
      await waitFor(() => probe.reconnects.length === 1, 'reconnect signal');
      expect(probe.reconnects[0].lastSeenAt).toBe(RAW_ARTICLE.firstSeenAt);
    } finally {
      await probe.stop();
    }
  });

  test('enriched: lastSeenAt falls back from availableAt to firstSeenAt', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    try {
      const dial = await ws.nextDial();
      await dial.conn!.next();
      dial.conn!.send({
        event: 'article.created',
        payloadVersion: 3,
        data: { ...ARTICLE, availableAt: null },
      });
      await waitFor(() => probe.items.length === 1, 'item');
      expect(probe.stream.lastSeenAt).toBe(ARTICLE.firstSeenAt);
    } finally {
      await probe.stop();
    }
  });

  test('a throwing hook is logged; the stream continues', async () => {
    const errors: unknown[] = [];
    const client = new FinlightClient({
      apiKey: KIT_API_KEY,
      wssUrl: ws.url,
      logger: { error: (_m: string, e: unknown) => errors.push(e) },
    });
    const stream = client.stream(
      {},
      {
        onAdmitted: () => {
          throw new Error('user bug');
        },
      },
    );
    const items: unknown[] = [];
    const done = (async () => {
      for await (const item of stream) {
        items.push(item);
        if (items.length === 1) break;
      }
    })();
    const dial = await ws.nextDial();
    await dial.conn!.next();
    dial.conn!.send(admitted);
    dial.conn!.send({ event: 'article.created', payloadVersion: 3, data: ARTICLE });
    await done;
    expect(errors).toHaveLength(1);
    expect(items).toHaveLength(1);
    // Leaving the loop closed the socket with 1000.
    await waitFor(() => dial.conn!.closedCode !== null, 'socket closed');
    expect(dial.conn!.closedCode).toBe(1000);
    expect(stream.closed).toBe(true);
  });

  test('stop clears every timer and closes the socket', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    const dial = await ws.nextDial();
    await dial.conn!.next();
    expect(probe.clock.pending()).toBeGreaterThan(0);
    await probe.stop();
    expect(probe.clock.pending()).toBe(0);
    await waitFor(() => dial.conn!.closedCode === 1000, 'closed with 1000');
    expect(probe.done).toBe(true);
    expect(probe.terminal).toBeUndefined();
  });

  test('aborting ends the iteration with the abort reason and closes everything', async () => {
    const controller = new AbortController();
    const client = new FinlightClient({ apiKey: KIT_API_KEY, wssUrl: ws.url });
    const stream = client.stream({}, { signal: controller.signal });
    const result = (async () => {
      for await (const _ of stream) {
        // nothing arrives
      }
    })().catch((e) => e);
    const dial = await ws.nextDial();
    await dial.conn!.next();
    const reason = new Error('stop now');
    controller.abort(reason);
    expect(await result).toBe(reason);
    await waitFor(() => dial.conn!.closedCode !== null, 'socket closed');
  });

  test('a stream can be iterated once; several streams run on one client', async () => {
    const client = new FinlightClient({ apiKey: KIT_API_KEY, wssUrl: ws.url });
    const a = client.stream({ query: 'a' });
    const b = client.rawStream({ query: 'b' });
    const ia = a[Symbol.asyncIterator]();
    const ib = b[Symbol.asyncIterator]();
    void ia.next().catch(() => undefined);
    void ib.next().catch(() => undefined);
    expect(() => a[Symbol.asyncIterator]()).toThrow(FinlightValidationError);
    await ws.nextDial();
    await ws.nextDial();
    expect(ws.openConnections()).toBe(2);
    await Promise.all([a.close(), b.close()]);
    await waitFor(() => ws.openConnections() === 0, 'closed');
  });

  test('a v2 article frame is never delivered; an unknown frame is skipped', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    try {
      const dial = await ws.nextDial();
      await dial.conn!.next();
      dial.conn!.send({ action: 'sendArticle', data: { link: 'x', title: 't', source: 'd' } });
      dial.conn!.send({ hello: 'world' });
      dial.conn!.send('not json');
      dial.conn!.send({ event: 'article.created', payloadVersion: 3, data: ARTICLE });
      await waitFor(() => probe.items.length === 1, 'item');
      expect(probe.items[0].article?.id).toBe(ARTICLE.id);
      expect(probe.errors).toHaveLength(0);
    } finally {
      await probe.stop();
    }
  });

  test('a broken article frame is reported and skipped; the stream goes on', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    try {
      const dial = await ws.nextDial();
      await dial.conn!.next();
      dial.conn!.send({ event: 'article.created', payloadVersion: 3, data: { ...ARTICLE, id: 5 } });
      dial.conn!.send({ event: 'article.created', payloadVersion: 3, data: ARTICLE });
      await waitFor(() => probe.items.length === 1, 'item');
      expect(probe.errors.map((e) => e.kind)).toEqual(['decode']);
    } finally {
      await probe.stop();
    }
  });
});

describe('connect failures', () => {
  test('a refused TCP connection reconnects with backoff and reports a network error', async () => {
    const server: Server = createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((r) => server.close(() => r()));
    const probe = new StreamProbe({ url: `ws://127.0.0.1:${port}`, autoPong: false } as WsMock, {
      raw: false,
      params: {},
    }).start();
    try {
      await waitFor(() => probe.scheduled.length === 1, 'reconnect');
      expect(probe.scheduled[0].reason).toBe('dial_failed');
      expect(probe.errors[0].kind).toBe('network');
    } finally {
      await probe.stop();
    }
  });
});

describe('R-WS-2: exhausted quota (owner decision 2026-11-24)', () => {
  const QUOTA = { status: 403, body: '{"message":"WebSocket quota exceeded for the current period"}' };

  test('retries every hour, warns and reports each attempt, and resumes when the quota allows', async () => {
    ws.dialScript.push(QUOTA, QUOTA);
    const warnings: string[] = [];
    const probe = new StreamProbe(ws, {
      raw: false,
      params: { query: 'q' },
      config: { logger: { warn: (m: string) => warnings.push(m) } },
    }).start();
    try {
      await ws.nextDial();
      await waitFor(() => probe.scheduled.length === 1, 'first quota wait');
      expect(probe.scheduled[0]).toEqual({ delayMs: 3_600_000, reason: 'quota_exceeded' });
      await probe.advance(3_599_999);
      expect(ws.dialCount).toBe(1);
      await probe.advance(1);
      await ws.nextDial();
      await waitFor(() => probe.scheduled.length === 2, 'second quota wait');
      expect(probe.scheduled[1].delayMs).toBe(3_600_000);
      expect(probe.quotaWaits.map((q) => q.attempt)).toEqual([1, 2]);
      expect(probe.quotaWaits.every((q) => q.kind === 'api')).toBe(true);
      expect(warnings.filter((w) => /quota exhausted/.test(w))).toHaveLength(2);
      await probe.advance(3_600_000);
      const ok = await ws.nextDial();
      await ok.conn!.next();
      ok.conn!.send({
        event: 'connection.admitted',
        payloadVersion: 3,
        data: { leaseId: 'l', serverNow: 1, clientNonce: 'c' },
      });
      await waitFor(() => probe.admitted.length === 1, 'admitted');
      expect(probe.done).toBe(false);
      expect(probe.reconnects.at(-1)?.reason).toBe('quota_exceeded');
    } finally {
      await probe.stop();
    }
  });

  test('the interval is configurable', async () => {
    ws.dialScript.push(QUOTA);
    const probe = new StreamProbe(ws, {
      raw: false,
      params: {},
      config: { quotaRetryIntervalMs: 120_000 },
    }).start();
    try {
      await waitFor(() => probe.scheduled.length === 1, 'quota wait');
      expect(probe.scheduled[0].delayMs).toBe(120_000);
      expect(probe.quotaWaits[0].nextAttemptInMs).toBe(120_000);
    } finally {
      await probe.stop();
    }
  });

  test('switched off, the stream ends with the typed error', async () => {
    ws.dialScript.push(QUOTA);
    const probe = new StreamProbe(ws, {
      raw: false,
      params: {},
      config: { reconnectOnQuotaExhausted: false },
    }).start();
    await waitFor(() => probe.done, 'terminal');
    expect((probe.terminal as FinlightApiError).status).toBe(403);
    expect(probe.scheduled).toHaveLength(0);
    expect(probe.quotaWaits).toHaveLength(0);
    await probe.stop();
  });

  test('a connection_limit preemption stays terminal', async () => {
    const probe = new StreamProbe(ws, { raw: false, params: {} }).start();
    const dial = await ws.nextDial();
    await dial.conn!.next();
    dial.conn!.send({
      event: 'connection.preempted',
      payloadVersion: 3,
      data: { reason: 'connection_limit', newLeaseId: 'x', timestamp: 1 },
    });
    await waitFor(() => probe.done, 'terminal');
    expect((probe.terminal as Error).name).toBe('PreemptedError');
    expect(probe.scheduled).toHaveLength(0);
    await probe.stop();
  });
});
