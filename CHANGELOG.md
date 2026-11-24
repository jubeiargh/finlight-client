# Changelog

## 4.0.0 (unreleased)

**Breaking: 4.x speaks finlight API v3 only.** REST `/v3`, WebSocket `payloadVersion` 3 and v3 webhooks. Code written for 3.x does not compile against 4.x. To stay on API v2, pin `finlight-client@^3`; 3.x gets no further releases. See the migration section of the README and the full guide on [docs.finlight.me](https://docs.finlight.me).

### Breaking

- The client is `FinlightClient` (was `FinlightApi`), configured with `FinlightConfig`. Methods: `articles.search`, `articles.searchAll`, `articles.get`, `articles.getByLink`, `companies.search`, `companies.getMany`, `companies.get`, `sources.list`, `stream`, `rawStream`, `Webhooks.constructEvent`, `Webhooks.verifySignature`.
- Models follow the v3 wire format: `publishedAt`, `firstSeenAt`, `revisedAt`, `availableAt`, `media[].url`, `source.domain`, `sentiment { label, confidence }`, `companies[]` with `role` and `relevance`, and `events[]`.
- Gated keys (`content`, `sentiment`, `companies`, `events`, `events[].companyIds`, `Source.hasContent`) are missing when not requested or not entitled. They are never turned into `null`, `[]` or `false`. Use `contentPresent`, `sentimentPresent`, `companiesPresent` and `eventsPresent`.
- Search takes `limit` and `cursor` instead of pages, `languages: string[]`, lowercase `order`, and `include: ['content', 'companies', 'events']`.
- Streams are async iterables (`for await`) instead of callbacks.
- Webhooks: `constructEvent(rawBody, headers, secret)` and `constructEventFromValues(rawBody, signature, timestamp, secret)` return the v3 envelope (`eventId`, `event`, `occurredAt`, `changedFields`, `data`, `isTest`). A correctly signed body in the old format returns a `WrongPayloadVersion` result with the parsed body in `raw` (answer it with 2xx).
- The tolerance for webhook timestamps is 300 s by default, and the timestamp is required. A missing or unreadable timestamp fails.
- `logLevel` is gone; configure levels in your own `logger`. Without a logger the SDK is silent.
- Requires Node.js 20 or newer. axios is no longer a dependency; REST uses the built-in `fetch`.

### Added

- `articles.searchAll` with `maxPages` (default 10), a page-by-page variant (`.pages()`) and `nextCursor` to continue.
- Company lookups (`companies.search`, `getMany`, `get` with ETag revalidation) and the source catalog (`sources.list`). List results are arrays with a `skipped` field. `companies.get` with your own `ifNoneMatch` returns `null` on 304.
- One error model: `FinlightApiError` with `status`, `code`, `title`, `detail`, `requestId`, `errors` (`FieldIssue[]`), `apiKind` and `raw` (the body as received), with one subclass per kind: `ValidationFailedError`, `CursorInvalidError`, `CursorMismatchError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `RateLimitedError` (`limitType`, `retryAfterMs`) and `InternalServerError`. A `limitType` this version does not know is kept as sent and never retried. Plus `FinlightValidationError`, `FinlightNetworkError` (with `FinlightTimeoutError` under it), `FinlightDecodeError`, `WebhookVerificationError` and `PreemptedError`. All share the base `FinlightError` and a `kind` field.
- Retries: 5xx, network errors and attempt timeouts up to 3 times with jittered backoff (POST search included); 400, 401, 403, 404 and monthly 429 never. A burst 429 waits exactly `Retry-After` (`burstWaitMs`, 10 s, when the header is missing) and retries once; this is on by default and `retryOnBurst: 'off'` turns it off. One `X-Request-Id` per logical call, kept on retries.
- Every call takes an `AbortSignal`. Optional `totalTimeoutMs` per call.
- Streams: application ping every 25 s, reconnect after 60 s without pong, connection renewal after 115 min, duplicate filter, `onAdmitted`, `onReconnect` (with `lastSeenAt`) and `onError` hooks, typed terminal errors. Items are `StreamEvent { kind, event, data }`; `rawJson(event)` returns the frame. `searchFailedThreshold` (5) sets when repeated `SEARCH_FAILED` goes to `onError`. A refused or failed renewal dial (a plan at its connection limit) closes the old connection, waits up to 5 s for its close reply and dials again at once without calling `onError`; only a second refusal waits. The reconnect backoff starts over only after a pong or an article, not on `connection.admitted`, so admitted followed by `SEARCH_FAILED` keeps backing off.
- Streams survive a used-up WebSocket quota: after a dial refused with "quota exceeded" or a `quota_exceeded` preemption they retry every hour until the quota allows it again. Each attempt is logged as a warning and reported to `onQuotaWait`. On by default; `quotaReconnect: false` ends the stream with the typed error instead, and `quotaReconnectIntervalMs` sets the interval. A `connection_limit` preemption still ends the stream. REST never waits for a new quota: a monthly 429 fails at once, also in `searchAll`.
- `rawJson(value)` returns the JSON as received, including keys this version does not know.
- `toDate()` parses timestamps strictly (RFC 3339).
- Search filters `sourceTypes` and `excludeSourceTypes` on `articles.search` and `articles.searchAll` (not on streams). `SOURCE_TYPES` lists the 7 known values (`newswire`, `press_release`, `financial_media`, `general_media`, `aggregator`, `blog`, `government`); `SourceType` stays open. `source.type` and `Source.type` are `null` when the source is not classified.
- Unknown request parameters throw before any request.
- `User-Agent: finlight-client-typescript/<version>` and `x-client-version` on every request and dial.

### Removed

- Everything for API v1 and v2: the old services, models, parameter types and transforms.
- The SIGINT handler and `process.exit` in the WebSocket client.

### Contract

- Built and tested against the finlight API v3 contract kit 3.0.0-rc.4 (vendored in `conformance/`, not published).
