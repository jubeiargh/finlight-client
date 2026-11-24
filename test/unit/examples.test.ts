import { createHmac } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpMock } from '../helpers/http-mock';
import { waitFor } from '../helpers/fake-clock';
import { KIT_API_KEY, loadFixture } from '../helpers/kit';
import { WsMock } from '../helpers/ws-mock';

// R-TEST-1: the five standard examples run against the local mocks.
let mock: HttpMock;
let ws: WsMock;
let log: jest.SpyInstance;

beforeAll(async () => {
  mock = await new HttpMock().start();
  ws = await new WsMock().start();
  process.env.FINLIGHT_API_KEY = KIT_API_KEY;
  process.env.FINLIGHT_BASE_URL = mock.baseUrl;
  process.env.FINLIGHT_WSS_URL = ws.url;
});
afterAll(async () => {
  await mock.stop();
  await ws.stop();
  delete process.env.FINLIGHT_API_KEY;
  delete process.env.FINLIGHT_BASE_URL;
  delete process.env.FINLIGHT_WSS_URL;
});
beforeEach(() => {
  mock.reset();
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => log.mockRestore());

const SEARCH = loadFixture('fixtures/requests/search-all-parameters.json').response;
const PAGES = loadFixture('fixtures/pagination/three-pages.json').steps.map((s: any) => s.response);

test('example: search', async () => {
  mock.enqueue(SEARCH);
  const { main } = await import('../../examples/search');
  await main();
  expect(JSON.parse(mock.requests[0].body)).toEqual({
    query: 'ticker:NVDA',
    languages: ['en'],
    include: ['companies', 'events'],
    limit: 10,
  });
  expect(log.mock.calls.length).toBe(6);
});

test('example: searchAll', async () => {
  mock.enqueue(...PAGES);
  const { main } = await import('../../examples/search-all');
  await main();
  expect(mock.requests).toHaveLength(3);
  expect(log.mock.calls.at(-1)?.[0]).toBe('5 articles from 3 pages');
});

test('example: lookup', async () => {
  const byLink = loadFixture('fixtures/requests/get-by-link.json').response;
  const companies = loadFixture('fixtures/requests/companies-search.json').response;
  const company = loadFixture('fixtures/requests/companies-get.json').response;
  const sources = loadFixture('fixtures/requests/sources-list-full.json').response;
  mock.enqueue(byLink, byLink, companies, company, sources);
  const { main } = await import('../../examples/lookup');
  await main(byLink.body.article.link);
  expect(mock.requests.map((r) => r.path)).toEqual([
    '/v3/articles/by-link',
    `/v3/articles/${byLink.body.article.id}`,
    '/v3/companies',
    '/v3/companies/900001',
    '/v3/sources',
  ]);
});

test('example: stream', async () => {
  const article = loadFixture('fixtures/decode/full-article.json').wire;
  const { main } = await import('../../examples/stream');
  const done = main(2);
  const dial = await ws.nextDial();
  await dial.conn!.next();
  dial.conn!.send({
    event: 'connection.admitted',
    payloadVersion: 3,
    data: { leaseId: 'l', serverNow: 1, clientNonce: 'c' },
  });
  dial.conn!.send({ event: 'article.created', payloadVersion: 3, data: article });
  dial.conn!.send({ event: 'article.updated', payloadVersion: 3, data: { ...article, title: 'Updated' } });
  await done;
  await waitFor(() => dial.conn!.closedCode === 1000, 'socket closed');
  expect(log.mock.calls.map((c) => c[0])).toContain('updated: Updated');
});

test('example: webhook endpoint', async () => {
  const f = loadFixture('fixtures/webhook/created-enriched.json');
  const { createHandler } = await import('../../examples/webhook-endpoint');
  const events: string[] = [];
  const handler = createHandler(f.secret, (e) => {
    events.push(e.eventId);
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const send = (body: Buffer, headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(body);
    });
  try {
    const body = Buffer.from(JSON.stringify({ ...JSON.parse(f.request.rawBody) }));
    const ts = new Date().toISOString();
    const signature = `sha256=${createHmac('sha256', f.secret).update(`${ts}.`).update(body).digest('hex')}`;
    const headers = {
      'content-type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': ts,
    };
    expect(await send(body, headers)).toBe(204);
    expect(await send(body, headers)).toBe(204); // duplicate delivery
    await waitFor(() => events.length === 1, 'event handled');
    expect(events).toEqual([JSON.parse(f.request.rawBody).eventId]);
    expect(await send(body, { ...headers, 'x-webhook-signature': 'sha256=00' })).toBe(400);
    // A v2 body with a valid signature is acknowledged with 2xx.
    const v2 = Buffer.from(JSON.stringify({ link: 'https://x', title: 't' }));
    const v2sig = `sha256=${createHmac('sha256', f.secret).update(`${ts}.`).update(v2).digest('hex')}`;
    expect(await send(v2, { ...headers, 'x-webhook-signature': v2sig })).toBe(204);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
