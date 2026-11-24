import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { FinlightClient } from '../../src/client';
import { DEFAULTS } from '../../src/config';
import {
  FinlightApiError,
  FinlightDecodeError,
  FinlightNetworkError,
  FinlightTimeoutError,
  FinlightValidationError,
  isFinlightApiError,
  isFinlightError,
} from '../../src/errors';
import { buildSearchBody, buildSubscribe } from '../../src/params';
import { skippedEntries } from '../../src/companies';
import { toDate } from '../../src/time';
import { FakeClock, flushIo, waitFor } from '../helpers/fake-clock';
import { HttpMock } from '../helpers/http-mock';
import { restClient, transport } from '../helpers/clients';
import { KIT_API_KEY, loadFixture } from '../helpers/kit';

const ROOT = join(__dirname, '..', '..');
let mock: HttpMock;

beforeAll(async () => {
  mock = await new HttpMock().start();
});
afterAll(async () => {
  await mock.stop();
});
beforeEach(() => mock.reset());

const ARTICLE = loadFixture('fixtures/decode/full-article.json').wire;
const page = (articles: unknown[], pagination: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    articles,
    pagination: { limit: 20, returned: articles.length, hasMore: false, nextCursor: null, ...pagination },
  },
});

const ALL_SEARCH = {
  query: 'q',
  sources: ['a'],
  optInSources: ['b'],
  excludeSources: ['c'],
  from: new Date('2026-01-01T00:00:00Z'),
  to: '2026-02-01',
  languages: ['en'],
  tickers: ['T'],
  countries: ['US'],
  categories: ['markets'],
  hasContent: false,
  roles: ['subject'],
  minRelevance: 0,
  eventTypes: ['mna'],
  eventDirections: ['positive'],
  minImportance: 'high',
  sectors: ['Energy'],
  companyCountries: ['US'],
  exchanges: ['XNAS'],
  orderBy: 'publishedAt',
  order: 'asc',
  limit: 1,
  cursor: 'abc',
  include: ['content', 'companies', 'events'],
};
const LEGACY = ['includeContent', 'includeEntities', 'extended', 'pageSize', 'publishDate', 'isUpdate'];

describe('R-SCOPE-1: v3 only', () => {
  test('every request type with every field carries no v1/v2 key', () => {
    const bodies = [
      buildSearchBody(ALL_SEARCH),
      buildSubscribe(
        {
          query: 'q',
          sources: ['a'],
          excludeSources: ['b'],
          optInSources: ['c'],
          language: 'en',
          tickers: ['T'],
          countries: ['US'],
          categories: ['x'],
          excludeEmptyContent: true,
          includeUpdates: true,
          include: ['content'],
        },
        false,
      ),
      buildSubscribe(
        { query: 'q', sources: ['a'], excludeSources: ['b'], language: 'en', includeUpdates: true },
        true,
      ),
    ];
    for (const body of bodies) {
      const text = JSON.stringify(body);
      for (const key of LEGACY) expect(text).not.toContain(`"${key}"`);
    }
    expect(Object.keys(bodies[0]).sort()).toEqual(Object.keys(ALL_SEARCH).sort());
    // Explicit false and 0 are sent.
    expect(bodies[0].hasContent).toBe(false);
    expect(bodies[0].minRelevance).toBe(0);
  });

  test('the source mentions v1/v2 only in the frame decoder and the webhook version check', () => {
    const allowed = new Set(['src/frames.ts', 'src/webhooks.ts']);
    const patterns = [
      /\/v1\//i,
      /\/v2\//i,
      /sendArticle/i,
      /admin_kick/i,
      ...LEGACY.flatMap((k) => {
        const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        return [new RegExp(k, 'i'), new RegExp(snake, 'i')];
      }),
    ];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts')) {
          const rel = full.slice(ROOT.length + 1);
          const src = readFileSync(full, 'utf8');
          for (const p of patterns) if (p.test(src) && !allowed.has(rel)) hits.push(`${rel}: ${p}`);
        }
      }
    };
    walk(join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});

