# finlight API Client

*[English](README.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md)*

**finlight API Client** は、[finlight.me](https://finlight.me) プラットフォームを利用するためのモダンな TypeScript SDK です。センチメント、メタデータ、企業タグ付けが付与されたマーケット関連ニュースを取得するための、堅牢かつ完全に型付けされた REST および WebSocket インターフェースを提供します。

## ✨ 主な機能

- 🔎 柔軟なクエリ言語による高度な記事検索
- 🔌 Enhanced および Raw WebSocket によるリアルタイム記事配信
- 💡 企業タグ付けと本文フィルタの完全サポート
- 🔁 リトライと自動再接続を標準搭載
- 🔐 安全な API キー認証
- 📝 設定可能なロギング（console、winston、pino、カスタム）
- 🔔 HMAC 検証付きの Webhook 対応
- ✅ 開発体験を高める厳密な TypeScript 型

---

## 📦 インストール

```bash
npm install finlight-client
```

---

## 🚀 クイックスタート

### クライアントの初期化

```ts
import { FinlightApi } from 'finlight-client';

const api = new FinlightApi({
  apiKey: 'your-api-key', // 必須
});
```

### カスタムロガーを使う

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key',
  logger: console, // console、winston、pino、カスタムのいずれか
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
});
```

---

## 📘 REST API の使い方

### 記事を取得する

```ts
const response = await api.articles.fetchArticles({
  query: '(ticker:AAPL OR ticker:TSLA) AND "earnings"',
  tickers: ['AAPL', 'TSLA'],
  countries: ['US'],
  language: 'en',
  pageSize: 10,
  includeEntities: true,
  includeContent: true,
  from: '2024-01-01',
  to: '2024-12-31',
});

console.log(response.articles);
```

### リンクから単一の記事を取得する

```ts
const article = await api.articles.fetchArticleByLink({
  link: 'https://www.reuters.com/technology/example-article',
  includeContent: true,
  includeEntities: true,
});

console.log(article);
```

### ニュースソースを取得する

```ts
const sources = await api.sources.getSources();
console.log(sources);
```

---

## 🔄 WebSocket ストリーミング

### ライブ記事を購読する

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 固有のオプション
    takeover: false, // 既存コネクションをテイクオーバーする（デフォルト: false）
  },
);

client.websocket.connect(
  {
    query: 'AI AND ticker:NVDA',
    tickers: ['NVDA'],
    language: 'en',
    includeContent: true,
    includeEntities: true,
  },
  (article) => {
    console.log('Live article:', article);
  },
);

// 切断する場合
client.websocket.stop();
```

### Raw WebSocket でライブ記事を購読する

Raw WebSocket は AI エンリッチメント（センチメント、確信度、企業タグ付け）を行わないぶん、より高速に記事を配信します。接続先は `wss://wss.finlight.me/raw` です。

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 固有のオプション
    takeover: true,
  },
);

client.rawWebsocket.connect(
  {
    query: 'title:Nvidia',
    sources: ['reuters.com'],
    language: 'en',
  },
  (article) => {
    console.log('Raw article:', article);
  },
);

// 切断する場合
client.rawWebsocket.stop();
```

**Raw WebSocket のクエリフィールド:** Raw WebSocket は `source:`、`title:`、`summary:` のフィールド単位フィルタに対応しています（Enhanced WebSocket はこれに加えて `ticker:`、`country:`、`exchange:` などにも対応します）。

---

## 🔔 Webhook 対応

HMAC 署名検証により、finlight からの Webhook イベントを安全に受信できます:

```ts
import { WebhookService } from 'finlight-client';
import express from 'express';

const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const article = WebhookService.constructEvent(
      req.body.toString(),
      req.headers['x-webhook-signature'] as string,
      process.env.WEBHOOK_SECRET!,
      req.headers['x-webhook-timestamp'] as string,
    );

    console.log('New article:', article.title);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    res.sendStatus(400);
  }
});
```

---

## 🛠️ 設定

### クライアントオプション

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key', // 必須
  baseUrl: 'https://api.finlight.me', // 任意
  wssUrl: 'wss://wss.finlight.me', // 任意
  timeout: 5000, // リクエストタイムアウト（ms、デフォルト: 5000）
  retryCount: 3, // リトライ回数（デフォルト: 3）
  logger: console, // ロガーインスタンス（デフォルト: console）
  logLevel: 'info', // ログレベル（デフォルト: 'info'）
});
```

### WebSocket オプション

Enhanced と Raw の WebSocket クライアントは同じオプションを受け付けます:

```ts
const api = new FinlightApi(
  { apiKey: 'your-api-key' },
  {
    // WebSocket オプション
    pingInterval: 25, // ハートビート間隔（秒、デフォルト: 25）
    pongTimeout: 60, // Pong タイムアウト（秒、デフォルト: 60）
    baseReconnectDelay: 0.5, // 初回再接続までの遅延（秒、デフォルト: 0.5）
    maxReconnectDelay: 10, // 再接続遅延の上限（秒、デフォルト: 10）
    takeover: false, // 既存コネクションをテイクオーバーする（デフォルト: false）
    onClose: (code, reason) => {
      // カスタムのクローズハンドラ
      console.log('Closed:', code, reason);
    },
  },
);
```

---

## 📝 ロギング

### 組み込みロガー

