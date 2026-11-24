# finlight 클라이언트 (TypeScript / Node.js)

*[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | 한국어*

> **호환되지 않는 변경:** 4.x는 finlight API v3만 지원합니다 (REST `/v3`, WebSocket `payloadVersion` 3, v3 웹훅). 3.x 코드와 호환되지 않습니다. 업그레이드하기 전에 [마이그레이션 안내](#migration)와 [변경 기록](CHANGELOG.md)을 읽어 주세요. API v2를 계속 쓰려면 `finlight-client@^3`으로 고정하세요.

*이 문서는 영어 README를 번역한 것입니다. 내용이 다르면 영어판이 우선합니다.*

[finlight.me](https://finlight.me)용 타입 클라이언트입니다. 금융 뉴스 검색, 기사·기업·출처 조회, WebSocket으로 실시간 기사 수신, 웹훅 검증을 지원합니다.

## 버전

| SDK 메이저 | finlight API | 상태 |
|---|---|---|
| 4.x | v3 (`/v3`, WebSocket `payloadVersion` 3, webhooks v3) | 현재 버전 |
| 3.x | v1/v2 | 더 이상 릴리스 없음 |

`^3`과 `~3`은 4.x로 해석되지 않습니다. `*`나 `>=3` 같은 열린 범위는 해석되므로 메이저 버전을 고정하세요.

## 요구 사항

- Node.js >= 20 (SDK는 내장 `fetch`를 사용합니다)
- TypeScript >= 5.0 (TypeScript를 사용할 때만)
- `ws` >= 8.18 (SDK와 함께 설치됩니다)

## 설치

```bash
npm install finlight-client@^4
```

## 빠른 시작

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

SDK는 사용자가 설정한 파라미터만 보내고 기본값을 추가하지 않습니다. `limit`(20), `languages`(`['en']`), 기간은 서버가 정합니다. SDK가 모르는 파라미터 이름은 요청 전에 `FinlightValidationError`를 발생시킵니다. 서버는 그런 이름을 조용히 무시하면서도 호출 횟수에 포함하기 때문입니다.

## 검색

`articles.search`는 한 페이지를 반환합니다. `articles.searchAll`은 커서를 자동으로 따라갑니다.

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

- `searchAll`은 호출 시점에 요청 본문을 고정합니다. 이후 페이지에서는 `cursor`만 바뀌므로 커서가 유효하게 유지됩니다.
- `hasMore: false`, `nextCursor: null` 또는 `maxPages`(기본 10)에 도달하면 멈춥니다. 한도에 도달하면 경고를 기록하며, `result.nextCursor`로 이어서 가져올 수 있습니다.
- 각 페이지는 과금되는 호출입니다. 결과는 한 번만 순회할 수 있습니다.
- `from`과 `to`는 `Date`(밀리초를 포함한 UTC로 전송) 또는 문자열(그대로 전송)을 받으며, `orderBy` 타임스탬프에 적용됩니다.
- 디코딩할 수 없는 항목은 건너뛰고 로그에 남기며 `page.skipped`에 담습니다. 페이지의 나머지는 그대로 사용할 수 있습니다.

## 조회

```ts
const article = await client.articles.get('pXhK9f2aQ1mZ0bT7cY3rLw', { include: ['content'] });
const byLink = await client.articles.getByLink('https://www.reuters.com/markets/example', { include: ['companies'] });

const [nvidia] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
const many = await client.companies.getMany([4821, 1234]);
const record = await client.companies.get(4821); // ETag revalidation is built in

const sources = await client.sources.list();
```

- 404는 빈 결과가 아니라 `apiKind: 'not_found'`인 `FinlightApiError`입니다.
- id 도입 이전에 색인된 기사는 id로 조회할 수 없습니다. `getByLink`를 사용하세요.
- 기업 엔드포인트에는 `entityAccess` 권한이 필요하며, 없으면 403을 반환합니다.
- `companies.get`은 ETag를 보관하고 재검증합니다. 304이면 캐시된 레코드를 반환하며, `cacheInfo(record)`로 ETag를 볼 수 있습니다.

## 키 없음, null, 빈 목록

일부 키는 요금제와 `include`에 따라 달라집니다. 키가 없는 것, `null`, `[]`는 의미가 다르며 SDK는 이를 구분합니다.

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

- 키 없음: 요청하지 않았거나, 요금제에 포함되지 않았거나, raw 채널입니다.
- `null`: 요청했고 권한도 있지만 값이 없습니다 (예: `content`에 본문이 없음).
- `[]`: 실제로 빈 목록입니다 (예: 태깅했지만 기업을 찾지 못함).
- `content`, `sentiment`, `companies`, `events`, `events[].companyIds`, `Source.hasContent`에 적용됩니다.
- 타임스탬프는 전송된 문자열 그대로 유지됩니다. `toDate()`가 엄격하게 파싱합니다.
- 새 서버가 보낸 알 수 없는 키는 객체에 남아 있습니다. `rawJson(value)`는 받은 JSON을 반환합니다.

## 실시간 스트림

`client.stream()`은 보강된 기사를, `client.rawStream()`은 보강 전 기사의 골격을 받습니다. 둘 다 첫 번째 순회에서 연결합니다. SDK는 25초마다 ping을 보내고, 60초 동안 pong이 없으면 다시 연결하며, 115분 후 연결을 교체하고, 중복을 제거합니다.

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

알아 둘 점:

- **연결 수 한도.** 요금제의 WebSocket 한도는 보강 스트림, raw 스트림, 이전 SDK 버전이 함께 사용합니다. 이전 스트림과 새 스트림을 동시에 실행하지 마세요. 한도에 도달하면 SDK는 최소 60초를 기다린 뒤 다시 시도합니다. `{ takeover: true }`를 쓰면 가장 오래 활동이 없던 자신의 연결을 대체합니다.
- **2시간 한도.** 게이트웨이는 모든 연결을 2시간 후에 끊습니다. SDK는 그 전에 새 연결을 열고 다시 구독합니다.
- **초기 푸시.** 구독할 때마다 보강 스트림은 조건에 맞는 최신 기사 한 건을 보냅니다. 오래된 기사일 수 있습니다. 이 스트림에서 이미 전달했다면 SDK가 버립니다.
- **큰 프레임.** 32,000바이트를 넘는 실시간 프레임은 서버가 알림 없이 버립니다. 긴 기사에 `include: ['content']`를 쓰면 발생할 수 있습니다. 본문은 `articles.get(id, { include: ['content'] })`로 가져오세요.
- `onAdmitted`는 서버가 구독을 검사하기 전에 호출됩니다. 구독이 수락되었다는 뜻이 아닙니다.
- SDK는 데이터를 자동으로 보충하지 않습니다. `onReconnect`가 `lastSeenAt`을 전달하므로 REST로 빈 구간을 채울 수 있습니다.
- 루프를 벗어나거나, `stream.close()`를 호출하거나, abort 신호를 보내면 소켓이 닫히고 모든 타이머가 멈춥니다.
- 키 거부, WebSocket이 없는 요금제, 할당량 소진, 잘못된 구독, 선점(`PreemptedError`)이 발생하면 스트림은 오류로 끝납니다. 그 밖의 문제는 `onError`로 전달되고 스트림은 계속 실행됩니다.
- `rawStream`에는 `include`도, 보강 관련 필터도 없습니다.

## 웹훅

`Webhooks.constructEvent(rawBody, headers, secret)`는 서명과 타임스탬프(기본 허용 오차 300초)를 확인한 다음 본문을 읽습니다. `WebhookEvent`를 반환하며, 서명은 올바르지만 이전 형식인 본문에는 `WrongPayloadVersion` 결과를 반환합니다.

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

서명은 원본 바이트에 대해 계산됩니다. JSON 파서가 실행되기 전에 가져오세요:

- Express: 웹훅 경로에 `express.raw({ type: 'application/json' })`를 사용합니다.
- Fastify: `addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`.
- Next.js 라우트 핸들러: `await request.text()`를 사용하고 `request.headers`를 전달합니다.
- `node:http`: 요청 청크를 `Buffer`로 모읍니다.

- 전달이 반복될 수 있습니다. `eventId`로 중복을 제거하세요.
- 5초 안에 2xx로 응답하고, 오래 걸리는 작업은 그 후에 하세요.
- 절대 410으로 응답하지 마세요. 웹훅이 즉시 비활성화됩니다.
- 대시보드에서 보낸 테스트 전달은 `isTest`가 true입니다.
- `Webhooks.verifySignature(rawBody, signature, timestamp, secret)`는 서명만 확인합니다. 두 헤더 값을 직접 넘겨주는 프레임워크용입니다.
- SDK는 웹훅을 관리하지 않습니다. 생성과 변경은 finlight 대시보드에서 하세요.

## 오류와 재시도

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

모든 SDK 오류는 `FinlightError`를 상속하며 `kind` 필드(`api`, `validation`, `network`, `timeout`, `decode`, `webhook_verification`, `preempted`)를 가집니다. `FinlightApiError`에는 `status`, `code`, `title`, `detail`, `requestId`, `errors[]`, `apiKind`가 있습니다. 논리적 호출마다 고유한 `X-Request-Id`를 보내며, 재시도할 때도 같은 값을 씁니다. 재시도 규칙:

| 응답 | 재시도 |
|---|---|
| 400, 401, 403, 404 | 하지 않음 |
| 429 monthly / unknown | 하지 않음 |
| 429 burst | 한 번, 최소 10초 대기 후 (`retryOnBurst`, 변경 기록 참고) |
| 5xx, 네트워크 오류, 타임아웃 | 최대 3번, 대기 시간을 늘리고 무작위 지연을 더해서 |

모든 호출은 `AbortSignal`을 받습니다. 중단하면 대기가 즉시 끝나고, 재시도하지 않으며, 신호의 reason으로 reject됩니다.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.articles.search({ query: 'ticker:TSLA' }, { signal: controller.signal });
```

## 설정

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `apiKey` | - | 필수. |
| `baseUrl` | `https://api.finlight.me` | REST 기본 URL. |
| `wssUrl` | `wss://wss.finlight.me` | WebSocket URL. raw는 `<wssUrl>/raw`를 사용합니다. |
| `timeoutMs` | `30000` | HTTP 시도 한 번의 타임아웃(밀리초). |
| `totalTimeoutMs` | - | 선택. 재시도와 대기를 포함한 호출 전체의 한도. |
| `maxRetries` | `3` | 5xx, 네트워크 오류, 타임아웃의 재시도 횟수. |
| `retryOnBurst` | `'once'` | 429 버스트 응답에 대해 `'once'` 또는 `'off'`. |
| `burstWaitMs` | `10000` | 버스트 재시도 전 대기 시간. 최소 10000. |
| `maxPages` | `10` | `searchAll`의 페이지 수 한도. |
| `pingIntervalMs` / `watchdogTimeoutMs` / `rotationIntervalMs` | `25000` / `60000` / `6900000` | 스트림 ping, pong 감시, 연결 교체. |
| `fetch` / `wsAgent` | - | 직접 만든 `fetch`(REST)와 HTTP 에이전트(WebSocket). 예를 들어 프록시용입니다. 이 경우 그 자체의 타임아웃이 적용되며, 스스로 재시도하지 않도록 해야 합니다. |
| `logger` | - | `debug`/`info`/`warn`/`error`를 가진 모든 로거. |
| `clock` | - | 테스트용으로 바꿀 수 있는 시계. |

## 데이터 참고 사항

- 일부 오래된 기사는 `publishedAt`이 `1970-01-01T00:00:00.000Z`이거나 `summary`가 비어 있습니다. SDK는 그대로 전달합니다.
- 역할 도입 전에 태깅된 기사는 `companies[].role`과 `relevance`가 `null`이고 `events`가 `[]`입니다.
- id 도입 이전에 색인된 기사는 `articles.get`에서 404를 반환합니다. `getByLink`로는 찾을 수 있습니다.
- `availableAt`은 raw에서 항상 `null`이며, 도입 이전 기사에서도 `null`입니다.

<a id="migration"></a>

## 3.x에서 마이그레이션

전체 가이드는 [docs.finlight.me](https://docs.finlight.me)에 있습니다. 주요 변경 사항:

| 3.x (API v2) | 4.x (API v3) |
|---|---|
| `new FinlightApi({ apiKey })` | `new FinlightClient({ apiKey })` |
| `articles.fetchArticles(...)` | `articles.search(...)`, `articles.searchAll(...)` |
| `articles.fetchArticleByLink(...)` | `articles.getByLink(link)`, `articles.get(id)` |
| `sources.getSources()` | `sources.list()` |
| `client.websocket.connect(params, onArticle)`, `stop()` | `for await (const item of client.stream(params))`, `stream.close()` |
| raw WebSocket 클라이언트 | `client.rawStream(params)` |
| `WebhookService.constructEvent(body, signature, secret, timestamp)` | `Webhooks.constructEvent(rawBody, headers, secret)` |
| `logLevel` | 레벨은 직접 만든 `logger`에서 설정 |
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
| 웹훅 본문 = 기사 | `event.data` + `event.eventId` |

웹훅을 v3로 전환하는 방법:

1. 새 SDK를 배포합니다. `WrongPayloadVersion`에는 2xx로 응답하고, 데이터가 필요하면 `json`을 보관합니다.
2. finlight 대시보드에서 웹훅을 `payloadVersion` 3으로 전환합니다.
3. 약 2시간 기다립니다. 이미 대기열에 있는 재시도는 이전 형식으로 도착합니다.

## 로그

SDK는 기본적으로 아무것도 출력하지 않습니다. `NODE_DEBUG=finlight`로 디버그 출력을 볼 수 있으며, `logger: console`(또는 pino, winston)을 넘길 수도 있습니다. API 키, 웹훅 시크릿, 서명, 전체 본문은 절대 기록하지 않으며 프로세스 핸들러도 설치하지 않습니다.

## 라이선스

MIT
