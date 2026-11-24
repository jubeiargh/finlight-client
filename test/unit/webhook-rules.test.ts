import { createHmac } from 'node:crypto';
import { FinlightDecodeError, WebhookVerificationError } from '../../src/errors';
import { rawJson } from '../../src/internal/raw';
import type { WebhookEvent } from '../../src/models';
import { isWrongPayloadVersion, Webhooks, WrongPayloadVersion } from '../../src/webhooks';
import { loadFixture } from '../helpers/kit';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TS = '2026-11-23T21:04:05.123Z';
const NOW = { now: () => Date.parse(TS) };
const ENVELOPE = JSON.parse(loadFixture('fixtures/webhook/created-enriched.json').request.rawBody);

function sign(body: string | Buffer, ts = TS, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex')}`;
}

function headersFor(body: string, ts = TS): Record<string, string> {
  return { 'X-Webhook-Signature': sign(body, ts), 'X-Webhook-Timestamp': ts };
}

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WebhookVerificationError);
    return (err as WebhookVerificationError).reason;
  }
  return undefined;
}

describe('R-HOOK-1: verification', () => {
  test('accepts Fetch Headers, IncomingHttpHeaders, a Map, entries and the CGI form', () => {
    const body = JSON.stringify(ENVELOPE);
    const sig = sign(body);
    const forms: unknown[] = [
      new Headers({ 'x-webhook-signature': sig, 'x-webhook-timestamp': TS }),
      { 'x-webhook-signature': sig, 'x-webhook-timestamp': TS, 'content-type': 'application/json' },
      new Map([
        ['X-Webhook-Signature', sig],
        ['X-WEBHOOK-TIMESTAMP', TS],
      ]),
      [
        ['x-webhook-signature', sig],
        ['x-webhook-timestamp', TS],
      ],
      { HTTP_X_WEBHOOK_SIGNATURE: sig, HTTP_X_WEBHOOK_TIMESTAMP: TS },
    ];
    for (const headers of forms) {
      const event = Webhooks.constructEvent(body, headers as any, SECRET, NOW) as WebhookEvent;
      expect(event.eventId).toBe(ENVELOPE.eventId);
    }
  });

  test('duplicate headers fail', () => {
    const body = JSON.stringify(ENVELOPE);
    const sig = sign(body);
    expect(
      reason(() =>
        Webhooks.constructEvent(
          body,
          { 'x-webhook-signature': [sig, sig], 'x-webhook-timestamp': TS },
          SECRET,
          NOW,
        ),
      ),
    ).toBe('duplicate_header');
    expect(
      reason(() =>
        Webhooks.constructEvent(
          body,
          { 'x-webhook-signature': sig, 'X-Webhook-Signature': sig, 'x-webhook-timestamp': TS },
          SECRET,
          NOW,
        ),
      ),
    ).toBe('duplicate_header');
    const joined = new Headers();
    joined.append('x-webhook-timestamp', TS);
    joined.append('x-webhook-timestamp', TS);
    joined.append('x-webhook-signature', sig);
    expect(reason(() => Webhooks.constructEvent(body, joined, SECRET, NOW))).toBe('duplicate_header');
  });

  test('non-ASCII header values fail', () => {
    const body = JSON.stringify(ENVELOPE);
    expect(
      reason(() =>
        Webhooks.constructEvent(
          body,
          { 'x-webhook-signature': `${sign(body)}é`, 'x-webhook-timestamp': TS },
          SECRET,
          NOW,
        ),
      ),
    ).toBe('non_ascii_header');
  });

  test('a parsed object is rejected with a hint to use the raw body', () => {
    expect(() =>
      Webhooks.constructEvent(ENVELOPE as any, headersFor(JSON.stringify(ENVELOPE)), SECRET, NOW),
    ).toThrow(/raw/);
  });

  test('re-serialized JSON does not verify', () => {
    const original = loadFixture('fixtures/webhook/created-enriched.json');
    const reserialized = JSON.stringify(JSON.parse(original.request.rawBody), null, 2);
    expect(reason(() => Webhooks.constructEvent(reserialized, original.request.headers, SECRET, NOW))).toBe(
      'signature_mismatch',
    );
  });

  test('a time without zone fails as unparseable; the default tolerance is 300 s in both directions', () => {
    const body = JSON.stringify(ENVELOPE);
    expect(
      reason(() => Webhooks.constructEvent(body, headersFor(body, '2026-11-23T21:04:05.123'), SECRET, NOW)),
    ).toBe('unparseable_timestamp');
    const at = (offsetMs: number) => ({ now: () => Date.parse(TS) + offsetMs });
    expect(() => Webhooks.constructEvent(body, headersFor(body), SECRET, at(300_000))).not.toThrow();
    expect(reason(() => Webhooks.constructEvent(body, headersFor(body), SECRET, at(300_001)))).toBe(
      'timestamp_outside_tolerance',
    );
    expect(reason(() => Webhooks.constructEvent(body, headersFor(body), SECRET, at(-300_001)))).toBe(
      'timestamp_outside_tolerance',
    );
  });

  test('an empty secret fails closed', () => {
    const body = JSON.stringify(ENVELOPE);
    expect(reason(() => Webhooks.constructEvent(body, headersFor(body), '', NOW))).toBe('invalid_secret');
  });
});

