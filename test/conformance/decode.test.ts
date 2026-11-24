import { createHmac } from 'node:crypto';
import {
  ARTICLE_EVENT_NAMES,
  COMPANY_ROLES,
  CONNECTION_ERROR_CODES,
  CONNECTION_EVENT_NAMES,
  EVENT_DIRECTIONS,
  EVENT_TYPES,
  IMPORTANCE_LEVELS,
  INCLUDE_BLOCKS,
  ORDER_BY_VALUES,
  PAYLOAD_VERSION,
  PREEMPT_REASONS,
  PROBLEM_CODES,
  SENTIMENT_LABELS,
  SORT_ORDERS,
  SOURCE_TYPES,
  STREAM_EVENT_NAMES,
  WEBHOOK_EVENT_NAMES,
  problemTypeUrl,
} from '../../src/vocab';
import { decodeArticle, decodeArticlePage, envelopeField } from '../../src/decode';
import { RATE_LIMIT_TYPES, RateLimitedError } from '../../src/errors';
import {
  companiesPresent,
  contentPresent,
  eventsPresent,
  sentimentPresent,
  type Article,
} from '../../src/models';
import { rawJson } from '../../src/internal/raw';
import { decodeFrame } from '../../src/frames';
import { parseApiError, retryClass } from '../../src/http';
import { Webhooks, WrongPayloadVersion } from '../../src/webhooks';
import { createLogger } from '../../src/logger';
import { caseName, loadFixture } from '../helpers/kit';

type Presence = 'absent' | 'null' | 'empty' | 'value';

function presenceAt(root: unknown, path: string): Presence {
  let cur: any = root;
  for (const segment of path.split('.')) {
    const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(segment);
    if (!m) throw new Error(`bad path ${path}`);
    if (cur === null || cur === undefined || !Object.prototype.hasOwnProperty.call(cur, m[1]))
      return 'absent';
    cur = cur[m[1]];
    if (m[2] !== undefined) {
      if (!Array.isArray(cur) || cur.length <= Number(m[2])) return 'absent';
      cur = cur[Number(m[2])];
    }
  }
  if (cur === undefined) return 'absent';
  if (cur === null) return 'null';
  if (Array.isArray(cur) && cur.length === 0) return 'empty';
  return 'value';
}

/** Checks every expected key state, through the model and through the presence helpers. */
function checkPresence(article: Article, expected: Record<string, Presence>): void {
  for (const [path, state] of Object.entries(expected)) {
    expect({ path, state: presenceAt(article, path) }).toEqual({ path, state });
  }
  const guards: Record<string, (a: Article) => boolean> = {
    content: contentPresent,
    sentiment: sentimentPresent,
    companies: companiesPresent,
    events: eventsPresent,
  };
  for (const [key, guard] of Object.entries(guards)) {
    if (expected[key] !== undefined) {
      expect({ key, present: guard(article) }).toEqual({ key, present: expected[key] !== 'absent' });
    }
  }
  // events[].companyIds: present only when the companies block is in the same payload.
  for (const event of article.events ?? []) {
    expect('companyIds' in event).toBe(companiesPresent(article));
  }
}

function decodeCase(file: string): { fixture: any; article: Article } {
  const fixture = loadFixture(file);
  const article = decodeArticle(fixture.wire);
  checkPresence(article, fixture.expect.presence);
  return { fixture, article };
}

