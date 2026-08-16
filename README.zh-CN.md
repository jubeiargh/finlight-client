# finlight API Client

*[English](README.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md)*

**finlight API Client** 是用于对接 [finlight.me](https://finlight.me) 平台的现代 TypeScript SDK。它提供稳定且完整类型化的 REST 和 WebSocket 接口，用于获取带情感、元数据和公司实体标注的市场相关新闻。

## ✨ 功能特性

- 🔎 支持灵活查询语言的进阶文章检索
- 🔌 通过 Enhanced 和 Raw WebSocket 订阅实时文章推送
- 💡 完整支持公司实体标注和正文过滤
- 🔁 内置重试与自动重连
- 🔐 安全的 API 密钥认证
- 📝 可配置日志（console、winston、pino、自定义）
- 🔔 支持 Webhook，含 HMAC 验证
- ✅ 完整的 TypeScript 类型，提升开发体验

---

## 📦 安装

```bash
npm install finlight-client
```

---

## 🚀 快速开始

### 初始化客户端

```ts
import { FinlightApi } from 'finlight-client';

const api = new FinlightApi({
  apiKey: 'your-api-key', // 必填
});
```

### 使用自定义日志

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key',
  logger: console, // 可用 console、winston、pino 或自定义
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
});
```

---

## 📘 REST API 用法

### 获取文章

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

### 通过链接获取单篇文章

```ts
const article = await api.articles.fetchArticleByLink({
  link: 'https://www.reuters.com/technology/example-article',
  includeContent: true,
  includeEntities: true,
});

console.log(article);
```

### 获取新闻源列表

```ts
const sources = await api.sources.getSources();
console.log(sources);
```

---

## 🔄 WebSocket 流式订阅

### 订阅实时文章

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 专用选项
    takeover: false, // 接管已有连接（默认：false）
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

// 断开连接
client.websocket.stop();
```

### Raw WebSocket - 订阅实时文章

Raw WebSocket 跳过 AI 增强处理（不含情感、置信度和公司标注），因此推送更快。它连接至 `wss://wss.finlight.me/raw`。

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 专用选项
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

// 断开连接
client.rawWebsocket.stop();
```

**Raw WebSocket 查询字段：** Raw WebSocket 支持 `source:`、`title:` 和 `summary:` 字段级过滤（Enhanced WebSocket 还额外支持 `ticker:`、`country:`、`exchange:` 等字段）。

---

## 🔔 Webhook 支持

通过 HMAC 签名验证安全地接收来自 finlight 的 Webhook 事件：

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

## 🛠️ 配置

### 客户端选项

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key', // 必填
  baseUrl: 'https://api.finlight.me', // 可选
  wssUrl: 'wss://wss.finlight.me', // 可选
  timeout: 5000, // 请求超时（毫秒，默认：5000）
  retryCount: 3, // 重试次数（默认：3）
  logger: console, // 日志实例（默认：console）
  logLevel: 'info', // 日志级别（默认：'info'）
});
```

### WebSocket 选项

Enhanced 和 Raw WebSocket 客户端接受相同的选项：

```ts
const api = new FinlightApi(
  { apiKey: 'your-api-key' },
  {
    // WebSocket 选项
    pingInterval: 25, // 心跳间隔（秒，默认：25）
    pongTimeout: 60, // Pong 超时（秒，默认：60）
    baseReconnectDelay: 0.5, // 初始重连延迟（秒，默认：0.5）
    maxReconnectDelay: 10, // 最大重连延迟（秒，默认：10）
    takeover: false, // 接管已有连接（默认：false）
    onClose: (code, reason) => {
      // 自定义关闭处理
      console.log('Closed:', code, reason);
    },
  },
);
```

---

## 📝 日志

### 内置日志器

```ts
import { FinlightApi, noopLogger } from 'finlight-client';

// 静默模式
const api = new FinlightApi({
  apiKey: 'key',
  logger: noopLogger,
});

// 控制台日志（默认）
const api = new FinlightApi({
  apiKey: 'key',
  logger: console,
  logLevel: 'debug',
});
```

### 自定义日志器

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

### 集成 Winston/Pino

```ts
import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const api = new FinlightApi({
  apiKey: 'key',
  logger: winstonLogger, // 直接传入 winston/pino 实例即可
});
```

---

## 🧾 类型与接口

### `GetArticlesParams`

```ts
interface GetArticlesParams {
  query?: string; // 进阶查询：(ticker:AAPL OR ticker:NVDA)
  tickers?: string[]; // 按股票代码过滤：['AAPL', 'NVDA']
  sources?: string[]; // 限定特定新闻源
  excludeSources?: string[]; // 排除特定新闻源
  optInSources?: string[]; // 额外纳入的新闻源
  countries?: string[]; // 按国家代码过滤：['US', 'GB']
  includeContent?: boolean; // 返回文章全文
  includeEntities?: boolean; // 返回标注的公司数据
  excludeEmptyContent?: boolean; // 跳过无正文的文章
  from?: string; // 起始日期（YYYY-MM-DD 或 ISO 格式）
  to?: string; // 结束日期（YYYY-MM-DD 或 ISO 格式）
  language?: string; // 语言过滤（默认：'en'）
  orderBy?: 'publishDate' | 'createdAt' | 'revisedDate';
  order?: 'ASC' | 'DESC';
  pageSize?: number; // 每页条数（1-1000）
  page?: number; // 页码
}
```

### `GetArticleByLinkParams`

```ts
interface GetArticleByLinkParams {
  link: string; // 待获取文章的 URL
  includeContent?: boolean; // 返回文章全文
  includeEntities?: boolean; // 返回标注的公司数据
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
  countries?: string[]; // 按国家代码过滤：['US', 'GB']
  includeContent?: boolean;
  includeEntities?: boolean;
  excludeEmptyContent?: boolean;
  language?: string;
}
```

### `GetRawArticlesWebSocketParams`

```ts
interface GetRawArticlesWebSocketParams {
  query?: string; // 字段过滤：source:、title:、summary:
  sources?: string[]; // 限定特定新闻源
  excludeSources?: string[]; // 排除特定新闻源
  optInSources?: string[]; // 额外纳入的新闻源
  language?: string; // 语言过滤（默认：'en'）
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

## ❗ 错误处理与重试逻辑

### REST API 重试

客户端会对以下失败的 HTTP 请求自动重试：

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

重试采用指数退避（500ms、1000ms、2000ms，依此类推）。

### WebSocket 重连

连接断开后，客户端会自动尝试重连，具体行为如下：

- 指数退避（0.5s → 1s → 2s → …… → 最大 10s）
- 主动连接轮换（每 115 分钟一次，以规避 AWS 2 小时限制）
- 针对速率限制和错误采用相应的退避处理

---

## 🧪 测试

### 单元测试

```bash
npm test
```

### 集成测试

集成测试需要有效的 API 密钥：

```bash
# 全部集成测试
FINLIGHT_API_KEY=your_key npm run test:integration

# 仅 API 测试
FINLIGHT_API_KEY=your_key npm run test:integration:api

# 仅 WebSocket 测试
FINLIGHT_API_KEY=your_key npm run test:integration:ws
```

---

## 📮 支持

如遇到问题或有疑问：

- 📧 邮箱：[info@finlight.me](mailto:info@finlight.me)
- 🐛 问题反馈：[GitHub Issues](https://github.com/jubeiargh/finlight-client/issues)
- 🌏 中文产品页：[finlight.me/zh/news-api](https://finlight.me/zh/news-api)

---

## 🎉 祝编码愉快！

finlight 通过实时、经过增强的新闻流，帮助你更早地掌握市场动态。
