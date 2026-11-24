# Changelog

## 4.0.0 (unreleased)

**Breaking: 4.x speaks finlight API v3 only.** REST `/v3`, WebSocket `payloadVersion` 3 and v3 webhooks. Code written for 3.x does not compile against 4.x. To stay on API v2, pin `finlight-client@^3`; 3.x gets no further releases. See the migration section of the README and the full guide on [docs.finlight.me](https://docs.finlight.me).

### Breaking

- The client is `FinlightClient` (was `FinlightApi`). Methods: `articles.search`, `articles.searchAll`, `articles.get`, `articles.getByLink`, `companies.search`, `companies.getMany`, `companies.get`, `sources.list`, `stream`, `rawStream`, `Webhooks.constructEvent`, `Webhooks.verifySignature`.
- Models follow the v3 wire format: `publishedAt`, `firstSeenAt`, `revisedAt`, `availableAt`, `media[].url`, `source.domain`, `sentiment { label, confidence }`, `companies[]` with `role` and `relevance`, and `events[]`.
- Gated keys (`content`, `sentiment`, `companies`, `events`, `events[].companyIds`, `Source.hasContent`) are missing when not requested or not entitled. They are never turned into `null`, `[]` or `false`. Use `contentPresent`, `sentimentPresent`, `companiesPresent` and `eventsPresent`.
- Search takes `limit` and `cursor` instead of pages, `languages: string[]`, lowercase `order`, and `include: ['content', 'companies', 'events']`.
- Streams are async iterables (`for await`) instead of callbacks.
- Webhooks: `constructEvent(rawBody, headers, secret)` returns the v3 envelope (`eventId`, `event`, `occurredAt`, `changedFields`, `data`, `isTest`). A correctly signed body in the old format returns a `WrongPayloadVersion` result (answer it with 2xx).
- The tolerance for webhook timestamps is 300 s by default, and the timestamp is required. A missing or unreadable timestamp fails.
- `logLevel` is gone; configure levels in your own `logger`. Without a logger the SDK is silent.
- Requires Node.js 20 or newer. axios is no longer a dependency; REST uses the built-in `fetch`.

### Added

- `articles.searchAll` with `maxPages` (default 10), a page-by-page variant (`.pages()`) and `nextCursor` to continue.
- Company lookups (`companies.search`, `getMany`, `get` with ETag revalidation) and the source catalog (`sources.list`).
- One error model: `FinlightApiError` with `status`, `code`, `title`, `detail`, `requestId`, `errors[]`, `apiKind` and, for 429, `limitType` (`monthly`, `burst`, `unknown`). Plus `FinlightValidationError`, `FinlightNetworkError`, `FinlightTimeoutError`, `FinlightDecodeError`, `WebhookVerificationError` and `PreemptedError`. All share the base `FinlightError` and a `kind` field.
- Retries: 5xx, network errors and attempt timeouts up to 3 times with jittered backoff (POST search included); 400, 401, 403, 404 and monthly 429 never. A burst 429 waits for `Retry-After` (10 s if missing) and retries once; this is on by default and `retryOnBurst: 'off'` turns it off. One `X-Request-Id` per logical call, kept on retries.
- Every call takes an `AbortSignal`. Optional `totalTimeoutMs` per call.
- Streams: application ping every 25 s, reconnect after 60 s without pong, connection renewal after 115 min, duplicate filter, `onAdmitted`, `onReconnect` (with `lastSeenAt`) and `onError` hooks, typed terminal errors.
- `rawJson(value)` returns the JSON as received, including keys this version does not know.
- `toDate()` parses timestamps strictly (RFC 3339).
- Unknown request parameters throw before any request.
- `User-Agent: finlight-client-typescript/<version>` and `x-client-version` on every request and dial.

### Removed

- Everything for API v1 and v2: the old services, models, parameter types and transforms.
- The SIGINT handler and `process.exit` in the WebSocket client.

### Contract

- Built and tested against the finlight API v3 contract kit 3.0.0-rc.1 (vendored in `conformance/`, not published). The SDK already reads the 429 `limitType` field and `Retry-After` header planned for rc.2.