describe('V: vocabulary', () => {
  test(caseName('V-01'), () => {
    const vocab = loadFixture('vocab.json');
    expect(PAYLOAD_VERSION).toBe(vocab.payloadVersion);
    expect([...INCLUDE_BLOCKS]).toEqual(vocab.request.include.values);
    expect([...ORDER_BY_VALUES]).toEqual(vocab.request.orderBy.values);
    expect([...SORT_ORDERS]).toEqual(vocab.request.order.values);
    expect([...COMPANY_ROLES]).toEqual(vocab.request.roles.values);
    expect([...COMPANY_ROLES]).toEqual(vocab.response.roles.values);
    expect([...EVENT_TYPES]).toEqual(vocab.request.eventTypes.values);
    expect([...EVENT_TYPES]).toEqual(vocab.response.eventTypes.values);
    expect([...EVENT_DIRECTIONS]).toEqual(vocab.request.eventDirections.values);
    expect([...EVENT_DIRECTIONS]).toEqual(vocab.response.eventDirections.values);
    expect([...IMPORTANCE_LEVELS]).toEqual(vocab.request.minImportance.values);
    expect([...IMPORTANCE_LEVELS]).toEqual(vocab.response.importance.values);
    expect([...SENTIMENT_LABELS]).toEqual(vocab.response.sentimentLabels.values);
    expect([...SOURCE_TYPES]).toEqual(vocab.request.sourceTypes.values);
    expect([...SOURCE_TYPES]).toEqual(vocab.request.excludeSourceTypes.values);
    expect([...SOURCE_TYPES]).toEqual(vocab.response.sourceTypes.values);
    expect([...STREAM_EVENT_NAMES]).toEqual(vocab.websocket.events.values);
    expect([...ARTICLE_EVENT_NAMES]).toEqual(vocab.websocket.articleEvents.values);
    expect([...CONNECTION_EVENT_NAMES]).toEqual(vocab.websocket.connectionEvents.values);
    expect([...CONNECTION_ERROR_CODES]).toEqual(vocab.websocket.connectionErrorCodes.values);
    expect([...PREEMPT_REASONS]).toEqual(vocab.websocket.preemptReasons.values);
    expect([...WEBHOOK_EVENT_NAMES]).toEqual(vocab.webhook.events.values);
    expect([...PROBLEM_CODES]).toEqual(vocab.problemCodes.values.map((v: any) => v.code));
    expect([...RATE_LIMIT_TYPES]).toEqual(vocab.limitTypes.values);
    for (const { code, type } of vocab.problemCodes.values) expect(problemTypeUrl(code)).toBe(type);
    // Response enums stay open: an unknown value is kept as is.
    const article = decodeArticle({
      id: 'x',
      link: 'l',
      title: 't',
      source: { domain: 'd', type: 'brand-new' },
      sentiment: { label: 'mixed', confidence: 0.5 },
    });
    expect(article.source.type).toBe('brand-new');
    expect(article.sentiment?.label).toBe('mixed');
  });
});

