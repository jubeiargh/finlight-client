# {{title}}

{{langLinks}}

> **Breaking release.** {{breaking}}

{{translationNote}}

{{intro}}

## {{h_versions}}

| {{v_sdk}} | {{v_api}} | {{v_status}} |
|---|---|---|
| 4.x | v3 (`/v3`, WebSocket `payloadVersion` 3, webhooks v3) | {{v_current}} |
| 3.x | v1/v2 | {{v_old}} |

{{versionsIndependent}}

{{versionsNote}}

## {{h_requirements}}

- Node.js >= 20 ({{req_node}})
- TypeScript >= 5.0 ({{req_ts}})
- `ws` >= 8.18 ({{req_ws}})

## {{h_installation}}

```bash
npm install finlight-client@^4
```

## {{h_quickstart}}

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

{{quickstartNote}}

## {{h_search}}

{{searchIntro}}

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

{{searchNotes}}

## {{h_lookups}}

```ts
import { cacheInfo } from 'finlight-client';

const article = await client.articles.get('pXhK9f2aQ1mZ0bT7cY3rLw', { include: ['content'] });
const byLink = await client.articles.getByLink('https://www.reuters.com/markets/example', { include: ['companies'] });

const [nvidia] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
const many = await client.companies.getMany([4821, 1234]);
const record = await client.companies.get(4821); // no SDK cache: every call costs 1 credit
console.log(cacheInfo(record)?.etag, many.skipped.length);

// You keep the record; pass its ETag back. null means "not modified" (still 1 credit)
const fresh = await client.companies.get(4821, { ifNoneMatch: '"80b88d6b…"' });

const sources = await client.sources.list();
```

{{lookupNotes}}

## {{h_presence}}

{{presenceIntro}}

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

{{presenceNotes}}

## {{h_streams}}

{{streamsIntro}}

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
  if (item.kind === 'created' || item.kind === 'updated') console.log(item.kind, item.data?.title);
  // item.kind === 'other': an event this SDK version does not know yet; rawJson(item) has the frame
}

// Raw: the article skeleton before enrichment; no include
for await (const item of client.rawStream({ query: 'source:www.reuters.com' })) {
  console.log(item.data?.firstSeenAt, item.data?.title);
}
```

{{streamsLimits}}

## {{h_webhooks}}

{{webhooksIntro}}

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

{{rawBody}}

{{webhooksNotes}}

## {{h_errors}}

```ts
import { isFinlightApiError, NotFoundError, RateLimitedError } from 'finlight-client';

try {
  await client.articles.search({ eventTypes: ['earnigns'] });
} catch (err) {
  if (err instanceof RateLimitedError && err.limitType === 'monthly') {
    console.log('quota used up for this period');
  } else if (err instanceof NotFoundError) {
    console.log('not found');
  } else if (isFinlightApiError(err)) {
    console.log(err.status, err.code, err.apiKind, err.detail, err.requestId);
    for (const e of err.errors) console.log(e.field, e.issue, e.allowedValues);
  }
}
```

{{errorsNotes}}

```text
FinlightError                    kind
├── FinlightApiError             api (apiKind: one per problem code, or other)
│   ├── ValidationFailedError    validation_failed
│   ├── CursorInvalidError       cursor_invalid
│   ├── CursorMismatchError      cursor_mismatch
│   ├── UnauthorizedError        unauthorized
│   ├── ForbiddenError           forbidden
│   ├── NotFoundError            not_found
│   ├── RateLimitedError         rate_limited (limitType, retryAfterMs)
│   └── InternalServerError      internal_error
├── FinlightValidationError      validation
├── FinlightNetworkError         network
│   └── FinlightTimeoutError     timeout
├── FinlightDecodeError          decode
├── WebhookVerificationError     webhook_verification
└── PreemptedError               preempted
```

{{retryIntro}}

| {{e_case}} | {{e_retry}} |
|---|---|
| 400, 401, 403, 404 | {{e_never}} |
| 429 monthly / unknown | {{e_never}} |
| 429 burst | {{e_burst}} |
| 5xx, {{e_network}} | {{e_backoff}} |

{{cancelNote}}

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.articles.search({ query: 'ticker:TSLA' }, { signal: controller.signal });
```

