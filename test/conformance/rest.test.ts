import { cacheInfo } from '../../src/companies';
import {
  CursorInvalidError,
  CursorMismatchError,
  FinlightApiError,
  FinlightValidationError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../src/errors';
import { rawJson } from '../../src/internal/raw';

const SUBCLASS: Record<string, any> = {
  validation_failed: ValidationFailedError,
  cursor_invalid: CursorInvalidError,
  cursor_mismatch: CursorMismatchError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  not_found: NotFoundError,
  rate_limited: RateLimitedError,
  internal_error: InternalServerError,
};
import { contentPresent } from '../../src/models';
import { HttpMock } from '../helpers/http-mock';
import { queryPairs, restClient, transport } from '../helpers/clients';
import { caseName, listFixtures, loadFixture } from '../helpers/kit';

let mock: HttpMock;

beforeAll(async () => {
  mock = await new HttpMock().start();
});
afterAll(async () => {
  await mock.stop();
});
beforeEach(() => mock.reset());

function serve(response: any): void {
  mock.enqueue({ status: response.status, headers: response.headers, body: response.body });
}

/** Method, path, decoded query, JSON body and API key header must equal the fixture. */
function expectRequest(index: number, expected: any): void {
  const got = mock.requests[index];
  expect(got.method).toBe(expected.method);
  expect(got.path).toBe(expected.path);
  expect(queryPairs(got.query)).toEqual(queryPairs(expected.query));
  if (expected.body !== undefined) {
    expect(JSON.parse(got.body)).toEqual(expected.body);
    expect(got.headers['content-type']).toContain('application/json');
  } else {
    expect(got.body).toBe('');
  }
  expect(got.headers['x-api-key']).toBe(expected.headers['X-API-KEY']);
  if (expected.query) expect(got.query).not.toMatch(/%5B%5D=|\[\]=/);
}

describe('R: requests', () => {
  test(caseName('R-01'), async () => {
    const f = loadFixture('fixtures/requests/search-minimal.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const page = await client.articles.search(f.sdk.args);
    expectRequest(0, f.request);
    expect(mock.requests[0].body).toBe('{"query":"ticker:XMPL"}');
    expect(page.articles.map((a) => a.id)).toEqual(f.response.body.articles.map((a: any) => a.id));
    expect(page.pagination).toEqual(f.response.body.pagination);
  });

  test(caseName('R-02'), async () => {
    const f = loadFixture('fixtures/requests/search-all-parameters.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const args = { ...f.sdk.args, from: new Date(f.sdk.args.from), to: f.sdk.args.to };
    const page = await client.articles.search(args);
    expectRequest(0, f.request);
    const body = JSON.parse(mock.requests[0].body);
    expect(Number.isInteger(body.limit)).toBe(true);
    expect(body.from).toBe('2026-11-01T00:00:00.000Z');
    expect(page.articles).toHaveLength(5);
  });

  test(caseName('R-03'), async () => {
    const f = loadFixture('fixtures/requests/search-no-parameters.json');
    serve(f.response);
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    await client.articles.search(f.sdk.args);
    await client.articles.search();
    expectRequest(0, f.request);
    expect(mock.requests[0].body).toBe('{}');
    expect(mock.requests[1].body).toBe('{}');
  });

  test(caseName('R-04'), async () => {
    const f = loadFixture('fixtures/requests/get-by-id.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const article = await client.articles.get(f.sdk.args.id, { include: f.sdk.args.include });
    expectRequest(0, f.request);
    expect(mock.requests[0].params.get('include')).toBe('content,events');
    expect(article.id).toBe(f.sdk.args.id);
    expect(contentPresent(article)).toBe(true);
  });

  test(caseName('R-05'), async () => {
    const f = loadFixture('fixtures/requests/get-by-link.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const article = await client.articles.getByLink(f.sdk.args.link, { include: f.sdk.args.include });
    expectRequest(0, f.request);
    expect(mock.requests[0].params.getAll('link')).toEqual([f.sdk.args.link]);
    expect(article.link).toBe(f.sdk.args.link);
  });

  test(caseName('R-06'), async () => {
    const f = loadFixture('fixtures/requests/companies-search.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const companies = await client.companies.search(f.sdk.args);
    expectRequest(0, f.request);
    expect(companies.map((c) => c.companyId)).toEqual([900001]);
  });

  test(caseName('R-07'), async () => {
    const f = loadFixture('fixtures/requests/companies-get-many.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const companies = await client.companies.getMany(f.sdk.args.ids);
    expectRequest(0, f.request);
    expect(mock.requests[0].params.get('ids')).toBe('900001,900002');
    const priv = companies.find((c) => c.companyId === 900002);
    expect(priv?.primaryListing).toBeNull();
    expect(priv?.listings).toEqual([]);
    expect(companies.map((c) => c.companyId).sort()).toEqual([900001, 900002]);
  });

  test(caseName('R-08'), async () => {
    const f = loadFixture('fixtures/requests/companies-get.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const record = await client.companies.get(f.sdk.args.companyId);
    expectRequest(0, f.request);
    expect(record.companyId).toBe(900001);
    const mics = record.listings.map((l) => l.mic);
    expect(new Set(mics).size).toBe(mics.length);
    expect(record.listings[0].mic).toBe(record.primaryListing?.mic);
    expect(record.listings).toEqual(f.response.body.company.listings);
    expect(cacheInfo(record)).toEqual({
      etag: f.response.headers.etag,
      cacheControl: f.response.headers['cache-control'],
      notModified: false,
    });
  });

  test(caseName('R-09'), async () => {
    const first = loadFixture('fixtures/requests/companies-get.json');
    const f = loadFixture('fixtures/requests/companies-get-not-modified.json');
    serve(first.response);
    serve(f.response);
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const record = await client.companies.get(900001);
    // Explicit If-None-Match, as in the fixture.
    const again = await client.companies.get(f.sdk.args.companyId, { ifNoneMatch: f.sdk.args.ifNoneMatch });
    expectRequest(1, f.request);
    expect(mock.requests[1].headers['if-none-match']).toBe(f.request.headers['If-None-Match']);
    // fetch would add Cache-Control: no-cache, which makes the server skip the 304.
    expect(mock.requests[1].headers['cache-control'] ?? '').not.toMatch(/no-cache/);
    // A caller-supplied ETag: "not modified" is null, never an error.
    expect(again).toBeNull();
    // Automatic revalidation with the SDK's own cached ETag returns the cached record.
    const third = await client.companies.get(900001);
    expect(cacheInfo(third)?.notModified).toBe(true);
    expect(mock.requests[2].headers['if-none-match']).toBe(f.request.headers['If-None-Match']);
    expect(third).toBe(record);
  });

  test(caseName('R-10'), async () => {
    const f = loadFixture('fixtures/requests/sources-list-full.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const sources = await client.sources.list();
    expectRequest(0, f.request);
    expect(sources.map((s) => s.hasContent)).toEqual([false, true, true]);
    expect(sources.find((s) => s.domain === 'custom.example.net')?.isCustom).toBe(true);
    expect(sources.map((s) => s.domain)).toEqual(f.response.body.sources.map((s: any) => s.domain));
  });

  test(caseName('R-11'), async () => {
    const f = loadFixture('fixtures/requests/sources-list-basic.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl, { apiKey: f.request.headers['X-API-KEY'] });
    const sources = await client.sources.list();
    expectRequest(0, f.request);
    for (const s of sources) {
      expect('hasContent' in s).toBe(false);
      expect(s.hasContent).toBeUndefined();
    }
    expect(sources.some((s) => s.isCustom)).toBe(false);
  });

  test(caseName('R-12'), async () => {
    const f = loadFixture('fixtures/requests/search-unknown-key.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    await expect(client.articles.search(f.sdk.args)).rejects.toThrow(FinlightValidationError);
    await expect(client.articles.search(f.sdk.args)).rejects.toThrow(/"eventType"/);
    expect(() => client.articles.searchAll(f.sdk.args)).toThrow(/"eventType"/);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('P: pagination', () => {
  test(caseName('P-01'), async () => {
    const f = loadFixture('fixtures/pagination/three-pages.json');
    for (const step of f.steps) serve(step.response);
    const { client } = restClient(mock.baseUrl);
    const args = { ...f.sdk.args, sources: [...f.sdk.args.sources] };
    const result = client.articles.searchAll(args);
    args.sources.push('mutated.example.org'); // must not change later pages
    const ids: string[] = [];
    for await (const article of result) ids.push(article.id);

    expect(mock.requests).toHaveLength(3);
    f.steps.forEach((step: any, i: number) => expectRequest(i, step.request));
    const page1 = mock.requests[0].body;
    for (let i = 1; i < 3; i++) {
      const cursor = f.steps[i].request.body.cursor;
      expect(mock.requests[i].body).toBe(JSON.stringify({ ...JSON.parse(page1), cursor }));
    }
    expect(ids).toEqual(f.steps.flatMap((s: any) => s.response.body.articles.map((a: any) => a.id)));
    expect(ids).toHaveLength(5);
    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(false);
    // Each page is its own logical call with its own X-Request-Id.
    expect(new Set(mock.requests.map((r) => r.headers['x-request-id'])).size).toBe(3);
  });

  test(caseName('P-02'), async () => {
    const f = loadFixture('fixtures/pagination/resize-and-reproject.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const page = await client.articles.search(f.request.body);
    expectRequest(0, f.request);
    expect(page.articles).toHaveLength(3);
    expect(page.articles.every((a) => contentPresent(a))).toBe(true);
  });

  for (const [id, file] of [
    ['P-03', 'injected-to.json'],
    ['P-04', 'injected-default-languages.json'],
    ['P-05', 'changed-order.json'],
  ] as const) {
    test(caseName(id), async () => {
      const f = loadFixture(`fixtures/pagination/${file}`);
      // The pager never injects keys: page 2 is page 1 plus the cursor only.
      const three = loadFixture('fixtures/pagination/three-pages.json');
      serve(three.steps[0].response);
      serve(three.steps[1].response);
      serve(three.steps[2].response);
      const { client } = restClient(mock.baseUrl);
      for await (const _ of client.articles.searchAll({
        sources: ['news.example.com', 'news.example.de'],
        limit: 2,
      })) {
        // drain
      }
      for (const r of mock.requests.slice(1)) {
        expect(Object.keys(JSON.parse(r.body)).sort()).toEqual(['cursor', 'limit', 'sources']);
      }
      mock.reset();
      // The server answer for a changed body is a terminal CURSOR_MISMATCH.
      serve(f.response);
      const err = await client.articles.search(f.request.body).catch((e) => e);
      expectRequest(0, f.request);
      expect(err).toBeInstanceOf(FinlightApiError);
      expect(err.code).toBe('CURSOR_MISMATCH');
      expect(err.apiKind).toBe('cursor_mismatch');
      expect(err.errors[0].field).toBe('cursor');
      expect(mock.requests).toHaveLength(1);
      if (id === 'P-05') expect(err.detail).toMatch(/publishedAt:desc.*publishedAt:asc/);
    });
  }

  test(caseName('P-06'), async () => {
    const f = loadFixture('fixtures/pagination/reordered-list.json');
    serve(f.response);
    const { client } = restClient(mock.baseUrl);
    const page = await client.articles.search(f.request.body);
    expectRequest(0, f.request);
    expect(page.pagination.hasMore).toBe(true);
    expect(page.pagination.nextCursor).toBe(f.response.body.pagination.nextCursor);
  });
});

const ERROR_CASES = listFixtures('fixtures/errors').filter((f) => !f.endsWith('retry-classes.json'));

describe('E: errors and retry classes', () => {
  const byId = new Map<string, string>();
  for (const file of ERROR_CASES) byId.set(loadFixture(file).id, file);
  const ids = [...byId.keys()].sort();

  test('every error fixture is a numbered case', () => {
    expect(ids).toHaveLength(25);
  });

  for (const id of ids) {
    test(caseName(id), async () => {
      const f = loadFixture(byId.get(id) as string);
      mock.always({ status: f.response.status, headers: f.response.headers, body: f.response.body });
      const { http, clock } = transport(mock.baseUrl, f.request.headers['X-API-KEY'] ?? 'sk_missing');
      const query = f.request.query ? [...new URLSearchParams(f.request.query).entries()] : undefined;
      const req: any = { method: f.request.method, path: f.request.path };
      if (query) req.query = query;
      if (f.request.body !== undefined) req.body = JSON.stringify(f.request.body);
      if (f.request.rawBody !== undefined) req.rawBody = f.request.rawBody;
      if (f.request.headers['X-Request-Id']) req.requestId = f.request.headers['X-Request-Id'];

      const err = await http.request(req).then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(FinlightApiError);
      expect(err.kind).toBe('api');
      expect(err.status).toBe(f.response.status);

      const expected = f.expect;
      if (expected.code === 'NESTJS_FALLBACK') {
        expect(err.code).toBeNull();
        expect(err.detail).toBe(f.response.body.message);
      } else {
        expect(err.code).toBe(expected.code);
      }
      // apiKind and the subclass of that kind.
      expect(err.apiKind).toBe(expected.apiKind);
      const subclass = SUBCLASS[expected.apiKind];
      if (subclass) expect(err).toBeInstanceOf(subclass);
      else expect(err.constructor).toBe(FinlightApiError);
      // raw is the body as received; rawJson() gives the parsed tree.
      const bodyText =
        typeof f.response.body === 'string' ? f.response.body : JSON.stringify(f.response.body);
      expect(err.raw).toBe(bodyText);
      if (typeof f.response.body === 'object') expect(rawJson(err)).toEqual(f.response.body);
      // requestId: the server value, else the X-Request-Id the SDK sent.
      const serverId = typeof f.response.body === 'object' ? f.response.body?.requestId : undefined;
      const sentId = mock.requests[0].headers['x-request-id'];
      expect(err.requestId).toBe(serverId ?? sentId);
      if (f.request.headers['X-Request-Id']) expect(sentId).toBe(f.request.headers['X-Request-Id']);
      if (Array.isArray(f.response.body?.errors)) {
        expect(err.errors).toEqual(
          f.response.body.errors.map((e: any) => ({
            field: e.field,
            issue: e.issue,
            ...(e.allowedValues ? { allowedValues: e.allowedValues } : {}),
          })),
        );
      }

      // Retry class, counted by the mock; the X-Request-Id stays the same on retries.
      const attempts = mock.requests.length;
      if (expected.retry === 'never') expect(attempts).toBe(1);
      if (expected.retry === 'backoff') {
        expect(attempts).toBe(4);
        expect(clock.sleeps.length).toBe(3);
      }
      if (expected.retry === 'once-after-burst-wait') {
        expect(attempts).toBe(2);
        // Exactly Retry-After (7 s here); 10 s only without the header.
        const retryAfter = Number(f.response.headers['retry-after']);
        expect(clock.sleeps).toEqual([Number.isFinite(retryAfter) ? retryAfter * 1000 : 10_000]);
        expect(err.retryAfterMs).toBe(retryAfter * 1000);
      }
      expect(new Set(mock.requests.map((r) => r.headers['x-request-id'])).size).toBe(1);

      if (id === 'E-18') {
        expect(err.limitType).toBe('monthly');
        expect(err.retryAfterMs).toBeNull();
        expect(clock.sleeps).toEqual([]);
      }
      if (id === 'E-19') expect(err.limitType).toBe('burst');
      if (id === 'E-20') expect(err.detail).toBe('The request could not be processed.');
      if (id === 'E-24') {
        expect(err.code).toBeNull();
      }
      if (id === 'E-23') expect(err.requestId).toMatch(/^req_/);
      if (id === 'E-02') expect(err.detail).toMatch(/^\d+ request fields are not valid\.$/);
    });
  }
});