describe('D: decode', () => {
  test(caseName('D-01'), () => {
    const { fixture, article } = decodeCase('fixtures/decode/full-article.json');
    expect(article.media.length).toBeLessThanOrEqual(3);
    expect(article.revisedAt).toBe(fixture.wire.revisedAt);
    expect(article.companies?.[1].primaryListing).toBeNull();
    expect(article.sentiment).toEqual(fixture.wire.sentiment);
    expect(article.events?.[0].companyIds).toEqual([900001, 900002]);
  });

  test(caseName('D-02'), () => {
    const { article } = decodeCase('fixtures/decode/raw-skeleton.json');
    for (const key of ['content', 'sentiment', 'companies', 'events']) expect(key in article).toBe(false);
    expect(article.availableAt).toBeNull();
  });

  test(caseName('D-03'), () => {
    const { article } = decodeCase('fixtures/decode/no-include-full-access.json');
    expect(sentimentPresent(article)).toBe(true);
    expect(contentPresent(article) || companiesPresent(article) || eventsPresent(article)).toBe(false);
  });

  test(caseName('D-04'), () => {
    const { article } = decodeCase('fixtures/decode/all-include-no-access.json');
    expect(article.content).toBeUndefined();
    expect(article.sentiment).toBeUndefined();
    expect(article.companies).toBeUndefined();
    expect(article.events).toBeUndefined();
    expect(JSON.parse(JSON.stringify(article))).not.toHaveProperty('companies');
  });

  test(caseName('D-05'), () => {
    const { article } = decodeCase('fixtures/decode/events-without-companies.json');
    expect(eventsPresent(article)).toBe(true);
    for (const event of article.events ?? []) expect('companyIds' in event).toBe(false);
  });

  test(caseName('D-06'), () => {
    const { article } = decodeCase('fixtures/decode/events-companies-not-entitled.json');
    expect(companiesPresent(article)).toBe(false);
    expect(eventsPresent(article)).toBe(true);
    for (const event of article.events ?? []) expect(event.companyIds).toBeUndefined();
  });

  test(caseName('D-07'), () => {
    const { fixture, article } = decodeCase('fixtures/decode/legacy-values.json');
    expect(article.publishedAt).toBe('1970-01-01T00:00:00.000Z');
    // rc.2+: the server sends null for an empty summary.
    expect(article.summary).toBe(fixture.wire.summary);
    expect(article.summary).toBeNull();
    expect(article.firstSeenAt).toBeNull();
    expect(article.revisedAt).toBeNull();
    expect(article.availableAt).toBeNull();
    expect(article.sentiment).toBeNull();
    expect(article.content).toBeNull();
    expect(article.companies?.[0].role).toBeNull();
    expect(article.companies?.[0].relevance).toBeNull();
    expect(article.companies?.[0].primaryListing?.ticker).toBe('LGCY');
    expect(article.events).toEqual([]);
    expect(article.countries).toEqual([]);
    expect(article.categories).toEqual([]);
  });

  test(caseName('D-11'), () => {
    const { fixture, article } = decodeCase('fixtures/decode/blank-text.json');
    expect(article.summary).toBeNull();
    expect(article.content).toBeNull();
    expect(contentPresent(article)).toBe(true);
    expect(article.title).toBe(fixture.wire.title);
  });

  test(caseName('D-08'), () => {
    const { fixture, article } = decodeCase('fixtures/decode/non-ascii.json');
    expect(article.title).toBe(fixture.wire.title);
    expect(article.summary).toBe(fixture.wire.summary);
  });

  test(caseName('D-09'), () => {
    const { article } = decodeCase('fixtures/decode/partial-values.json');
    expect(article.sentiment?.label).toBeNull();
    expect(typeof article.sentiment?.confidence).toBe('number');
    expect(companiesPresent(article)).toBe(true);
    expect(article.companies).toEqual([]);
    expect(article.events?.[0].direction).toBeNull();
    expect(article.events?.[0].importance).toBeNull();
    expect(article.events?.[0].confidence).toBeNull();
  });

  describe(caseName('D-10'), () => {
    const matrix = loadFixture('fixtures/decode/matrix.json');
    test('matrix has the announced number of sub-cases', () => {
      expect(matrix.cases.length).toBe(matrix.count);
    });
    for (const c of matrix.cases as Array<{ id: string; wire: unknown; expect: any }>) {
      test(c.id, () => {
        checkPresence(decodeArticle(c.wire), c.expect.presence);
      });
    }
  });
});

