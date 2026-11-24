import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { FinlightClient } from '../../src/client';
import { FinlightApiError } from '../../src/errors';
import { rawJson } from '../../src/internal/raw';
import { waitFor } from '../helpers/fake-clock';
import { caseName, KIT_API_KEY, loadFixture } from '../helpers/kit';
import { runSession, StreamProbe } from '../helpers/session-runner';
import { WsMock } from '../helpers/ws-mock';

let ws: WsMock;

beforeEach(async () => {
  ws = await new WsMock().start();
});
afterEach(async () => {
  await ws.stop();
});

const session = (file: string) => loadFixture(`ws-sessions/${file}`);

describe('R: WebSocket subscribe frames', () => {
  for (const [id, file, raw] of [
    ['R-13', 'ws-subscribe-enriched.json', false],
    ['R-14', 'ws-subscribe-raw.json', true],
  ] as const) {
    test(caseName(id), async () => {
      const f = loadFixture(`fixtures/requests/${file}`);
      const probe = new StreamProbe(ws, { raw, params: f.sdk.args, nonce: f.frame.clientNonce }).start();
      try {
        const dial = await ws.nextDial();
        expect(dial.path).toBe(raw ? '/raw' : '/');
        const frame = (await dial.conn!.next()) as Record<string, unknown>;
        expect(frame).toEqual(f.frame);
        expect(frame.payloadVersion).toBe(3);
        expect('action' in frame).toBe(false);
        if (raw) expect('include' in frame).toBe(false);
        for (const k of ['includeContent', 'includeEntities', 'extended']) expect(k in frame).toBe(false);
        for (const server of f.server.frames) dial.conn!.send(server);
        await waitFor(() => probe.frames >= f.server.frames.length, 'server frames');
        expect(probe.admitted).toHaveLength(1);
        expect(probe.admitted[0].clientNonce).toBe(f.frame.clientNonce);
        expect(probe.items).toHaveLength(raw ? 0 : 1);
        if (!raw) expect(probe.items[0].kind).toBe('created');
        expect(probe.errors).toHaveLength(0);
      } finally {
        await probe.stop();
      }
    });
  }
});

