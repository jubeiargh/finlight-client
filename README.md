# finlight client for TypeScript and Node.js

*English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)*

> **Breaking change:** 4.x speaks finlight API v3 only (REST `/v3`, WebSocket `payloadVersion` 3, v3 webhooks). It is not compatible with 3.x code. Read the [migration section](#migration) and the [changelog](CHANGELOG.md) before you upgrade. To stay on API v2, pin `finlight-client@^3`.

Typed client for [finlight.me](https://finlight.me): search financial news, look up articles, companies and sources, follow live articles over WebSocket, and verify webhooks.

## Versions

| SDK major | finlight API | Status |
|---|---|---|
| 4.x | v3 (`/v3`, WebSocket `payloadVersion` 3, webhooks v3) | current |
| 3.x | v1/v2 | no further releases |

`^3` and `~3` never resolve to 4.x. Open ranges like `*` or `>=3` do, so pin a major.

## Requirements

- Node.js >= 20 (the SDK uses the built-in `fetch`)
- TypeScript >= 5.0 (only if you use TypeScript)
- `ws` >= 8.18 (installed with the SDK)

## Install

```bash
npm install finlight-client@^4
```

## Quick start

```ts
import { FinlightClient } from 'finlight-client';

const client = new FinlightClient({ apiKey: process.env.FINLIGHT_API_KEY! });

const page = await client.articles.search({
  query: 'ticker:NVDA AND eventType:earnings',
  languages: ['en'],
  include: ['companies', 'events'],
  limit: 20,
});
for (const article of page.articles) console.log(article.publishedAt, article.title);
```

The SDK sends only the parameters you set. It adds no defaults: the server decides `limit` (20), `languages` (`['en']`) and the time range. A parameter name the SDK does not know throws `FinlightValidationError` before any request, because the server would ignore it silently and still count the call.

## Search

`articles.search` returns one page. `articles.searchAll` walks the cursor for you.

```ts
// One page
const page = await client.articles.search({ tickers: ['AAPL'], orderBy: 'availableAt', order: 'desc' });
console.log(page.pagination.hasMore, page.pagination.nextCursor);

// Many pages: the request body is frozen, only the cursor changes
const result = client.articles.searchAll({ query: 'eventType:mna', limit: 100 }, { maxPages: 5 });
for await (const article of result) {
  console.log(article.id, article.title);
}
if (result.truncated) console.log('continue with cursor', result.nextCursor);

// Or page by page
for await (const p of client.articles.searchAll({ query: 'eventType:mna' }).pages()) {
  console.log(p.articles.length, p.skipped.length);
}
```

- `searchAll` freezes the request body at the call. Later pages only change `cursor`, so the cursor stays valid.
- It stops at `hasMore: false`, at `nextCursor: null` or after `maxPages` (default 10). At the limit it logs a warning, and `result.nextCursor` lets you continue.
- Every page is a metered call. A result can be iterated only once.
- `from` and `to` take a `Date` (sent as UTC with milliseconds) or a string (sent as is). They apply to the `orderBy` timestamp.
- Entries that cannot be decoded are skipped, logged and listed in `page.skipped`. The rest of the page stays usable.

## Lookups

```ts
const article = await client.articles.get('pXhK9f2aQ1mZ0bT7cY3rLw', { include: ['content'] });
const byLink = await client.articles.getByLink('https://www.reuters.com/markets/example', { include: ['companies'] });

const [nvidia] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
const many = await client.companies.getMany([4821, 1234]);
const record = await client.companies.get(4821); // ETag revalidation is built in

const sources = await client.sources.list();
```

- A 404 is a `FinlightApiError` with `apiKind: 'not_found'`, not an empty result.
- Articles indexed before the id rollout have no id lookup. Use `getByLink` for them.
- Company endpoints need the `entityAccess` entitlement, otherwise they answer 403.
- `companies.get` keeps the ETag and revalidates. On 304 you get the cached record; `cacheInfo(record)` shows the ETag.

## Absent, null and empty

Some keys depend on your plan and on `include`. A missing key, `null` and `[]` mean different things, and the SDK keeps them apart.

```ts
import { contentPresent, sentimentPresent, companiesPresent, eventsPresent, toDate } from 'finlight-client';

if (companiesPresent(article)) {
  // article.companies is Company[]; [] means "tagged, no company"
} else {
  // not requested, not in your plan, or the raw channel
}
if (contentPresent(article) && article.content === null) {
  // requested and entitled, but no text exists
}
const published: Date | null = toDate(article.publishedAt); // strict RFC 3339, null when unreadable
```

- Missing key: not requested, not in your plan, or the raw channel.
- `null`: requested and entitled, but there is no value (for example no text for `content`).
- `[]`: a real empty list (for example tagged, but no company found).
- This applies to `content`, `sentiment`, `companies`, `events`, `events[].companyIds` and `Source.hasContent`.
- Timestamps stay strings, exactly as sent. `toDate()` parses them strictly.
- Unknown keys from newer servers stay on the objects. `rawJson(value)` returns the JSON as received.

## Live streams

`client.stream()` follows enriched articles, `client.rawStream()` the raw skeleton before enrichment. Both connect on the first iteration. The SDK pings every 25 s, reconnects when no pong arrives for 60 s, renews the connection after 115 minutes, and drops duplicates.

```ts
const stream = client.stream(
  { query: 'ticker:NVDA', language: 'en', includeUpdates: true, include: ['companies', 'events'] },
  {
    onAdmitted: (a) => console.log('admitted', a.leaseId),
    onReconnect: (r) => console.log('reconnected', r.reason, 'last seen', r.lastSeenAt),
    onError: (e) => console.warn(e.message), // problems that do not end the stream
  },
);

for await (const item of stream) {
  if (item.kind === 'created' || item.kind === 'updated') console.log(item.kind, item.article?.title);
  // item.kind === 'other': an event this SDK version does not know yet (item.frame has it)
}

// Raw: the article skeleton before enrichment; no include
for await (const item of client.rawStream({ query: 'source:www.reuters.com' })) {
  console.log(item.article?.firstSeenAt, item.article?.title);
}
```

Things to know:

- **Connection limit.** Your plan's WebSocket limit is shared by enriched streams, raw streams and older SDK versions. Do not run old and new streams side by side. When the limit is reached the SDK waits at least 60 s and tries again; `{ takeover: true }` replaces your stalest connection instead.
- **Two hour limit.** The gateway ends every connection after 2 h. The SDK opens a new connection before that and re-subscribes.
- **Initial push.** After each subscribe the enriched stream sends the latest matching article. It can be old. The SDK drops it when it was already delivered on this stream.
- **Large frames.** Live frames over 32,000 bytes are dropped by the server without notice. This can happen with `include: ['content']` on long articles. Fetch the text with `articles.get(id, { include: ['content'] })` instead.
- `onAdmitted` fires before the server checks your subscribe. It does not mean the subscribe was accepted.
- The SDK does not backfill. `onReconnect` gives you `lastSeenAt` so you can fill gaps through REST.
- Leaving the loop, `stream.close()` or the abort signal closes the socket and stops all timers.
- A stream ends with an error for a refused key, a plan without WebSockets, an exhausted quota, an invalid subscribe and a preemption (`PreemptedError`). Other problems go to `onError` and the stream keeps running.
- `rawStream` has no `include` and no enrichment filters.

## Webhooks

`Webhooks.constructEvent(rawBody, headers, secret)` checks the signature and the timestamp (300 s tolerance by default), then reads the body. It returns a `WebhookEvent`, or a `WrongPayloadVersion` result for a correctly signed body in the old format.

```ts
import express from 'express';
import { Webhooks, WrongPayloadVersion, WebhookVerificationError } from 'finlight-client';

const app = express();
// Keep the body raw: never verify re-serialized JSON.
app.post('/finlight', express.raw({ type: 'application/json' }), (req, res) => {
  let result;
  try {
    result = Webhooks.constructEvent(req.body, req.headers, process.env.FINLIGHT_WEBHOOK_SECRET!);
  } catch (err) {
    return res.sendStatus(err instanceof WebhookVerificationError ? 400 : 500);
  }
  if (result instanceof WrongPayloadVersion) return res.sendStatus(204); // old format during the switch
  res.sendStatus(204); // answer within 5 s, work afterwards
  queue.push(result); // dedupe on result.eventId
});
```

The signature covers the raw bytes. Get them before any JSON parser runs:

- Express: `express.raw({ type: 'application/json' })` on the webhook route.
- Fastify: `addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`.
- Next.js route handler: `await request.text()`, and pass `request.headers`.
- `node:http`: collect the request chunks into a `Buffer`.

- Deliveries can repeat. Dedupe on `eventId`.
- Answer with 2xx within 5 s and do slow work afterwards.
- Never answer with 410: it disables the webhook at once.
- `isTest` is true for test deliveries from the dashboard.
- `Webhooks.verifySignature(rawBody, signature, timestamp, secret)` checks only the signature, for frameworks that hand you the two header values.
- The SDK does not manage webhooks. Create and change them in the finlight dashboard.

## Errors and retries

```ts
import { isFinlightApiError, FinlightValidationError, PreemptedError } from 'finlight-client';

try {
  await client.articles.search({ eventTypes: ['earnigns'] });
} catch (err) {
  if (isFinlightApiError(err)) {
    console.log(err.status, err.code, err.apiKind, err.detail, err.requestId);
    for (const e of err.errors) console.log(e.field, e.issue, e.allowedValues);
    if (err.limitType === 'monthly') console.log('quota used up for this period');
  }
}
```

Every SDK error extends `FinlightError` and has a `kind` field: `api`, `validation`, `network`, `timeout`, `decode`, `webhook_verification` or `preempted`. `FinlightApiError` carries `status`, `code`, `title`, `detail`, `requestId`, `errors[]` and `apiKind`. Each logical call sends its own `X-Request-Id`; retries reuse it. Retries:

| Answer | Retry |
|---|---|
| 400, 401, 403, 404 | never |
| 429 monthly / unknown | never |
| 429 burst | once, after `Retry-After` (10 s if missing); on by default, `retryOnBurst: 'off'` turns it off |
| 5xx, network errors, timeouts | up to 3 times with growing, jittered waits |

Every call takes an `AbortSignal`. An abort ends waits at once, is never retried, and rejects with the signal's reason.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.articles.search({ query: 'ticker:TSLA' }, { signal: controller.signal });
```

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | - | Required. |
| `baseUrl` | `https://api.finlight.me` | REST base URL. |
| `wssUrl` | `wss://wss.finlight.me` | WebSocket URL; raw uses `<wssUrl>/raw`. |
| `timeoutMs` | `30000` | Timeout of one HTTP attempt (ms). |
| `totalTimeoutMs` | - | Optional limit for a whole call, retries and waits included. |
| `maxRetries` | `3` | Retries for 5xx, network errors and timeouts. |
| `retryOnBurst` | `'once'` | `'once'` or `'off'` for 429 burst answers. |
| `burstWaitMs` | `10000` | Wait before the burst retry; at least 10000. |
| `maxPages` | `10` | Page limit of `searchAll`. |
| `pingIntervalMs` / `watchdogTimeoutMs` / `rotationIntervalMs` | `25000` / `60000` / `6900000` | Stream ping, pong watchdog and rotation. |
| `fetch` / `wsAgent` | - | Your own `fetch` (REST) and HTTP agent (WebSocket), e.g. for a proxy. Their own timeouts then apply; make sure they do not retry on their own. |
| `logger` | - | Any logger with `debug`/`info`/`warn`/`error`. |
| `clock` | - | Replaceable clock for tests. |

## Data notes

- Some old articles have `publishedAt` `1970-01-01T00:00:00.000Z` or an empty `summary`. The SDK delivers them as they are.
- On articles tagged before roles existed, `companies[].role` and `relevance` are `null`, and `events` is `[]`.
- Articles indexed before the id rollout answer 404 on `articles.get`; `getByLink` finds them.
- `availableAt` is always `null` on raw, and `null` for articles from before its rollout.

<a id="migration"></a>

## Migration from 3.x

The full guide is on [docs.finlight.me](https://docs.finlight.me). The main changes:

| 3.x (API v2) | 4.x (API v3) |
|---|---|
| `new FinlightApi({ apiKey })` | `new FinlightClient({ apiKey })` |
| `articles.fetchArticles(...)` | `articles.search(...)`, `articles.searchAll(...)` |
| `articles.fetchArticleByLink(...)` | `articles.getByLink(link)`, `articles.get(id)` |
| `sources.getSources()` | `sources.list()` |
| `client.websocket.connect(params, onArticle)`, `stop()` | `for await (const item of client.stream(params))`, `stream.close()` |
| raw WebSocket client | `client.rawStream(params)` |
| `WebhookService.constructEvent(body, signature, secret, timestamp)` | `Webhooks.constructEvent(rawBody, headers, secret)` |
| `logLevel` | configure levels in your own `logger` |
| `publishDate` | `publishedAt` |
| `createdAt` | `firstSeenAt` |
| `revisedDate` | `revisedAt` |
| `images: string[]` | `media: { url }[]` |
| `source: string` | `source.domain` |
| `sentiment`, `confidence` | `sentiment: { label, confidence }` |
| `includeContent`, `includeEntities` | `include: ['content', 'companies', 'events']` |
| `page`, `pageSize` | `limit`, `cursor` (`searchAll` pages for you) |
| `order: 'ASC' / 'DESC'` | `order: 'asc' / 'desc'` |
| `language: 'en'` | `languages: ['en']` |
| `isUpdate` | `article.updated` (`item.kind === 'updated'`) |
| webhook body = article | `event.data` + `event.eventId` |

Switching a webhook to v3:

1. Deploy the new SDK. Answer `WrongPayloadVersion` with 2xx and keep its `json` if you need the data.
2. Switch the webhook to `payloadVersion` 3 in the finlight dashboard.
3. Wait about 2 h. Retries that were already queued still arrive in the old format.

## Logging

The SDK is silent by default. Set `NODE_DEBUG=finlight` to see debug output, or pass `logger: console` (or pino, winston). It never logs the API key, the webhook secret, signatures or full bodies, and it installs no process handlers.

## License

MIT