function knownSubset(actual: unknown, known: unknown, path = ''): void {
  if (known !== null && typeof known === 'object') {
    if (Array.isArray(known)) {
      expect(Array.isArray(actual)).toBe(true);
      (known as unknown[]).forEach((v, i) => knownSubset((actual as unknown[])[i], v, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(known)) knownSubset((actual as any)?.[k], v, `${path}.${k}`);
    return;
  }
  expect({ path, value: actual }).toEqual({ path, value: known });
}

describe('F: forward compatibility', () => {
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const sign = (body: string, ts: string) => ({
    'x-webhook-signature': `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`,
    'x-webhook-timestamp': ts,
  });

  test(caseName('F-01'), () => {
    const fixture = loadFixture('fixtures/forward-compat/unknown-fields.json');
    const article = decodeArticle(fixture.wire);
    knownSubset(article, fixture.known);
    const raw = rawJson(article) as any;
    expect(raw.wordCount).toBe(fixture.wire.wordCount);
    expect(raw.story).toEqual(fixture.wire.story);
    expect((article as any).wordCount).toBe(fixture.wire.wordCount);
    expect(rawJson(article.companies![0])).toEqual(fixture.wire.companies[0]);
  });

  test(caseName('F-02'), () => {
    const fixture = loadFixture('fixtures/forward-compat/unknown-enum-values.json');
    const article = decodeArticle(fixture.wire);
    expect(article.source.type).toBe(fixture.wire.source.type);
    expect(article.sentiment?.label).toBe(fixture.wire.sentiment.label);
    expect(article.companies?.[0].role).toBe(fixture.wire.companies[0].role);
    expect(article.events?.[0].type).toBe(fixture.wire.events[0].type);
    expect(article.events?.[0].direction).toBe(fixture.wire.events[0].direction);
    expect(article.events?.[0].importance).toBe(fixture.wire.events[0].importance);
    expect(article.categories).toEqual(fixture.wire.categories);
  });

  test(caseName('F-03'), () => {
    const fixture = loadFixture('fixtures/forward-compat/envelope-keys.json');
    const log = createLogger(undefined);
    for (const env of fixture.envelopes) {
      switch (env.kind) {
        case 'rest.search': {
          const page = decodeArticlePage(env.wire, log);
          expect(page.articles).toHaveLength(env.wire.articles.length);
          expect(page.pagination.hasMore).toBe(false);
          expect(page.skipped).toEqual([]);
          break;
        }
        case 'rest.article':
          expect(decodeArticle(envelopeField(env.wire, 'article')).id).toBe(env.wire.article.id);
          break;
        case 'webhook': {
          const body = JSON.stringify(env.wire);
          const ts = '2026-11-23T21:04:05.123Z';
          const event = Webhooks.constructEvent(body, sign(body, ts), secret, { now: () => Date.parse(ts) });
          expect(event).not.toBeInstanceOf(WrongPayloadVersion);
          expect((event as any).eventId).toBe(env.wire.eventId);
          break;
        }
        case 'ws.article': {
          const frame = decodeFrame(env.wire);
          expect(frame.type).toBe('article');
          expect(decodeArticle((frame as any).data).id).toBe(env.wire.data.id);
          break;
        }
        case 'ws.control': {
          const frame = decodeFrame(env.wire);
          expect(frame).toMatchObject({ type: 'pong', t: 1, serverNow: 1763932800123 });
          break;
        }
        default:
          throw new Error(`unhandled envelope kind ${env.kind}`);
      }
    }
  });

  test(caseName('F-04'), () => {
    const fixture = loadFixture('fixtures/forward-compat/unknown-events-and-codes.json');
    const [hook, problem, limit] = fixture.items;
    const body = JSON.stringify(hook.wire);
    const ts = '2026-11-23T21:04:05.123Z';
    const event = Webhooks.constructEvent(body, sign(body, ts), secret, { now: () => Date.parse(ts) });
    expect((event as any).event).toBe('article.retracted');

    const err = parseApiError(
      problem.status,
      problem.headers['content-type'],
      JSON.stringify(problem.wire),
      'req-sent',
      null,
    );
    expect(err.code).toBe('PAYMENT_REQUIRED');
    expect(err.apiKind).toBe('other');
    expect(err.status).toBe(402);
    expect(err.detail).toBe(problem.wire.detail);
    expect(err.requestId).toBe('req_synthetic');
    expect(retryClass(err)).toBe('never');
    expect(err.constructor.name).toBe('FinlightApiError');

    const rl = parseApiError(
      limit.status,
      limit.headers['content-type'],
      JSON.stringify(limit.wire),
      'r',
      null,
    );
    expect(rl).toBeInstanceOf(RateLimitedError);
    expect(rl.apiKind).toBe('rate_limited');
    expect((rl as RateLimitedError).limitType).toBe('daily');
    expect(retryClass(rl)).toBe('never');
  });
});
