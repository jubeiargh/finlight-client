import { WebhookVerificationError } from '../../src/errors';
import type { WebhookEvent } from '../../src/models';
import { Webhooks, WrongPayloadVersion } from '../../src/webhooks';
import { caseName, listFixtures, loadFixture } from '../helpers/kit';

const files = listFixtures('fixtures/webhook');
const byId = new Map<string, any>();
for (const file of files) {
  const f = loadFixture(file);
  byId.set(f.id, f);
}

function run(f: any, body: string | Uint8Array): WebhookEvent | WrongPayloadVersion {
  return Webhooks.constructEvent(body, f.request.headers, f.secret, {
    now: () => Date.parse(f.verify.now),
    toleranceMs: f.verify.toleranceSeconds * 1000,
  });
}

describe('W: webhooks', () => {
  test('every webhook fixture is a numbered case', () => {
    expect(byId.size).toBe(16);
  });

  for (const id of [...byId.keys()].sort()) {
    test(caseName(id), () => {
      const f = byId.get(id);
      const bytes = Buffer.from(f.request.rawBody64 ?? f.request.rawBodyBase64, 'base64');
      // The fixture's text and bytes are the same body.
      expect(bytes.toString('utf8')).toBe(f.request.rawBody);
      const expected = f.expect;

      for (const body of [bytes, new Uint8Array(bytes), f.request.rawBody as string]) {
        if (expected.outcome === 'event') {
          const event = run(f, body);
          expect(event).not.toBeInstanceOf(WrongPayloadVersion);
          const e = event as WebhookEvent;
          expect(e.eventId).toBe(expected.event.eventId);
          expect(e.event).toBe(expected.event.event);
          expect(e.occurredAt).toBe(expected.event.occurredAt);
          expect(e.subscriptionId).toBe(expected.event.subscriptionId);
          expect(e.isTest).toBe(expected.event.isTest);
          expect(e.data.link).toBe(expected.event.link);
          expect(e.payloadVersion).toBe(3);
          if (expected.event.changedFields) expect(e.changedFields).toEqual(expected.event.changedFields);
          else expect('changedFields' in e).toBe(false);
          if (id === 'W-03') expect('content' in e.data).toBe(false);
          if (id === 'W-04') {
            for (const k of ['content', 'sentiment', 'companies', 'events']) expect(k in e.data).toBe(false);
            expect(e.data.availableAt).toBeNull();
            expect(e.occurredAt).toBe(e.data.firstSeenAt);
          }
          if (id === 'W-05') expect(e.isTest).toBe(true);
        } else if (expected.outcome === 'wrongPayloadVersion') {
          const result = run(f, body);
          expect(result).toBeInstanceOf(WrongPayloadVersion);
          const w = result as WrongPayloadVersion;
          expect(w.detectedVersion).toBe(2);
          expect(w.payloadVersionPresent).toBe(expected.payloadVersionPresent);
          expect(w.detectedVersion).toBe(expected.detectedVersion);
          expect(w.payloadVersion).toBeUndefined();
          expect(w.link).toBe(expected.link);
          expect(w.raw).toEqual(JSON.parse(f.request.rawBody));
        } else {
          let caught: unknown;
          try {
            run(f, body);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(WebhookVerificationError);
          expect((caught as WebhookVerificationError).reason).toBe(expected.reason);
        }
      }

      // The two-header-values variant agrees.
      const headers = Object.fromEntries(
        Object.entries(f.request.headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const verify = (): void =>
        Webhooks.verifySignature(
          bytes,
          headers['x-webhook-signature'] as string,
          headers['x-webhook-timestamp'] as string,
          f.secret,
          {
            now: () => Date.parse(f.verify.now),
            toleranceMs: f.verify.toleranceSeconds * 1000,
          },
        );
      const opts = { now: () => Date.parse(f.verify.now), toleranceMs: f.verify.toleranceSeconds * 1000 };
      const fromValues = (): unknown =>
        Webhooks.constructEventFromValues(
          bytes,
          headers['x-webhook-signature'] as string | undefined,
          headers['x-webhook-timestamp'] as string | undefined,
          f.secret,
          opts,
        );
      if (expected.outcome === 'error') {
        expect(verify).toThrow(WebhookVerificationError);
        expect(fromValues).toThrow(WebhookVerificationError);
      } else {
        expect(verify).not.toThrow();
        const viaValues = fromValues();
        if (expected.outcome === 'wrongPayloadVersion') expect(viaValues).toBeInstanceOf(WrongPayloadVersion);
        else expect((viaValues as WebhookEvent).eventId).toBe(expected.event.eventId);
      }
    });
  }
});
