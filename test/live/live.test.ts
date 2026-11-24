/*
 * Live smoke tests (R-TEST-2). They run only with all three variables set and never against
 * production:
 *   FINLIGHT_API_KEY=... FINLIGHT_BASE_URL=https://api.dev.finlight.me \
 *   FINLIGHT_WSS_URL=wss://wss.dev.finlight.me npm run test:live
 * The load is small: about 12 REST calls and two short stream connections.
 */
import {
  cacheInfo,
  FinlightApiError,
  FinlightClient,
  companiesPresent,
  eventsPresent,
  type Article,
  type StreamEvent,
} from '../../src/index';

const { FINLIGHT_API_KEY: apiKey, FINLIGHT_BASE_URL: baseUrl, FINLIGHT_WSS_URL: wssUrl } = process.env;
const PROD_HOSTS = ['api.finlight.me', 'wss.finlight.me'];

function isProd(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return PROD_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const configured = Boolean(apiKey && baseUrl && wssUrl);
if (configured && (isProd(baseUrl) || isProd(wssUrl))) {
  throw new Error('live tests refuse production hosts; point FINLIGHT_BASE_URL/FINLIGHT_WSS_URL at dev');
}
const live = configured ? describe : describe.skip;

live('live smoke against dev', () => {
  let client: FinlightClient;
  beforeAll(() => {
    client = new FinlightClient({
      apiKey: apiKey as string,
      baseUrl: baseUrl as string,
      wssUrl: wssUrl as string,
    });
  });
  let first: Article | undefined;

  test('sources.list', async () => {
    const sources = await client.sources.list();
    expect(sources.length).toBeGreaterThan(0);
    expect(typeof sources[0].domain).toBe('string');
  });

  test('articles.search with include', async () => {
    const page = await client.articles.search({ limit: 3, include: ['companies', 'events'] });
    expect(page.articles.length).toBeGreaterThan(0);
    expect(page.skipped).toEqual([]);
    first = page.articles[0];
    // Gated blocks are either present (entitled) or absent, never coerced.
    for (const a of page.articles) {
      if (companiesPresent(a)) expect(Array.isArray(a.companies)).toBe(true);
      if (eventsPresent(a)) expect(Array.isArray(a.events)).toBe(true);
    }
  });

  test('articles.searchAll walks two small pages', async () => {
    const result = client.articles.searchAll({ limit: 2 }, { maxPages: 2 });
    const ids: string[] = [];
    for await (const a of result) ids.push(a.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.pagesFetched).toBeLessThanOrEqual(2);
  });

  test('articles.get and getByLink', async () => {
    expect(first).toBeDefined();
    const byId = await client.articles.get(first!.id);
    expect(byId.link).toBe(first!.link);
    const byLink = await client.articles.getByLink(first!.link, { include: ['content'] });
    expect(byLink.id).toBe(first!.id);
  });

  test('an unknown id is a NOT_FOUND error', async () => {
    const err = await client.articles.get('AAAAAAAAAAAAAAAAAAAAAA').catch((e) => e);
    expect(err).toBeInstanceOf(FinlightApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.requestId).toBeTruthy();
  });

  test('a server-side validation error is a VALIDATION_FAILED problem', async () => {
    const err = await client.articles.search({ eventTypes: ['earnigns'], limit: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(FinlightApiError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.errors[0].allowedValues).toContain('earnings');
  });

  test('companies.search and get with ETag revalidation (or FORBIDDEN without entityAccess)', async () => {
    try {
      const hits = await client.companies.search({ q: 'NVDA' });
      expect(hits.length).toBeGreaterThan(0);
      const record = await client.companies.get(hits[0].companyId);
      const again = await client.companies.get(hits[0].companyId);
      expect(again.companyId).toBe(record.companyId);
      expect(again).toBe(record);
      expect(cacheInfo(again)?.notModified).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(FinlightApiError);
      expect((err as FinlightApiError).code).toBe('FORBIDDEN');
    }
  });

  test('an invalid key is UNAUTHORIZED on REST and a terminal 401 on the stream', async () => {
    const bad = new FinlightClient({
      apiKey: 'sk_invalid_live_test',
      baseUrl: baseUrl as string,
      wssUrl: wssUrl as string,
    });
    const err = await bad.sources.list().catch((e) => e);
    // /v3/sources is not behind the key check on every deployment; accept either outcome there.
    if (err instanceof FinlightApiError) expect(err.status).toBe(401);
    const search = await bad.articles.search({ limit: 1 }).catch((e) => e);
    expect(search).toBeInstanceOf(FinlightApiError);
    expect(search.status).toBe(401);
    const stream = bad.stream({});
    const result = await (async () => {
      for await (const _ of stream) {
        // nothing expected
      }
    })().catch((e) => e);
    expect(result).toBeInstanceOf(FinlightApiError);
    expect(result.status).toBe(401);
  });

  test('enriched stream: admitted and the initial push', async () => {
    const admitted: string[] = [];
    const errors: string[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('no initial push within 30 s')), 30_000);
    const stream = client.stream(
      { includeUpdates: false },
      {
        signal: controller.signal,
        onAdmitted: (a) => admitted.push(a.leaseId ?? ''),
        onError: (e) => errors.push(e.message),
      },
    );
    let item: StreamEvent | undefined;
    try {
      for await (const ev of stream) {
        item = ev;
        break;
      }
    } finally {
      clearTimeout(timer);
    }
    expect(admitted.length).toBe(1);
    expect(item?.kind).toBe('created');
    expect(typeof item?.article?.id).toBe('string');
    expect(stream.closed).toBe(true);
    expect(errors).toEqual([]);
  });

  test('raw stream: admitted, then a clean close', async () => {
    const admitted: string[] = [];
    const stream = client.rawStream({}, { onAdmitted: (a) => admitted.push(a.leaseId ?? '') });
    const done = (async () => {
      for await (const _ of stream) {
        // raw has no initial push
      }
    })();
    const start = Date.now();
    while (admitted.length === 0 && Date.now() - start < 20_000) await new Promise((r) => setTimeout(r, 100));
    await stream.close();
    await done;
    expect(admitted.length).toBe(1);
  });
});
