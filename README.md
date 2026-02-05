# finlight API Client

The **finlight API Client** is a modern TypeScript SDK for accessing the [finlight.me](https://finlight.me) platform. It provides robust and fully-typed REST and WebSocket interfaces to fetch market-relevant news articles enriched with sentiment, metadata, and company tagging.

## ✨ Features

- 🔎 Advanced article search with flexible query language
- 🔌 Real-time article streaming via Enhanced and Raw WebSocket
- 💡 Full support for company tagging and content filters
- 🔁 Built-in retries and automatic reconnection
- 🔐 Secure API key authentication
- 📝 Configurable logging (console, winston, pino, custom)
- 🔔 Webhook support with HMAC verification
- ✅ Strong TypeScript types for better DX

---

## 📦 Installation

```bash
npm install finlight-client
```

---

## 🚀 Quick Start

### Initialize the Client

```ts
import { FinlightApi } from 'finlight-client';

const api = new FinlightApi({
  apiKey: 'your-api-key', // Required
});
```

### With Custom Logging

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key',
  logger: console, // Use console, winston, pino, or custom
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
});
```

---

## 📘 REST API Usage

### Fetch Articles

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

### Fetch Sources

```ts
const sources = await api.sources.getSources();
console.log(sources);
```

---

## 🔄 WebSocket Streaming

### Subscribe to Live Articles

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket-specific options
    takeover: false, // takeover existing connections (default: false)
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

// To disconnect
client.websocket.stop();
```

### Raw WebSocket - Subscribe to Live Articles

The Raw WebSocket delivers articles faster by skipping AI enrichment (no sentiment, confidence, or company tagging). It connects to `wss://wss.finlight.me/raw`.

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket-specific options
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

// To disconnect
client.rawWebsocket.stop();
```

**Raw WebSocket query fields:** The raw WebSocket supports field-level filtering with `source:`, `title:`, and `summary:` fields (unlike the enhanced WebSocket which also supports `ticker:`, `country:`, `exchange:`, etc.).

---

## 🔔 Webhook Support

Securely receive webhook events from finlight with HMAC signature verification:

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

## 🛠️ Configuration

### Client Options

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key', // Required
  baseUrl: 'https://api.finlight.me', // Optional
  wssUrl: 'wss://wss.finlight.me', // Optional
  timeout: 5000, // Request timeout in ms (default: 5000)
  retryCount: 3, // Retry count (default: 3)
  logger: console, // Logger instance (default: console)
  logLevel: 'info', // Log level (default: 'info')
});
```

### WebSocket Options

Both the Enhanced and Raw WebSocket clients accept the same options:

```ts
const api = new FinlightApi(
  { apiKey: 'your-api-key' },
  {
    // WebSocket options
    pingInterval: 25, // Heartbeat interval in seconds (default: 25)
    pongTimeout: 60, // Pong timeout in seconds (default: 60)
    baseReconnectDelay: 0.5, // Initial reconnect delay in seconds (default: 0.5)
    maxReconnectDelay: 10, // Max reconnect delay in seconds (default: 10)
    takeover: false, // Takeover existing connections (default: false)
    onClose: (code, reason) => {
      // Custom close handler
      console.log('Closed:', code, reason);
    },
  },
);
```

---

## 📝 Logging

### Built-in Loggers

```ts
import { FinlightApi, noopLogger } from 'finlight-client';

// Silent mode
const api = new FinlightApi({
  apiKey: 'key',
  logger: noopLogger,
});

// Console logging (default)
const api = new FinlightApi({
  apiKey: 'key',
  logger: console,
  logLevel: 'debug',
});
```

### Custom Logger

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

### Winston/Pino Integration

```ts
import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const api = new FinlightApi({
  apiKey: 'key',
  logger: winstonLogger, // Pass winston/pino directly!
});
```

---

## 🧾 Types & Interfaces

### `GetArticlesParams`

```ts
interface GetArticlesParams {
  query?: string; // Advanced query: (ticker:AAPL OR ticker:NVDA)
  tickers?: string[]; // Filter by tickers: ['AAPL', 'NVDA']
  sources?: string[]; // Limit to specific sources
  excludeSources?: string[]; // Exclude specific sources
  optInSources?: string[]; // Additional sources to include
  countries?: string[]; // Filter by country codes: ['US', 'GB']
  includeContent?: boolean; // Include full article content
  includeEntities?: boolean; // Include tagged company data
  excludeEmptyContent?: boolean; // Skip articles with no content
  from?: string; // Start date (YYYY-MM-DD or ISO)
  to?: string; // End date (YYYY-MM-DD or ISO)
  language?: string; // Language filter (default: 'en')
  orderBy?: 'publishDate' | 'createdAt';
  order?: 'ASC' | 'DESC';
  pageSize?: number; // Results per page (1-1000)
  page?: number; // Page number
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
  countries?: string[]; // Filter by country codes: ['US', 'GB']
  includeContent?: boolean;
  includeEntities?: boolean;
  excludeEmptyContent?: boolean;
  language?: string;
}
```

### `GetRawArticlesWebSocketParams`

```ts
interface GetRawArticlesWebSocketParams {
  query?: string; // Field filters: source:, title:, summary:
  sources?: string[]; // Limit to specific sources
  excludeSources?: string[]; // Exclude specific sources
  optInSources?: string[]; // Additional sources to include
  language?: string; // Language filter (default: 'en')
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

## ❗ Error Handling & Retry Logic

### REST API Retries

The client automatically retries failed HTTP requests for:

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

Retry behavior uses exponential backoff (500ms, 1000ms, 2000ms, etc.).

### WebSocket Reconnection

On disconnection, the client automatically attempts to reconnect with:

- Exponential backoff (0.5s → 1s → 2s → ... → 10s max)
- Proactive connection rotation (every 115 minutes to avoid AWS 2-hour limit)
- Rate limit and error handling with appropriate backoff

---

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

Integration tests require a valid API key:

```bash
# All integration tests
FINLIGHT_API_KEY=your_key npm run test:integration

# API tests only
FINLIGHT_API_KEY=your_key npm run test:integration:api

# WebSocket tests only
FINLIGHT_API_KEY=your_key npm run test:integration:ws
```

---

## 📮 Support

If you encounter issues or have questions:

- 📧 Email: [info@finlight.me](mailto:info@finlight.me)
- 🐛 Issues: [GitHub Issues](https://github.com/jubeiargh/finlight-client/issues)

---

## 🎉 Happy coding!

finlight helps you stay ahead of the market with real-time, enriched news feeds.
