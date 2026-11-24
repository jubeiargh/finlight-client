# finlight TypeScript / Node.js 客户端

*[English](README.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md)*

> **不兼容变更：** 4.x 只支持 finlight API v3（REST `/v3`、WebSocket `payloadVersion` 3、v3 Webhook），与 3.x 代码不兼容。升级前请阅读[迁移说明](#migration)和[更新日志](CHANGELOG.md)。如需继续使用 API v2，请固定 `finlight-client@^3`。

*本文译自英文 README。如有出入，以英文版为准。*

[finlight.me](https://finlight.me) 的类型化客户端：搜索金融新闻，查询文章、公司和来源，通过 WebSocket 接收实时文章，并验证 Webhook。

## 版本

| SDK 主版本 | finlight API | 状态 |
|---|---|---|
| 4.x | v3 (`/v3`, WebSocket `payloadVersion` 3, webhooks v3) | 当前版本 |
| 3.x | v1/v2 | 不再发布新版本 |

`^3` 和 `~3` 不会解析到 4.x。`*` 或 `>=3` 这类开放范围会，因此请固定主版本。

## 环境要求

- Node.js >= 20 (SDK 使用内置的 `fetch`)
- TypeScript >= 5.0 (仅在使用 TypeScript 时需要)
- `ws` >= 8.18 (随 SDK 一起安装)

## 安装

```bash
npm install finlight-client@^4
```

## 快速开始

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

SDK 只发送你设置的参数，不添加任何默认值：`limit`（20）、`languages`（`['en']`）和时间范围由服务器决定。SDK 不认识的参数名会在发出请求之前抛出 `FinlightValidationError`，因为服务器会静默忽略它，但仍然计入调用次数。

## 搜索

`articles.search` 返回一页结果。`articles.searchAll` 会自动翻页（cursor）。

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

- `searchAll` 在调用时冻结请求体。之后的页面只改变 `cursor`，因此 cursor 始终有效。
- 遇到 `hasMore: false`、`nextCursor: null` 或达到 `maxPages`（默认 10）时停止。达到上限时会记录警告，可通过 `result.nextCursor` 继续。
- 每一页都会计费。结果只能遍历一次。
- `from` 和 `to` 接受 `Date`（以带毫秒的 UTC 发送）或字符串（原样发送），作用于 `orderBy` 指定的时间字段。
- 无法解码的条目会被跳过、记录日志并列在 `page.skipped` 中，页面其余部分仍可使用。

## 查询

```ts
const article = await client.articles.get('pXhK9f2aQ1mZ0bT7cY3rLw', { include: ['content'] });
const byLink = await client.articles.getByLink('https://www.reuters.com/markets/example', { include: ['companies'] });

const [nvidia] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
const many = await client.companies.getMany([4821, 1234]);
const record = await client.companies.get(4821); // ETag revalidation is built in

const sources = await client.sources.list();
```

- 404 会抛出 `apiKind: 'not_found'` 的 `FinlightApiError`，而不是返回空结果。
- 在 id 上线之前收录的文章无法按 id 查询，请使用 `getByLink`。
- 公司接口需要 `entityAccess` 权限，否则返回 403。
- `companies.get` 会保存 ETag 并重新验证。收到 304 时返回缓存的记录；`cacheInfo(record)` 可查看 ETag。

## 缺失、null 与空列表

部分字段取决于你的套餐和 `include`。字段缺失、`null` 和 `[]` 含义不同，SDK 会区分它们。

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

- 字段缺失：未请求、套餐不包含，或来自 raw 通道。
- `null`：已请求且有权限，但没有值（例如 `content` 没有正文）。
- `[]`：真正的空列表（例如已标注，但没有找到公司）。
- 适用于 `content`、`sentiment`、`companies`、`events`、`events[].companyIds` 和 `Source.hasContent`。
- 时间戳保持服务器发送的原始字符串。`toDate()` 会严格解析。
- 新版服务器返回的未知字段会保留在对象上。`rawJson(value)` 返回收到的原始 JSON。

## 实时流

`client.stream()` 接收增强后的文章，`client.rawStream()` 接收增强之前的原始文章骨架。两者都在第一次遍历时建立连接。SDK 每 25 秒发送 ping，60 秒内未收到 pong 时重新连接，115 分钟后主动更换连接，并丢弃重复项。

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

注意事项：

- **连接数上限。** 套餐的 WebSocket 上限由增强流、raw 流和旧版 SDK 共享。请不要同时运行新旧两种流。达到上限时，SDK 至少等待 60 秒后重试；使用 `{ takeover: true }` 则会替换你最久未活动的连接。
- **两小时上限。** 网关会在 2 小时后断开每个连接。SDK 会在此之前建立新连接并重新订阅。
- **初始推送。** 每次订阅后，增强流会发送最新的一篇匹配文章，它可能是旧文章。如果该文章已在此流中交付过，SDK 会将其丢弃。
- **大帧。** 超过 32,000 字节的实时帧会被服务器静默丢弃。对长文章使用 `include: ['content']` 时可能发生。请改用 `articles.get(id, { include: ['content'] })` 获取正文。
- `onAdmitted` 在服务器检查订阅之前触发，并不表示订阅已被接受。
- SDK 不会自动补齐数据。`onReconnect` 提供 `lastSeenAt`，你可以通过 REST 补齐缺口。
- 退出循环、调用 `stream.close()` 或触发 abort 信号都会关闭 socket 并停止所有计时器。
- 以下情况会以错误结束流：密钥被拒绝、套餐不含 WebSocket、订阅无效以及原因为 `connection_limit` 的抢占（`PreemptedError`）。其他问题会交给 `onError`，流继续运行。
- **WebSocket 配额用尽。** 当本期配额用尽（连接被拒绝或原因为 `quota_exceeded` 的抢占）时，流不会结束，而是每小时重试一次，直到配额再次允许。每次尝试都会记录警告并报告给 `onQuotaWait`。设置 `reconnectOnQuotaExhausted: false` 则改为以错误结束流；`quotaRetryIntervalMs` 可修改间隔。REST 调用从不等待：月度 429 会立即失败。
- `rawStream` 不支持 `include`，也不支持增强相关的过滤条件。

## Webhook

`Webhooks.constructEvent(rawBody, headers, secret)` 先检查签名和时间戳（默认容差 300 秒），再读取请求体。它返回 `WebhookEvent`；如果请求体签名正确但仍是旧格式，则返回 `WrongPayloadVersion` 结果。

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

签名覆盖原始字节。请在任何 JSON 解析器运行之前获取它们：

- Express：在 Webhook 路由上使用 `express.raw({ type: 'application/json' })`。
- Fastify：`addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`。
- Next.js route handler：`await request.text()`，并传入 `request.headers`。
- `node:http`：把请求数据块收集到一个 `Buffer` 中。

- 投递可能重复。请根据 `eventId` 去重。
- 在 5 秒内返回 2xx，耗时的工作之后再做。
- 永远不要返回 410：它会立即停用该 Webhook。
- 来自控制台的测试投递 `isTest` 为 true。
- `Webhooks.verifySignature(rawBody, signature, timestamp, secret)` 只检查签名，适用于直接提供两个请求头值的框架。
- SDK 不管理 Webhook。请在 finlight 控制台中创建和修改。

## 错误与重试

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

所有 SDK 错误都继承自 `FinlightError`，并带有 `kind` 字段：`api`、`validation`、`network`、`timeout`、`decode`、`webhook_verification` 或 `preempted`。`FinlightApiError` 包含 `status`、`code`、`title`、`detail`、`requestId`、`errors[]` 和 `apiKind`。每次逻辑调用都发送自己的 `X-Request-Id`，重试时保持不变。重试规则：

| 响应 | 重试 |
|---|---|
| 400, 401, 403, 404 | 从不 |
| 429 monthly / unknown | 从不 |
| 429 burst | 一次，等待 `Retry-After` 指定的时间（缺失时为 10 秒）。默认开启，可用 `retryOnBurst: 'off'` 关闭 |
| 5xx, 网络错误、超时 | 最多 3 次，等待时间递增并带随机抖动 |

每个调用都接受 `AbortSignal`。中止会立即结束等待，不会重试，并以信号的 reason 拒绝。

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.articles.search({ query: 'ticker:TSLA' }, { signal: controller.signal });
```

## 配置

| 选项 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | - | 必填。 |
| `baseUrl` | `https://api.finlight.me` | REST 基础地址。 |
| `wssUrl` | `wss://wss.finlight.me` | WebSocket 地址；raw 使用 `<wssUrl>/raw`。 |
| `timeoutMs` | `30000` | 单次 HTTP 尝试的超时（毫秒）。 |
| `totalTimeoutMs` | - | 可选，整个调用（含重试和等待）的时间上限。 |
| `maxRetries` | `3` | 5xx、网络错误和超时的重试次数。 |
| `retryOnBurst` | `'once'` | 对 429 突发限流：`'once'` 或 `'off'`。 |
| `burstWaitMs` | `10000` | 突发限流重试前的等待时间，至少 10000。 |
| `maxPages` | `10` | `searchAll` 的页数上限。 |
| `reconnectOnQuotaExhausted` / `quotaRetryIntervalMs` | `true` / `3600000` | WebSocket 配额用尽时流的行为：每小时重试（设为 `false` 则结束流）。 |
| `pingIntervalMs` / `watchdogTimeoutMs` / `rotationIntervalMs` | `25000` / `60000` / `6900000` | 流的 ping、pong 看门狗和连接更换。 |
| `fetch` / `wsAgent` | - | 自定义 `fetch`（REST）和 HTTP agent（WebSocket），例如用于代理。此时以它们自己的超时为准；请确保它们不会自行重试。 |
| `logger` | - | 任何带有 `debug`/`info`/`warn`/`error` 的日志器。 |
| `clock` | - | 可替换的时钟，用于测试。 |

## 数据说明

- 部分旧文章的 `publishedAt` 为 `1970-01-01T00:00:00.000Z` 或 `summary` 为空。SDK 按原样交付。
- 在引入角色之前标注的文章，其 `companies[].role` 和 `relevance` 为 `null`，`events` 为 `[]`。
- 在 id 上线之前收录的文章，`articles.get` 返回 404；`getByLink` 可以找到它们。
- `availableAt` 在 raw 中始终为 `null`，在其上线之前的文章中也为 `null`。

<a id="migration"></a>

## 从 3.x 迁移

完整指南见 [docs.finlight.me](https://docs.finlight.me)。主要变化：

| 3.x (API v2) | 4.x (API v3) |
|---|---|
| `new FinlightApi({ apiKey })` | `new FinlightClient({ apiKey })` |
| `articles.fetchArticles(...)` | `articles.search(...)`, `articles.searchAll(...)` |
| `articles.fetchArticleByLink(...)` | `articles.getByLink(link)`, `articles.get(id)` |
| `sources.getSources()` | `sources.list()` |
| `client.websocket.connect(params, onArticle)`, `stop()` | `for await (const item of client.stream(params))`, `stream.close()` |
| raw WebSocket 客户端 | `client.rawStream(params)` |
| `WebhookService.constructEvent(body, signature, secret, timestamp)` | `Webhooks.constructEvent(rawBody, headers, secret)` |
| `logLevel` | 在你自己的 `logger` 中配置级别 |
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
| Webhook 请求体 = 文章 | `event.data` + `event.eventId` |

将 Webhook 切换到 v3：

1. 部署新版 SDK。对 `WrongPayloadVersion` 返回 2xx，如需数据请保留其 `json`。
2. 在 finlight 控制台中将 Webhook 切换到 `payloadVersion` 3。
3. 等待约 2 小时。已排队的重试仍会以旧格式到达。

## 日志

SDK 默认不输出日志。设置 `NODE_DEBUG=finlight` 可查看调试输出，或传入 `logger: console`（或 pino、winston）。它从不记录 API 密钥、Webhook 密钥、签名或完整请求体，也不会安装进程处理器。

## 许可证

MIT