describe('R-HOOK-2: payload version', () => {
  const variant = (payloadVersion: unknown) => {
    const body = JSON.stringify({ ...ENVELOPE, payloadVersion });
    return Webhooks.constructEvent(body, headersFor(body), SECRET, NOW);
  };

  test('3.0 counts as v3', () => {
    const body = JSON.stringify(ENVELOPE).replace('"payloadVersion":3', '"payloadVersion":3.0');
    expect(body).toContain('3.0');
    expect(isWrongPayloadVersion(Webhooks.constructEvent(body, headersFor(body), SECRET, NOW))).toBe(false);
  });

  test.each([['3'], [true], [2], [4], [null]])(
    'payloadVersion %j is a WrongPayloadVersion result',
    (value) => {
      const result = variant(value);
      expect(result).toBeInstanceOf(WrongPayloadVersion);
      const w = result as WrongPayloadVersion;
      expect(w.detectedVersion).toBe(2);
      expect(w.payloadVersion).toBe(value);
      expect(w.payloadVersionPresent).toBe(true);
      expect(w.link).toBe(ENVELOPE.data.link);
      expect(w).not.toBeInstanceOf(Error);
      expect(rawJson(w)).toEqual(w.json);
    },
  );

  test('a tampered v2 body fails the signature first', () => {
    const f = loadFixture('fixtures/webhook/v2-body.json');
    const tampered = f.request.rawBody.replace('"link"', '"Link"');
    expect(
      reason(() =>
        Webhooks.constructEvent(tampered, f.request.headers, f.secret, {
          now: () => Date.parse(f.verify.now),
        }),
      ),
    ).toBe('signature_mismatch');
  });

  test('a verified body that is not a JSON object is a FinlightDecodeError', () => {
    for (const body of ['[1,2]', 'not json']) {
      expect(() => Webhooks.constructEvent(body, headersFor(body), SECRET, NOW)).toThrow(FinlightDecodeError);
    }
  });
});

describe('R-HOOK-3: the event', () => {
  test('unknown envelope keys are kept and reachable', () => {
    const body = JSON.stringify({ ...ENVELOPE, deliveryAttempt: 2 });
    const event = Webhooks.constructEvent(body, headersFor(body), SECRET, NOW) as WebhookEvent;
    expect((rawJson(event) as any).deliveryAttempt).toBe(2);
    expect(event.isTest).toBe(false);
    expect('changedFields' in event).toBe(false);
  });
});
