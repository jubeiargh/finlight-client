# finlight API Client

*[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | 한국어*

**finlight API Client**는 [finlight.me](https://finlight.me) 플랫폼을 사용하기 위한 최신 TypeScript SDK입니다. 감성, 메타데이터, 기업 태깅이 부가된 시장 관련 뉴스를 조회할 수 있도록 견고하고 완전히 타입이 지정된 REST 및 WebSocket 인터페이스를 제공합니다.

## ✨ 주요 기능

- 🔎 유연한 쿼리 언어를 지원하는 고급 기사 검색
- 🔌 Enhanced 및 Raw WebSocket을 통한 실시간 기사 스트리밍
- 💡 기업 태깅과 본문 필터 완전 지원
- 🔁 재시도와 자동 재연결 기본 내장
- 🔐 안전한 API 키 인증
- 📝 구성 가능한 로깅(console, winston, pino, 사용자 정의)
- 🔔 HMAC 검증을 포함한 Webhook 지원
- ✅ 개발 경험을 높이는 엄격한 TypeScript 타입

---

## 📦 설치

```bash
npm install finlight-client
```

---

## 🚀 빠른 시작

### 클라이언트 초기화

```ts
import { FinlightApi } from 'finlight-client';

const api = new FinlightApi({
  apiKey: 'your-api-key', // 필수
});
```

### 사용자 정의 로깅 사용

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key',
  logger: console, // console, winston, pino 또는 사용자 정의
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
});
```

---

## 📘 REST API 사용법

### 기사 조회

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

### 링크로 기사 조회

```ts
const article = await api.articles.fetchArticleByLink({
  link: 'https://www.reuters.com/technology/example-article',
  includeContent: true,
  includeEntities: true,
});

console.log(article);
```

### 뉴스 소스 조회

```ts
const sources = await api.sources.getSources();
console.log(sources);
```

---

## 🔄 WebSocket 스트리밍

### 실시간 기사 구독

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 전용 옵션
    takeover: false, // 기존 연결을 테이크오버(기본값: false)
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

// 연결 해제
client.websocket.stop();
```

### Raw WebSocket으로 실시간 기사 구독

Raw WebSocket은 AI 보강 처리(감성, 신뢰도, 기업 태깅)를 건너뛰기 때문에 더 빠르게 기사를 전달합니다. 접속 주소는 `wss://wss.finlight.me/raw`입니다.

```ts
const client = new FinlightApi(
  {
    apiKey: 'your-api-key',
    logger: console,
    logLevel: 'info',
  },
  {
    // WebSocket 전용 옵션
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

// 연결 해제
client.rawWebsocket.stop();
```

**Raw WebSocket 쿼리 필드:** Raw WebSocket은 `source:`, `title:`, `summary:` 필드 단위 필터링을 지원합니다(Enhanced WebSocket은 여기에 더해 `ticker:`, `country:`, `exchange:` 등도 지원합니다).

---

## 🔔 Webhook 지원

HMAC 서명 검증을 통해 finlight의 Webhook 이벤트를 안전하게 수신할 수 있습니다:

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

## 🛠️ 설정

### 클라이언트 옵션

```ts
const api = new FinlightApi({
  apiKey: 'your-api-key', // 필수
  baseUrl: 'https://api.finlight.me', // 선택
  wssUrl: 'wss://wss.finlight.me', // 선택
  timeout: 5000, // 요청 타임아웃(ms, 기본값: 5000)
  retryCount: 3, // 재시도 횟수(기본값: 3)
  logger: console, // 로거 인스턴스(기본값: console)
  logLevel: 'info', // 로그 레벨(기본값: 'info')
});
```

### WebSocket 옵션

Enhanced와 Raw WebSocket 클라이언트는 동일한 옵션을 받습니다:

```ts
const api = new FinlightApi(
  { apiKey: 'your-api-key' },
  {
    // WebSocket 옵션
    pingInterval: 25, // 하트비트 간격(초, 기본값: 25)
    pongTimeout: 60, // Pong 타임아웃(초, 기본값: 60)
    baseReconnectDelay: 0.5, // 최초 재연결 지연(초, 기본값: 0.5)
    maxReconnectDelay: 10, // 최대 재연결 지연(초, 기본값: 10)
    takeover: false, // 기존 연결을 테이크오버(기본값: false)
    onClose: (code, reason) => {
      // 사용자 정의 종료 핸들러
      console.log('Closed:', code, reason);
    },
  },
);
```

---