describe('S: WebSocket sessions', () => {
  test(caseName('S-01'), () => runSession(ws, session('v2-pong-before-subscribe.json')));

  test(caseName('S-02'), async () => {
    // A plain TCP listener: the raw bytes of the dial request, before any header parsing.
    const chunks: Buffer[] = [];
    const server: Server = createServer((socket) => {
      socket.on('data', (c) => {
        chunks.push(c);
        if (Buffer.concat(chunks).includes('\r\n\r\n')) socket.destroy();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const client = new FinlightClient({ apiKey: KIT_API_KEY, wssUrl: `ws://127.0.0.1:${port}/` });
    const stream = client.stream({ query: 'ticker:XMPL' }, { takeover: true });
    const iterator = stream[Symbol.asyncIterator]();
    void iterator.next().catch(() => undefined);
    try {
      await waitFor(() => Buffer.concat(chunks).includes('\r\n\r\n'), 'dial request bytes');
      const head = Buffer.concat(chunks).toString('latin1');
      const [requestLine, ...headerLines] = head.split('\r\n');
      expect(requestLine).not.toMatch(/apiKey=/i);
      expect(requestLine).toMatch(/^GET \/ HTTP\/1\.1$/);
      expect(headerLines).toContain(`x-api-key: ${KIT_API_KEY}`);
      expect(headerLines.some((l) => l.startsWith('x-client-version: '))).toBe(true);
      expect(headerLines).toContain('x-takeover: true');
      expect(headerLines.some((l) => /^User-Agent: finlight-client-typescript\/\d+\.\d+\.\d+/.test(l))).toBe(
        true,
      );
      expect(headerLines.some((l) => /^X-API-KEY:|^X-Api-Key:/.test(l))).toBe(false);
    } finally {
      await stream.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test(caseName('S-03'), () => runSession(ws, session('admitted-nonce.json')));
  test(caseName('S-04'), () => runSession(ws, session('created-then-updated.json')));
  test(caseName('S-05'), () =>
    runSession(ws, session('unknown-event.json'), {
      after: async ({ probe }) => {
        const other = probe.items.find((i) => i.kind === 'other');
        expect(other?.event).toBe('connection.draining');
        expect(other?.data).toBeNull();
        expect((rawJson(other!) as any).data.inMs).toBe(30000);
      },
    }),
  );
  test(caseName('S-06'), () => runSession(ws, session('ping-on-default-route.json')));
  test(caseName('S-07'), () =>
    runSession(ws, session('validation-failed-forbidden-key.json'), { forbiddenKeys: ['includeContent'] }),
  );
  test(caseName('S-08'), async () => {
    const fixture = session('raw-include-rejected.json');
    // Locally: include on rawStream throws before any dial.
    const client = new FinlightClient({ apiKey: KIT_API_KEY, wssUrl: ws.url });
    expect(() => client.rawStream({ include: ['content'] } as any)).toThrow(/include/);
    expect(ws.dialCount).toBe(0);
    // And if the server rejects anyway, the stream ends with the terminal validation error.
    await runSession(ws, fixture, { forbiddenKeys: ['include'] });
  });
  test(caseName('S-09'), () => runSession(ws, session('preempted-connection-limit.json')));
  test(caseName('S-10'), () => runSession(ws, session('preempted-quota-exceeded.json')));
  test(caseName('S-11'), () => runSession(ws, session('v2-preempt-before-subscribe.json')));
  test(caseName('S-12'), () =>
    runSession(ws, session('v2-invalid-json-error.json'), {
      after: async ({ probe }) => {
        expect(probe.errors).toHaveLength(1);
        expect((probe.errors[0] as FinlightApiError).detail).toBe('Message processing failed');
      },
    }),
  );
  test(caseName('S-13'), () => runSession(ws, session('handshake-failed.json')));
  test(caseName('S-14'), () =>
    runSession(ws, session('search-failed.json'), {
      after: async ({ probe }) => {
        const searchFailed = {
          event: 'connection.error',
          payloadVersion: 3,
          data: { code: 'SEARCH_FAILED', message: 'Search temporarily unavailable' },
        };
        // Failures 2 to 5 in a row: only the 5th is surfaced, the stream keeps reconnecting.
        for (let n = 2; n <= 5; n++) {
          const conn = ws.dials[ws.dials.length - 1].conn!;
          expect(probe.errors.filter((e) => (e as FinlightApiError).code === 'SEARCH_FAILED')).toHaveLength(
            0,
          );
          const scheduled = probe.scheduled.length;
          conn.send(searchFailed);
          await waitFor(() => probe.scheduled.length > scheduled, 'reconnect');
          await probe.advance(probe.scheduled[probe.scheduled.length - 1].delayMs);
          await ws.nextDial();
        }
        expect(probe.errors.filter((e) => (e as FinlightApiError).code === 'SEARCH_FAILED')).toHaveLength(1);
        expect(probe.done).toBe(false);
      },
    }),
  );
  test(caseName('S-15'), () => runSession(ws, session('internal-error.json')));
  test(caseName('S-16'), () => runSession(ws, session('pong-watchdog.json'), { autoPong: false }));
  test(caseName('S-17'), () =>
    runSession(ws, session('raw-stream.json'), {
      after: async ({ probe }) => {
        const article = probe.items[0].data!;
        for (const k of ['content', 'sentiment', 'companies', 'events']) expect(k in article).toBe(false);
        expect(article.availableAt).toBeNull();
        expect(probe.stream.lastSeenAt).toBe(article.firstSeenAt);
      },
    }),
  );
  test(caseName('S-18'), async () => {
    const fixture = session('rotation.json');
    const pushed = loadFixture('ws-sessions/admitted-nonce.json').steps[3].frame;
    // Deliver the initial push once before the rotation.
    const steps = [...fixture.steps];
    steps.splice(
      3,
      0,
      { step: 'serverSends', frame: pushed },
      { step: 'expect', outcome: 'item', kind: 'created' },
    );
    await runSession(
      ws,
      { ...fixture, steps },
      {
        after: async ({ probe }) => {
          const [first, second] = ws.dials;
          expect(first.conn!.open).toBe(true);
          const admitted = { ...steps[2].frame };
          second.conn!.send(admitted);
          second.conn!.send(pushed); // replayed initial push on the new connection
          await waitFor(() => probe.duplicates.length === 1, 'replayed push dropped');
          await waitFor(() => first.conn!.closedCode !== null, 'old connection closed');
          expect(first.conn!.closedCode).toBe(1000);
          expect(probe.items.filter((i) => i.kind === 'created')).toHaveLength(1);
          expect(probe.reconnects).toHaveLength(1);
          expect(probe.reconnects[0].reason).toBe('rotation');
          expect(probe.reconnects[0].lastSeenAt).toBe(pushed.data.availableAt);
        },
      },
    );
  });
  test(caseName('S-19'), () => runSession(ws, session('dial-missing-key.json')));
  test(caseName('S-20'), () => runSession(ws, session('dial-invalid-key.json')));
  test(caseName('S-21'), () => runSession(ws, session('dial-malformed-key.json')));
  test(caseName('S-22'), () => runSession(ws, session('dial-no-websockets.json')));
  test(caseName('S-23'), () => runSession(ws, session('dial-too-many-connections.json')));
  test(caseName('S-24'), () => runSession(ws, session('dial-quota-exceeded.json')));
  test(caseName('S-25'), () => runSession(ws, session('dial-admit-race.json')));
  test(caseName('S-26'), () => runSession(ws, session('dial-server-error.json')));
  test(caseName('S-27'), () => runSession(ws, session('preempted-quota-exceeded-no-reconnect.json')));
  test(caseName('S-28'), () => runSession(ws, session('dial-quota-exceeded-no-reconnect.json')));
  test(caseName('S-29'), () => {
    const fixture = session('validation-failed-source-type.json');
    const sent = fixture.steps.find(
      (s: any) => s.step === 'serverSends' && s.frame.event === 'connection.error',
    );
    const detail = sent.frame.data.details[0];
    // Values are not checked locally (SourceType stays open): the server rejects it, the stream ends.
    return runSession(ws, fixture, {
      after: async ({ probe }) => {
        const err = probe.terminal as FinlightApiError;
        expect(err.errors).toHaveLength(1);
        expect(err.errors[0].field).toBe('sourceTypes');
        expect(err.errors[0].allowedValues).toEqual(detail.allowedValues);
        expect(err.errors[0].constraints).toEqual(detail.constraints);
        expect(ws.dialCount).toBe(1);
      },
    });
  });
});