## {{h_config}}

| {{c_option}} | {{c_default}} | {{c_meaning}} |
|---|---|---|
| `apiKey` | - | {{cfg_apiKey}} |
| `baseUrl` | `https://api.finlight.me` | {{cfg_baseUrl}} |
| `wssUrl` | `wss://wss.finlight.me` | {{cfg_wssUrl}} |
| `timeoutMs` | `30000` | {{cfg_timeoutMs}} |
| `totalTimeoutMs` | - | {{cfg_totalTimeoutMs}} |
| `maxRetries` | `3` | {{cfg_maxRetries}} |
| `retryBaseDelayMs` / `retryMaxDelayMs` | `500` / `8000` | {{cfg_retryDelays}} |
| `retryOnBurst` | `'once'` | {{cfg_retryOnBurst}} |
| `burstWaitMs` | `10000` | {{cfg_burstWaitMs}} |
| `maxPages` | `10` | {{cfg_maxPages}} |
| `maxResponseBytes` | `33554432` (32 MiB) | {{cfg_maxResponseBytes}} |
| `pingIntervalMs` / `watchdogTimeoutMs` / `rotationIntervalMs` | `25000` / `60000` / `6900000` | {{cfg_liveness}} |
| `reconnectBaseDelayMs` / `reconnectMaxDelayMs` | `1000` / `30000` | {{cfg_reconnect}} |
| `longBackoffMs` | `60000` | {{cfg_longBackoff}} |
| `quotaReconnect` / `quotaReconnectIntervalMs` | `true` / `3600000` | {{cfg_quota}} |
| `searchFailedThreshold` | `5` | {{cfg_searchFailedThreshold}} |
| `dedupeCacheSize` | `1000` | {{cfg_dedupe}} |
| `maxMessageBytes` | `33554432` (32 MiB, min. 16 MiB) | {{cfg_maxMessageBytes}} |
| `connectTimeoutMs` | `30000` | {{cfg_connectTimeout}} |
| `fetch` / `wsAgent` | - | {{cfg_transport}} |
| `logger` | - | {{cfg_logger}} |
| `clock` | - | {{cfg_clock}} |

## {{h_logging}}

{{loggingNotes}}

## {{h_data}}

{{dataNotes}}

<a id="migration"></a>

## {{h_migration}}

{{migrationIntro}}

| 3.x (API v2) | 4.x (API v3) |
|---|---|
| `new FinlightApi({ apiKey })` | `new FinlightClient({ apiKey })` |
| `articles.fetchArticles(...)` | `articles.search(...)`, `articles.searchAll(...)` |
| `articles.fetchArticleByLink(...)` | `articles.getByLink(link)`, `articles.get(id)` |
| `sources.getSources()` | `sources.list()` |
| `client.websocket.connect(params, onArticle)`, `stop()` | `for await (const item of client.stream(params))`, `stream.close()` |
| {{mig_rawWs}} | `client.rawStream(params)` |
| `WebhookService.constructEvent(body, signature, secret, timestamp)` | `Webhooks.constructEvent(rawBody, headers, secret)` or `Webhooks.constructEventFromValues(rawBody, signature, timestamp, secret)` |
| `logLevel` | {{mig_logLevel}} |
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
| {{mig_webhookBody}} | `event.data` + `event.eventId` |

{{webhookSwitch}}

## {{h_development}}

```bash
npm ci
npm test                      # unit and conformance tests, no network, no keys
npm run conformance:check     # vendored kit matches conformance/MANIFEST
npm run conformance:sync -- --from <monorepo>/shared/contracts/api-v3
FINLIGHT_API_KEY=... FINLIGHT_BASE_URL=https://api.dev.finlight.me \
  FINLIGHT_WSS_URL=wss://wss.dev.finlight.me npm run test:live
```

{{developmentNotes}}

## {{h_license}}

MIT