describe('R-REQ-1 / R-REQ-3: requests', () => {
  test('a subscribe with only query has query, payloadVersion and clientNonce after the SDK adds the nonce', () => {
    expect(buildSubscribe({ query: 'ticker:X' }, false)).toEqual({ payloadVersion: 3, query: 'ticker:X' });
  });

  test('legacy and SDK keys cannot be smuggled into a subscribe', () => {
    for (const key of ['includeContent', 'includeEntities', 'extended', 'payloadVersion', 'clientNonce']) {
      expect(() =>
        buildSubscribe({ query: 'q', [key]: key === 'payloadVersion' ? '3' : true }, false),
      ).toThrow(FinlightValidationError);
    }
    const inherited = Object.create({ includeContent: true });
    inherited.query = 'q';
    expect(buildSubscribe(inherited, false)).toEqual({ payloadVersion: 3, query: 'q' });
  });

  test.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ limit: 1.5 }, 'limit'],
    [{ limit: '20' }, 'limit'],
    [{ limit: true }, 'limit'],
    [{ languages: [] }, 'languages'],
    [{ minRelevance: 1.1 }, 'minRelevance'],
    [{ minRelevance: -0.1 }, 'minRelevance'],
    [{ include: ['content', 'companies', 'events', 'content'] }, 'include'],
    [{ sources: 'a' }, 'sources'],
    [{ query: null }, 'query'],
    [{ from: new Date('nope') }, 'from'],
    [{ hasContent: 'true' }, 'hasContent'],
  ])('search %j is rejected locally (%s)', async (params, key) => {
    const { client } = restClient(mock.baseUrl);
    const err = await client.articles.search(params as any).catch((e) => e);
    expect(err).toBeInstanceOf(FinlightValidationError);
    expect(err.param).toBe(key);
    expect(mock.requests).toHaveLength(0);
  });

  test('companies shape rules are checked locally', async () => {
    const { client } = restClient(mock.baseUrl);
    await expect(client.companies.search({ q: '' })).rejects.toThrow(FinlightValidationError);
    await expect(client.companies.search({ q: 'x'.repeat(201) })).rejects.toThrow(FinlightValidationError);
    await expect(client.companies.search({ q: 'a', mic: 'x'.repeat(33) })).rejects.toThrow(
      FinlightValidationError,
    );
    await expect(client.companies.search({ q: 'a', ids: [1] } as any)).rejects.toThrow(/"ids"/);
    await expect(client.companies.getMany([])).rejects.toThrow(FinlightValidationError);
    await expect(client.companies.getMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).rejects.toThrow(
      FinlightValidationError,
    );
    await expect(client.companies.getMany([0])).rejects.toThrow(FinlightValidationError);
    await expect(client.companies.get(1.5)).rejects.toThrow(FinlightValidationError);
    await expect(client.articles.getByLink('')).rejects.toThrow(FinlightValidationError);
    expect(mock.requests).toHaveLength(0);
  });

  test('unknown vocabulary values go out unchanged', async () => {
    mock.enqueue(page([]));
    const { client } = restClient(mock.baseUrl);
    await client.articles.search({ eventTypes: ['brand_new_type'], include: ['future-block'] });
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      eventTypes: ['brand_new_type'],
      include: ['future-block'],
    });
  });

  test('searchAll and streams validate at the call, before any I/O', () => {
    const { client } = restClient(mock.baseUrl);
    expect(() => client.articles.searchAll({ limit: 0 })).toThrow(FinlightValidationError);
    expect(() => client.stream({ language: ['en'] } as any)).toThrow(FinlightValidationError);
    expect(() => client.rawStream({ tickers: ['X'] } as any)).toThrow(/"tickers"/);
    expect(mock.requests).toHaveLength(0);
  });

  test('an empty include on a GET is dropped; dates go out as UTC with milliseconds', async () => {
    mock.enqueue({ status: 200, body: { article: ARTICLE } }, page([]));
    const { client } = restClient(mock.baseUrl);
    await client.articles.get('id', { include: [] });
    expect(mock.requests[0].query).toBe('');
    await client.articles.search({ from: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)), to: '2026-01-31' });
    expect(JSON.parse(mock.requests[1].body)).toEqual({ from: '2026-01-02T03:04:05.006Z', to: '2026-01-31' });
  });

  test.each(['de_DE.UTF-8', 'tr_TR.UTF-8'])('bodies do not depend on the locale (%s)', (locale) => {
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(join(ROOT, 'test', 'helpers', 'ts-register.js'))});
         const { buildSearchBody, encodeQuery } = require(${JSON.stringify(join(ROOT, 'src', 'params.ts'))});
         process.stdout.write(JSON.stringify(buildSearchBody({ minRelevance: 0.5, from: new Date(Date.UTC(2026,0,2)), limit: 50, eventTypes: ['ipo_listing'] })) + ' ' + encodeQuery([['q', 'İSTANBUL ışık 0.5'], ['ids', '1,2']]));`,
      ],
      { env: { ...process.env, LC_ALL: locale, LANG: locale, TZ: 'Europe/Istanbul' }, encoding: 'utf8' },
    );
    expect(out).toBe(
      '{"from":"2026-01-02T00:00:00.000Z","minRelevance":0.5,"eventTypes":["ipo_listing"],"limit":50} ' +
        'q=%C4%B0STANBUL%20%C4%B1%C5%9F%C4%B1k%200.5&ids=1%2C2',
    );
  });
});

describe('R-PAGE-1: searchAll', () => {
  test('stops at maxPages with a warning and keeps nextCursor', async () => {
    mock.always(page([ARTICLE], { hasMore: true, nextCursor: 'next' }));
    const warnings: string[] = [];
    const { client } = restClient(mock.baseUrl, { logger: { warn: (m: string) => warnings.push(m) } });
    const result = client.articles.searchAll({ limit: 1 }, { maxPages: 2 });
    const ids = [];
    for await (const a of result) ids.push(a.id);
    expect(ids).toHaveLength(2);
    expect(mock.requests).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBe('next');
    expect(warnings.some((w) => /maxPages/.test(w))).toBe(true);
  });

  test('default maxPages is 10', async () => {
    mock.always(page([ARTICLE], { hasMore: true, nextCursor: 'n' }));
    const { client } = restClient(mock.baseUrl);
    const result = client.articles.searchAll();
    for await (const _ of result.pages()) {
      // drain
    }
    expect(mock.requests).toHaveLength(10);
    expect(DEFAULTS.maxPages).toBe(10);
  });

  test('stops on nextCursor null even when hasMore is true', async () => {
    mock.always(page([ARTICLE], { hasMore: true, nextCursor: null }));
    const { client } = restClient(mock.baseUrl);
    const pages = [];
    for await (const p of client.articles.searchAll().pages()) pages.push(p);
    expect(pages).toHaveLength(1);
  });

  test('a second iteration throws instead of searching again', async () => {
    mock.always(page([ARTICLE]));
    const { client } = restClient(mock.baseUrl);
    const result = client.articles.searchAll();
    for await (const _ of result) {
      // drain
    }
    expect(() => result[Symbol.asyncIterator]()).toThrow(FinlightValidationError);
    expect(() => result.pages()).toThrow(FinlightValidationError);
    expect(mock.requests).toHaveLength(1);
  });

  test('errors surface during the iteration', async () => {
    mock.always({
      status: 401,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'UNAUTHORIZED', title: 'Unauthorized', status: 401 },
    });
    const { client } = restClient(mock.baseUrl);
    const result = client.articles.searchAll();
    await expect(
      (async () => {
        for await (const _ of result) {
          // drain
        }
      })(),
    ).rejects.toThrow(FinlightApiError);
  });
});

describe('R-MODELS-1 / R-MODELS-2: tolerant reader', () => {
  test('a broken entry is skipped, logged and listed; the rest of the page survives', async () => {
    const broken = { ...ARTICLE, sentiment: { label: 'positive', confidence: '0.95' } };
    const noLink = { ...ARTICLE, link: undefined };
    mock.enqueue(page([ARTICLE, broken, noLink]));
    const warnings: string[] = [];
    const { client } = restClient(mock.baseUrl, { logger: { warn: (m: string) => warnings.push(m) } });
    const result = await client.articles.search();
    expect(result.articles).toHaveLength(1);
    expect(result.skipped.map((s) => s.index)).toEqual([1, 2]);
    expect(result.skipped[0].raw).toEqual(broken);
    expect(warnings).toHaveLength(2);
  });

  test('a single lookup of a broken article is a FinlightDecodeError', async () => {
    const { link: _link, ...noLink } = ARTICLE;
    mock.enqueue({ status: 200, body: { article: noLink } });
    const { client } = restClient(mock.baseUrl);
    const err = await client.articles.get('x').catch((e) => e);
    expect(err).toBeInstanceOf(FinlightDecodeError);
    expect(err.path).toBe('article.link');
  });

  test('broken company and source entries go to skippedEntries()', async () => {
    mock.enqueue({ status: 200, body: { sources: [{ domain: 'a' }, { name: 'no domain' }] } });
    const { client } = restClient(mock.baseUrl);
    const sources = await client.sources.list();
    expect(sources).toHaveLength(1);
    expect(skippedEntries(sources)).toHaveLength(1);
  });

  test('values are delivered as sent and parsed strictly on demand', () => {
    const legacy = loadFixture('fixtures/decode/legacy-values.json').wire;
    expect(toDate(legacy.publishedAt)?.getTime()).toBe(0);
    expect(toDate('2026-11-23T21:04:05.123+02:00')?.toISOString()).toBe('2026-11-23T19:04:05.123Z');
    for (const bad of [
      'now',
      '',
      '1795467845',
      '2026-11-23',
      '2026-11-23T21:04:05',
      '2026-02-30T00:00:00Z',
      'garbage',
    ]) {
      expect(toDate(bad)).toBeNull();
    }
    expect(toDate(null)).toBeNull();
  });

  test('large integers and full-precision scores are kept', async () => {
    const article = {
      ...ARTICLE,
      companies: [{ ...ARTICLE.companies[0], companyId: 2 ** 53 - 1, confidence: 0.912345678 }],
    };
    mock.enqueue({ status: 200, body: { article } });
    const { client } = restClient(mock.baseUrl);
    const decoded = await client.articles.get('x');
    expect(decoded.companies?.[0].companyId).toBe(2 ** 53 - 1);
    expect(decoded.companies?.[0].confidence).toBe(0.912345678);
  });
});

describe('R-ERR-1 / R-RETRY-1: errors and retries', () => {
  const burst = {
    status: 429,
    headers: { 'content-type': 'application/problem+json' },
    body: {
      code: 'RATE_LIMITED',
      status: 429,
      title: 'Too many requests',
      detail: 'Throttling Exception: Exceeded rate limit of 5 requests per 10 seconds.',
    },
  };

  test('rc.2: limitType wins over the detail text, and Retry-After lengthens the burst wait', async () => {
    mock.enqueue(
      {
        ...burst,
        headers: { ...burst.headers, 'retry-after': '17' },
        body: { ...burst.body, detail: 'x', limitType: 'burst' },
      },
      page([]),
    );
    const { client, clock } = restClient(mock.baseUrl);
    await client.articles.search();
    expect(clock.sleeps).toEqual([17_000]);
    mock.reset();
    mock.always({ ...burst, body: { ...burst.body, limitType: 'monthly' } });
    const err = await client.articles.search().catch((e) => e);
    expect(err.limitType).toBe('monthly');
    expect(mock.requests).toHaveLength(1);
  });

  test('a monthly 429 fails at once, also in searchAll; it never waits for a new quota', async () => {
    mock.always({
      ...burst,
      body: {
        ...burst.body,
        detail: 'Throttling Exception: Exceeded token limit of 1000 for the current period.',
      },
    });
    const { client, clock } = restClient(mock.baseUrl);
    const run = (async () => {
      for await (const _ of client.articles.searchAll()) {
        // drain
      }
    })();
    const err = await run.catch((e) => e);
    expect(err.limitType).toBe('monthly');
    expect(mock.requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('a 429 without a known marker is "unknown" and not retried', async () => {
    mock.always({ ...burst, body: { ...burst.body, detail: 'something else' } });
    const { client } = restClient(mock.baseUrl);
    const err = await client.articles.search().catch((e) => e);
    expect(err.limitType).toBe('unknown');
    expect(mock.requests).toHaveLength(1);
  });

  test("retryOnBurst 'off' does not retry", async () => {
    mock.always(burst);
    const { client } = restClient(mock.baseUrl, { retryOnBurst: 'off' });
    await expect(client.articles.search()).rejects.toThrow(FinlightApiError);
    expect(mock.requests).toHaveLength(1);
  });

  test('the burst wait is at least 10 s even when configured lower', () => {
    const { http } = transport(mock.baseUrl, KIT_API_KEY, { burstWaitMs: 1 });
    expect(http.config.burstWaitMs).toBe(10_000);
  });

  test('abort during the burst wait ends at once with the caller reason; no retry', async () => {
    mock.always(burst);
    const clock = new FakeClock(); // never advanced: the wait would last forever
    const client = new FinlightClient({ apiKey: KIT_API_KEY, baseUrl: mock.baseUrl, clock });
    const controller = new AbortController();
    const pending = client.articles.search({}, { signal: controller.signal }).catch((e) => e);
    await waitFor(() => mock.requests.length === 1 && clock.pending() === 1, 'burst wait');
    const reason = new Error('caller stopped');
    controller.abort(reason);
    expect(await pending).toBe(reason);
    expect(mock.requests).toHaveLength(1);
  });

  test('totalTimeoutMs caps the burst wait', async () => {
    mock.always(burst);
    const { client } = restClient(mock.baseUrl, { totalTimeoutMs: 5_000 });
    const err = await client.articles.search().catch((e) => e);
    expect(err).toBeInstanceOf(FinlightTimeoutError);
    expect(err.cause).toBeInstanceOf(FinlightApiError);
  });

  test('5xx then success: retried with backoff, same X-Request-Id', async () => {
    mock.enqueue(
      { status: 503, body: 'busy' },
      { status: 500, body: { statusCode: 500, message: 'x' } },
      page([]),
    );
    const { client, clock } = restClient(mock.baseUrl);
    await client.articles.search();
    expect(mock.requests).toHaveLength(3);
    expect(new Set(mock.requests.map((r) => r.headers['x-request-id'])).size).toBe(1);
    expect(clock.sleeps).toHaveLength(2);
    expect(clock.sleeps[1]).toBeGreaterThanOrEqual(clock.sleeps[0] / 2);
  });

  test('network errors are wrapped, retried 3 times, and keep the cause', async () => {
    const { client, clock } = restClient('http://127.0.0.1:9');
    const err = await client.articles.search().catch((e) => e);
    expect(err).toBeInstanceOf(FinlightNetworkError);
    expect(err.kind).toBe('network');
    expect(err.cause).toBeDefined();
    expect(clock.sleeps).toHaveLength(3);
  });

  test('a slow attempt times out with FinlightTimeoutError and is retried', async () => {
    let calls = 0;
    const slowFetch: typeof fetch = (input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    };
    const { client } = restClient(mock.baseUrl, { fetch: slowFetch, timeoutMs: 5, maxRetries: 1 });
    const err = await client.articles.search().catch((e) => e);
    expect(err).toBeInstanceOf(FinlightTimeoutError);
    expect(calls).toBe(2);
  });

  test('a custom fetch is used for REST', async () => {
    const seen: string[] = [];
    const myFetch: typeof fetch = (input, init) => {
      seen.push(String(input));
      return fetch(input, init);
    };
    mock.enqueue(page([]));
    const { client } = restClient(mock.baseUrl, { fetch: myFetch });
    await client.articles.search();
    expect(seen).toEqual([`${mock.baseUrl}/v3/articles/search`]);
  });

  test('a 404 lookup is an error, not an empty result; guards work without instanceof', async () => {
    mock.enqueue({
      status: 404,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'NOT_FOUND', status: 404, title: 'Not found' },
    });
    const { client } = restClient(mock.baseUrl);
    const err = await client.companies.get(999999).catch((e) => e);
    expect(isFinlightApiError(err)).toBe(true);
    expect(isFinlightError(err)).toBe(true);
    expect(err.apiKind).toBe('not_found');
    const lookalike = Object.assign(new Error('x'), { kind: 'api', status: 404 });
    expect(isFinlightApiError(lookalike)).toBe(true);
  });
});

describe('R-CONFIG-1: configuration and identification', () => {
  test('defaults point to production; URLs with a trailing slash still hit the right path', async () => {
    expect(DEFAULTS.baseUrl).toBe('https://api.finlight.me');
    expect(DEFAULTS.wssUrl).toBe('wss://wss.finlight.me');
    mock.enqueue({ status: 200, body: { sources: [] } });
    const { client } = restClient(`${mock.baseUrl}/`);
    await client.sources.list();
    expect(mock.requests[0].path).toBe('/v3/sources');
  });

  test('every REST call sends User-Agent and x-client-version', async () => {
    mock.enqueue({ status: 200, body: { sources: [] } });
    const { client } = restClient(mock.baseUrl);
    await client.sources.list();
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(mock.requests[0].headers['user-agent']).toBe(`finlight-client-typescript/${version}`);
    expect(mock.requests[0].headers['x-client-version']).toBe(version);
    expect(mock.requests[0].headers['x-request-id']).toMatch(/^req_/);
  });

  test('apiKey is required and unknown config keys are rejected', () => {
    expect(() => new FinlightClient({} as any)).toThrow(/apiKey/);
    expect(() => new FinlightClient({ apiKey: ' ' })).toThrow(/apiKey/);
    expect(() => new FinlightClient({ apiKey: 'k', logLevel: 'info' } as any)).toThrow(/logLevel/);
    expect(() => new FinlightClient({ apiKey: 'k', baseUrl: 'ftp://x' })).toThrow(/baseUrl/);
  });
});

describe('R-LOG-1: logging hygiene', () => {
  test('the API key never shows up in logs, errors or inspection', async () => {
    const secretKey = 'sk_live_this_must_never_leak_0123456789';
    const lines: string[] = [];
    const logger = {
      debug: (...a: unknown[]) => lines.push(inspect(a, { depth: 8 })),
      info: (...a: unknown[]) => lines.push(inspect(a, { depth: 8 })),
      warn: (...a: unknown[]) => lines.push(inspect(a, { depth: 8 })),
      error: (...a: unknown[]) => lines.push(inspect(a, { depth: 8 })),
    };
    mock.enqueue(
      {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
        body: { code: 'UNAUTHORIZED', status: 401, title: 'Unauthorized', detail: 'Invalid API key.' },
      },
      { status: 500, body: 'oops' },
    );
    const { client } = restClient(mock.baseUrl, { apiKey: secretKey, logger, maxRetries: 0 });
    const errors: unknown[] = [];
    errors.push(await client.articles.search().catch((e) => e));
    errors.push(await client.articles.search().catch((e) => e));
    const net = new FinlightClient({
      apiKey: secretKey,
      baseUrl: 'http://127.0.0.1:9',
      logger,
      maxRetries: 0,
    });
    errors.push(await net.articles.search().catch((e) => e));
    const all = [
      ...lines,
      ...errors.map((e) => inspect(e, { depth: 8, showHidden: true })),
      ...errors.map((e) => String((e as Error).message)),
      inspect(client, { depth: 8, showHidden: true }),
      JSON.stringify(client),
      String(client),
    ].join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(secretKey);
  });

  test('creating a client installs no global handlers', () => {
    const events = [
      'SIGINT',
      'SIGTERM',
      'exit',
      'beforeExit',
      'uncaughtException',
      'unhandledRejection',
    ] as const;
    const before = events.map((e) => process.listenerCount(e));
    const client = new FinlightClient({ apiKey: 'k' });
    client.stream({ query: 'x' });
    expect(events.map((e) => process.listenerCount(e))).toEqual(before);
  });

  test('without a logger the SDK writes nothing to stdout or stderr', async () => {
    const out = jest.spyOn(process.stdout, 'write');
    const err = jest.spyOn(process.stderr, 'write');
    mock.enqueue({ status: 500, body: 'x' }, page([]));
    const { client } = restClient(mock.baseUrl);
    await client.articles.search();
    await flushIo();
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    out.mockRestore();
    err.mockRestore();
  });
});