```ts
import { FinlightApi, noopLogger } from 'finlight-client';

// サイレントモード
const api = new FinlightApi({
  apiKey: 'key',
  logger: noopLogger,
});

// コンソール出力（デフォルト）
const api = new FinlightApi({
  apiKey: 'key',
  logger: console,
  logLevel: 'debug',
});
```

### カスタムロガー

```ts
import { Logger } from 'finlight-client';

const customLogger: Logger = {
  debug: (...args) => console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

const api = new FinlightApi({
  apiKey: 'key',
  logger: customLogger,
});
```

### Winston / Pino との連携

```ts
import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const api = new FinlightApi({
  apiKey: 'key',
  logger: winstonLogger, // winston / pino をそのまま渡せます
});
```

---

## 🧾 型とインターフェース

### `GetArticlesParams`

```ts
interface GetArticlesParams {
  query?: string; // 高度なクエリ: (ticker:AAPL OR ticker:NVDA)
  tickers?: string[]; // ティッカーで絞り込み: ['AAPL', 'NVDA']
  sources?: string[]; // 特定のニュースソースに限定
  excludeSources?: string[]; // 特定のニュースソースを除外
  optInSources?: string[]; // 追加で含めるニュースソース
  countries?: string[]; // 国コードで絞り込み: ['US', 'GB']
  includeContent?: boolean; // 記事全文を含める
  includeEntities?: boolean; // タグ付けされた企業データを含める
  excludeEmptyContent?: boolean; // 本文のない記事をスキップ
  from?: string; // 開始日（YYYY-MM-DD または ISO 形式）
  to?: string; // 終了日（YYYY-MM-DD または ISO 形式）
  language?: string; // 言語フィルタ（デフォルト: 'en'）
  orderBy?: 'publishDate' | 'createdAt' | 'revisedDate';
  order?: 'ASC' | 'DESC';
  pageSize?: number; // 1 ページあたりの件数（1〜1000）
  page?: number; // ページ番号
}
```

### `GetArticleByLinkParams`

```ts
interface GetArticleByLinkParams {
  link: string; // 取得する記事の URL
  includeContent?: boolean; // 記事全文を含める
  includeEntities?: boolean; // タグ付けされた企業データを含める
}
```

### `GetArticlesWebSocketParams`

```ts
interface GetArticlesWebSocketParams {
  query?: string;
  tickers?: string[];
  sources?: string[];
  excludeSources?: string[];
  optInSources?: string[];
  countries?: string[]; // 国コードで絞り込み: ['US', 'GB']
  includeContent?: boolean;
  includeEntities?: boolean;
  excludeEmptyContent?: boolean;
  language?: string;
}
```

### `GetRawArticlesWebSocketParams`

```ts
interface GetRawArticlesWebSocketParams {
  query?: string; // フィールドフィルタ: source:、title:、summary:
  sources?: string[]; // 特定のニュースソースに限定
  excludeSources?: string[]; // 特定のニュースソースを除外
  optInSources?: string[]; // 追加で含めるニュースソース
  language?: string; // 言語フィルタ（デフォルト: 'en'）
}
```

### `Article`

```ts
interface Article {
  link: string;
  title: string;
  publishDate: Date;
  createdAt?: Date;
  source: string;
  language: string;
  sentiment?: string;
  confidence?: number;
  summary?: string;
  images?: string[];
  content?: string;
  companies?: Company[];
}
```

### `RawArticle`

```ts
interface RawArticle {
  link: string;
  title: string;
  publishDate: Date;
  createdAt?: Date;
  source: string;
  language: string;
  summary?: string;
  images?: string[];
}
```

### `Company`

```ts
interface Company {
  companyId: number;
  confidence?: number;
  country?: string;
  exchange?: string;
  industry?: string;
  sector?: string;
  name: string;
  ticker: string;
  isin?: string;
  openfigi?: string;
  primaryListing?: Listing;
  isins?: string[];
  otherListings?: Listing[];
}
```

---

## ❗ エラーハンドリングとリトライ

### REST API のリトライ

以下のステータスで失敗した HTTP リクエストは自動的にリトライされます:

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

リトライは指数バックオフで行われます（500ms、1000ms、2000ms、……）。

### WebSocket の再接続

切断時、クライアントは以下の挙動で自動的に再接続を試みます:

- 指数バックオフ（0.5s → 1s → 2s → …… → 最大 10s）
- 先回りのコネクションローテーション（AWS の 2 時間制限を避けるため 115 分ごと）
- レート制限とエラーに応じた適切なバックオフ処理

---

## 🧪 テスト

### ユニットテスト

```bash
npm test
```

### 統合テスト

統合テストには有効な API キーが必要です:

```bash
# すべての統合テスト
FINLIGHT_API_KEY=your_key npm run test:integration

# API テストのみ
FINLIGHT_API_KEY=your_key npm run test:integration:api

# WebSocket テストのみ
FINLIGHT_API_KEY=your_key npm run test:integration:ws
```

---

## 📮 サポート

問題やご質問がある場合:

- 📧 メール: [info@finlight.me](mailto:info@finlight.me)
- 🐛 Issue: [GitHub Issues](https://github.com/jubeiargh/finlight-client/issues)
- 🗾 日本語の製品ページ: [finlight.me/ja/news-api](https://finlight.me/ja/news-api)

---

## 🎉 Happy coding!

finlight は、リアルタイムかつ付加情報の付いたニュースフィードにより、市場の動きに先んじる助けとなります。
