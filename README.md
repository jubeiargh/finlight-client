# Finlight API Client

The **Finlight API Client** is a modern TypeScript SDK for accessing the [Finlight.me](https://finlight.me) platform. It provides robust and fully-typed REST and WebSocket interfaces to fetch market-relevant news articles enriched with sentiment, metadata, and company tagging.

## ✨ Features

- 🔎 Advanced article search with flexible query language
- 🔌 Real-time article streaming via WebSocket
- 💡 Full support for company tagging and content filters
- 🔁 Built-in retries for robust request handling
- 🔐 Secure API key authentication
- ✅ Strong TypeScript types for better DX

---

## 📦 Installation

Install the package via npm:

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

---

## 📘 REST API Usage

### Fetch Articles

```ts
(async () => {
  const articles = await api.articles.fetchArticles({
    query: '(ticker:AAPL OR ticker:TSLA) AND "earnings"',
    language: 'en',
    pageSize: 10,
    includeCompanies: true,
    hasContent: true,
  });

  console.log(articles);
})();
```

### Fetch Sources

```ts
(async () => {
  const sources = await api.sources.getSources();
  console.log(sources);
})();
```

---

## 🔄 WebSocket Streaming

### Subscribe to Live Articles

```ts
import { FinlightApi } from 'finlight-client';

const client = new FinlightApi({
  apiKey: 'your-api-key',
});

client.websocket.connect(
  {
    query: 'AI AND ticker:NVDA',
    language: 'en',
    extended: true,
    includeCompanies: true,
  },
  (article) => {
    console.log('Live article:', article);
  },
);

// To disconnect
// client.websocket.disconnect();
```

---

## 🛠️ Configuration

You can pass configuration options to customize behavior:

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.finlight.me', // optional
  wssUrl: 'wss://api.finlight.me/ws', // optional
  timeout: 10000,
  retryCount: 5,
});
```

---

## 🧾 Types & Interfaces

### `GetArticlesParams`

```ts
interface GetArticlesParams {
  query: string;
  language?: string;
  sources?: string[];
  excludeSources?: string[];
  optInSources?: string[];
  tickers?: string[];
  includeCompanies?: boolean;
  hasContent?: boolean;
  from?: string; // ISO string or YYYY-MM-DD
  to?: string;
  order?: 'ASC' | 'DESC';
  pageSize?: number;
  page?: number;
}
```

### `Article`

```ts
interface Article {
  link: string;
  title: string;
  publishDate: Date;
  authors: string;
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
}
```

---

## 🧩 WebSocket API

### `GetArticlesWebSocketParams`

```ts
interface GetArticlesWebSocketParams {
  query: string;
  language?: string;
  extended: boolean;
  sources?: string[];
  excludeSources?: string[];
  optInSources?: string[];
  tickers?: string[];
  includeCompanies?: boolean;
  hasContent?: boolean;
}
```

---

## ❗ Error Handling & Retry Logic

The client retries failed HTTP requests up to the configured `retryCount` for:

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

On WebSocket disconnection, the client attempts automatic reconnection every second unless `SIGINT` is received or `shouldReconnect` is disabled.

---

## 📮 Support

If you encounter issues or have questions:

- 📧 Email: [info@finlight.me](mailto:info@finlight.me)

---

## 🎉 Happy coding!

Finlight helps you stay ahead of the market with real-time, enriched news feeds.