## 📝 로깅

### 내장 로거

```ts
import { FinlightApi, noopLogger } from 'finlight-client';

// 사일런트 모드
const api = new FinlightApi({
  apiKey: 'key',
  logger: noopLogger,
});

// 콘솔 로깅(기본값)
const api = new FinlightApi({
  apiKey: 'key',
  logger: console,
  logLevel: 'debug',
});
```

### 사용자 정의 로거

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

### Winston / Pino 연동

```ts
import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const api = new FinlightApi({
  apiKey: 'key',
  logger: winstonLogger, // winston / pino를 그대로 전달하면 됩니다
});
```

---

## 🧾 타입과 인터페이스

### `GetArticlesParams`

```ts
interface GetArticlesParams {
  query?: string; // 고급 쿼리: (ticker:AAPL OR ticker:NVDA)
  tickers?: string[]; // 티커로 필터링: ['AAPL', 'NVDA']
  sources?: string[]; // 특정 뉴스 소스로 제한
  excludeSources?: string[]; // 특정 뉴스 소스 제외
  optInSources?: string[]; // 추가로 포함할 뉴스 소스
  countries?: string[]; // 국가 코드로 필터링: ['US', 'GB']
  includeContent?: boolean; // 기사 전문 포함
  includeEntities?: boolean; // 태깅된 기업 데이터 포함
  excludeEmptyContent?: boolean; // 본문이 없는 기사 건너뛰기
  from?: string; // 시작일(YYYY-MM-DD 또는 ISO 형식)
  to?: string; // 종료일(YYYY-MM-DD 또는 ISO 형식)
  language?: string; // 언어 필터(기본값: 'en')
  orderBy?: 'publishDate' | 'createdAt' | 'revisedDate';
  order?: 'ASC' | 'DESC';
  pageSize?: number; // 페이지당 결과 수(1~1000)
  page?: number; // 페이지 번호
}
```

### `GetArticleByLinkParams`

```ts
interface GetArticleByLinkParams {
  link: string; // 조회할 기사의 URL
  includeContent?: boolean; // 기사 전문 포함
  includeEntities?: boolean; // 태깅된 기업 데이터 포함
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
  countries?: string[]; // 국가 코드로 필터링: ['US', 'GB']
  includeContent?: boolean;
  includeEntities?: boolean;
  excludeEmptyContent?: boolean;
  language?: string;
}
```

### `GetRawArticlesWebSocketParams`

```ts
interface GetRawArticlesWebSocketParams {
  query?: string; // 필드 필터: source:, title:, summary:
  sources?: string[]; // 특정 뉴스 소스로 제한
  excludeSources?: string[]; // 특정 뉴스 소스 제외
  optInSources?: string[]; // 추가로 포함할 뉴스 소스
  language?: string; // 언어 필터(기본값: 'en')
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

## ❗ 오류 처리와 재시도 로직

### REST API 재시도

다음 상태로 실패한 HTTP 요청은 자동으로 재시도됩니다:

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

재시도는 지수 백오프로 이루어집니다(500ms, 1000ms, 2000ms 등).

### WebSocket 재연결

연결이 끊기면 클라이언트는 다음과 같이 자동으로 재연결을 시도합니다:

- 지수 백오프(0.5s → 1s → 2s → … → 최대 10s)
- 선제적 연결 교체(AWS 2시간 제한을 피하기 위해 115분마다)
- 속도 제한과 오류에 대한 적절한 백오프 처리

---

## 🧪 테스트

### 단위 테스트

```bash
npm test
```

### 통합 테스트

통합 테스트에는 유효한 API 키가 필요합니다:

```bash
# 전체 통합 테스트
FINLIGHT_API_KEY=your_key npm run test:integration

# API 테스트만
FINLIGHT_API_KEY=your_key npm run test:integration:api

# WebSocket 테스트만
FINLIGHT_API_KEY=your_key npm run test:integration:ws
```

---

## 📮 지원

문제가 있거나 궁금한 점이 있으면:

- 📧 이메일: [info@finlight.me](mailto:info@finlight.me)
- 🐛 이슈: [GitHub Issues](https://github.com/jubeiargh/finlight-client/issues)
- 🇰🇷 한국어 제품 페이지: [finlight.me/ko/news-api](https://finlight.me/ko/news-api)

---

## 🎉 Happy coding!

finlight는 실시간으로 보강된 뉴스 피드를 통해 시장의 움직임에 앞서 대응할 수 있도록 돕습니다.
