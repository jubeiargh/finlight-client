# finlight クライアント（TypeScript / Node.js）

*[English](README.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md)*

> **互換性のない変更：** 4.x は finlight API v3 のみに対応します（REST `/v3`、WebSocket `payloadVersion` 3、v3 Webhook）。3.x のコードとは互換性がありません。アップグレードの前に[移行の説明](#migration)と[変更履歴](CHANGELOG.md)をお読みください。API v2 を使い続ける場合は `finlight-client@^3` に固定してください。

*この文書は英語版 README の翻訳です。内容が異なる場合は英語版が優先されます。*

[finlight.me](https://finlight.me) 用の型付きクライアントです。金融ニュースの検索、記事・企業・ソースの参照、WebSocket による記事のライブ受信、Webhook の検証ができます。

## バージョン

| SDK メジャー | finlight API | 状態 |
|---|---|---|
| 4.x | v3 (`/v3`, WebSocket `payloadVersion` 3, webhooks v3) | 最新 |
| 3.x | v1/v2 | 今後のリリースなし |

`^3` や `~3` が 4.x に解決されることはありません。`*` や `>=3` のような開いた範囲は解決されるため、メジャーを固定してください。

## 動作要件

- Node.js >= 20 (SDK は組み込みの `fetch` を使います)
- TypeScript >= 5.0 (TypeScript を使う場合のみ)
- `ws` >= 8.18 (SDK と一緒にインストールされます)

## インストール

```bash
npm install finlight-client@^4
```

## クイックスタート

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

SDK は指定されたパラメータだけを送信し、既定値を追加しません。`limit`（20）、`languages`（`['en']`）、期間はサーバーが決めます。SDK が知らないパラメータ名は、リクエストの前に `FinlightValidationError` になります。サーバーはそれを黙って無視し、しかも呼び出しとして数えるためです。

## 検索

`articles.search` は 1 ページを返します。`articles.searchAll` はカーソルを自動でたどります。

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

- `searchAll` は呼び出し時にリクエストボディを固定します。以降のページでは `cursor` だけが変わるため、カーソルは有効なままです。
- `hasMore: false`、`nextCursor: null`、または `maxPages`（既定 10）に達すると止まります。上限に達すると警告を記録し、`result.nextCursor` で続きを取得できます。
- 各ページは課金対象の呼び出しです。結果は一度だけ反復できます。
- `from` と `to` は `Date`（ミリ秒付き UTC で送信）または文字列（そのまま送信）を受け取り、`orderBy` のタイムスタンプに適用されます。
- デコードできないエントリはスキップされ、ログに記録され、`page.skipped` に入ります。ページの残りはそのまま使えます。

## 参照

```ts
const article = await client.articles.get('pXhK9f2aQ1mZ0bT7cY3rLw', { include: ['content'] });
const byLink = await client.articles.getByLink('https://www.reuters.com/markets/example', { include: ['companies'] });

const [nvidia] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
const many = await client.companies.getMany([4821, 1234]);
const record = await client.companies.get(4821); // ETag revalidation is built in

const sources = await client.sources.list();
```

- 404 は空の結果ではなく、`apiKind: 'not_found'` の `FinlightApiError` です。
- id 導入前に登録された記事は id で参照できません。`getByLink` を使ってください。
- 企業のエンドポイントには `entityAccess` の権限が必要です。ない場合は 403 になります。
- `companies.get` は ETag を保持して再検証します。304 のときはキャッシュしたレコードを返します。`cacheInfo(record)` で ETag を確認できます。

## キーなし、null、空リスト

一部のキーはプランと `include` に依存します。キーがないこと、`null`、`[]` は意味が異なり、SDK はこれらを区別します。

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

- キーなし：リクエストしていない、プランに含まれない、または raw チャネル。
- `null`：リクエストしており権限もあるが、値が存在しない（例：`content` の本文がない）。
- `[]`：実際に空のリスト（例：タグ付けはしたが企業が見つからなかった）。
- 対象は `content`、`sentiment`、`companies`、`events`、`events[].companyIds`、`Source.hasContent` です。
- タイムスタンプは送られたままの文字列です。`toDate()` が厳密に解析します。
- 新しいサーバーからの未知のキーはオブジェクトに残ります。`rawJson(value)` は受信した JSON を返します。

## ライブストリーム

`client.stream()` はエンリッチ済みの記事を、`client.rawStream()` はエンリッチ前の記事の骨格を受信します。どちらも最初の反復で接続します。SDK は 25 秒ごとに ping を送り、60 秒 pong がなければ再接続し、115 分後に接続を更新し、重複を取り除きます。

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

知っておくべきこと：

- **接続数の上限。** プランの WebSocket 上限は、エンリッチ済みストリーム、raw ストリーム、古い SDK で共有されます。新旧のストリームを同時に動かさないでください。上限に達すると SDK は少なくとも 60 秒待って再試行します。`{ takeover: true }` を使うと、最も古い自分の接続を置き換えます。
- **2 時間の上限。** ゲートウェイはすべての接続を 2 時間で切断します。SDK はその前に新しい接続を開き、再購読します。
- **初回プッシュ。** 購読のたびに、エンリッチ済みストリームは条件に合う最新の記事を 1 件送ります。古い記事のこともあります。このストリームですでに配信済みなら、SDK はそれを捨てます。
- **大きなフレーム。** 32,000 バイトを超えるライブフレームは、サーバーが通知なしに破棄します。長い記事で `include: ['content']` を使うと起こり得ます。本文は `articles.get(id, { include: ['content'] })` で取得してください。
- `onAdmitted` はサーバーが購読を検査する前に呼ばれます。購読が受け入れられたという意味ではありません。
- SDK はデータを自動で補完しません。`onReconnect` が `lastSeenAt` を渡すので、REST で欠けた分を取得できます。
- ループを抜ける、`stream.close()` を呼ぶ、または abort シグナルで、ソケットが閉じられすべてのタイマーが止まります。
- キーの拒否、WebSocket を含まないプラン、無効な購読、理由が `connection_limit` のプリエンプション（`PreemptedError`）では、ストリームはエラーで終わります。その他の問題は `onError` に渡され、ストリームは動き続けます。
- **WebSocket クォータの枯渇。** 期間のクォータを使い切ると（接続の拒否、または理由が `quota_exceeded` のプリエンプション）、ストリームは終わらず、クォータが再び許すまで 1 時間ごとに再試行します。各試行は警告としてログに記録され、`onQuotaWait` に通知されます。`reconnectOnQuotaExhausted: false` にするとエラーでストリームを終えます。間隔は `quotaRetryIntervalMs` で変更できます。REST の呼び出しは待ちません。月間の 429 はすぐに失敗します。
- `rawStream` には `include` もエンリッチ用のフィルタもありません。

## Webhook

`Webhooks.constructEvent(rawBody, headers, secret)` は署名とタイムスタンプ（既定の許容差 300 秒）を確認してから本文を読みます。`WebhookEvent` を返します。署名は正しいが古い形式の本文の場合は `WrongPayloadVersion` の結果を返します。

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

署名は生のバイト列に対して計算されます。JSON パーサーが動く前に取得してください：

- Express：Webhook のルートで `express.raw({ type: 'application/json' })` を使います。
- Fastify：`addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`。
- Next.js のルートハンドラ：`await request.text()` を使い、`request.headers` を渡します。
- `node:http`：リクエストのチャンクを `Buffer` に集めます。

- 配信は重複することがあります。`eventId` で重複を除いてください。
- 5 秒以内に 2xx を返し、重い処理はその後に行ってください。
- 410 は絶対に返さないでください。Webhook がすぐに無効になります。
- ダッシュボードからのテスト配信では `isTest` が true です。
- `Webhooks.verifySignature(rawBody, signature, timestamp, secret)` は署名だけを確認します。2 つのヘッダー値を直接渡すフレームワーク向けです。
- SDK は Webhook を管理しません。作成と変更は finlight のダッシュボードで行ってください。

## エラーと再試行

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

SDK のエラーはすべて `FinlightError` を継承し、`kind` フィールド（`api`、`validation`、`network`、`timeout`、`decode`、`webhook_verification`、`preempted`）を持ちます。`FinlightApiError` には `status`、`code`、`title`、`detail`、`requestId`、`errors[]`、`apiKind` があります。論理的な呼び出しごとに専用の `X-Request-Id` を送り、再試行でも同じ値を使います。再試行のルール：

| 応答 | 再試行 |
|---|---|
| 400, 401, 403, 404 | しない |
| 429 monthly / unknown | しない |
| 429 burst | 1 回、`Retry-After` の時間（ない場合は 10 秒）待ってから。既定で有効、`retryOnBurst: 'off'` で無効 |
| 5xx, ネットワークエラー、タイムアウト | 最大 3 回、待ち時間を増やしゆらぎを付けて |

すべての呼び出しは `AbortSignal` を受け取ります。中止すると待機はすぐに終わり、再試行されず、シグナルの reason で reject されます。

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.articles.search({ query: 'ticker:TSLA' }, { signal: controller.signal });
```

## 設定

| オプション | 既定値 | 意味 |
|---|---|---|
| `apiKey` | - | 必須。 |
| `baseUrl` | `https://api.finlight.me` | REST のベース URL。 |
| `wssUrl` | `wss://wss.finlight.me` | WebSocket の URL。raw は `<wssUrl>/raw` を使います。 |
| `timeoutMs` | `30000` | HTTP 試行 1 回のタイムアウト（ミリ秒）。 |
| `totalTimeoutMs` | - | 任意。再試行と待機を含む呼び出し全体の上限。 |
| `maxRetries` | `3` | 5xx、ネットワークエラー、タイムアウトの再試行回数。 |
| `retryOnBurst` | `'once'` | 429 バースト応答に対して `'once'` または `'off'`。 |
| `burstWaitMs` | `10000` | バースト再試行の前の待ち時間。最低 10000。 |
| `maxPages` | `10` | `searchAll` のページ数の上限。 |
| `reconnectOnQuotaExhausted` / `quotaRetryIntervalMs` | `true` / `3600000` | WebSocket クォータ枯渇時のストリームの動作：1 時間ごとに再試行（`false` ならストリームを終了）。 |
| `pingIntervalMs` / `watchdogTimeoutMs` / `rotationIntervalMs` | `25000` / `60000` / `6900000` | ストリームの ping、pong ウォッチドッグ、接続の更新。 |
| `fetch` / `wsAgent` | - | 独自の `fetch`（REST）と HTTP エージェント（WebSocket）。例えばプロキシ用です。その場合はそれら自身のタイムアウトが適用されます。独自に再試行しないようにしてください。 |
| `logger` | - | `debug`/`info`/`warn`/`error` を持つ任意のロガー。 |
| `clock` | - | テスト用に差し替え可能な時計。 |

## データについて

- 古い記事の一部は `publishedAt` が `1970-01-01T00:00:00.000Z` だったり、`summary` が空だったりします。SDK はそのまま渡します。
- ロール導入前にタグ付けされた記事では、`companies[].role` と `relevance` が `null`、`events` が `[]` です。
- id 導入前に登録された記事は `articles.get` で 404 になります。`getByLink` なら見つかります。
- `availableAt` は raw では常に `null` で、導入前の記事でも `null` です。

<a id="migration"></a>

## 3.x からの移行

完全なガイドは [docs.finlight.me](https://docs.finlight.me) にあります。主な変更点：

| 3.x (API v2) | 4.x (API v3) |
|---|---|
| `new FinlightApi({ apiKey })` | `new FinlightClient({ apiKey })` |
| `articles.fetchArticles(...)` | `articles.search(...)`, `articles.searchAll(...)` |
| `articles.fetchArticleByLink(...)` | `articles.getByLink(link)`, `articles.get(id)` |
| `sources.getSources()` | `sources.list()` |
| `client.websocket.connect(params, onArticle)`, `stop()` | `for await (const item of client.stream(params))`, `stream.close()` |
| raw WebSocket クライアント | `client.rawStream(params)` |
| `WebhookService.constructEvent(body, signature, secret, timestamp)` | `Webhooks.constructEvent(rawBody, headers, secret)` |
| `logLevel` | レベルは自分の `logger` で設定 |
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
| Webhook の本文 = 記事 | `event.data` + `event.eventId` |

Webhook を v3 に切り替える手順：

1. 新しい SDK をデプロイします。`WrongPayloadVersion` には 2xx を返し、データが必要なら `json` を保存します。
2. finlight のダッシュボードで Webhook を `payloadVersion` 3 に切り替えます。
3. 約 2 時間待ちます。すでにキューに入っている再試行は古い形式で届きます。

## ログ

SDK は既定では何も出力しません。`NODE_DEBUG=finlight` でデバッグ出力が表示されます。または `logger: console`（あるいは pino、winston）を渡してください。API キー、Webhook シークレット、署名、本文全体をログに出すことはなく、プロセスハンドラーも登録しません。

## ライセンス

MIT
