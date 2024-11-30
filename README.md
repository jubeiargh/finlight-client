# Finlight API Client

The Finlight API Client is a TypeScript library that provides an easy-to-use interface for accessing the [Finlight.me API](https://finlight.me). It supports both RESTful API calls and WebSocket subscriptions, allowing you to fetch market-relevant articles and receive real-time updates.

## Features

- Fetch basic or extended articles using REST endpoints.
- Subscribe to WebSocket streams for real-time updates.
- Built-in retry mechanism for robust API interactions.
- Strongly typed with TypeScript for improved developer experience.
- Support for `x-api-key` authentication.

---

## Installation

Install the package using npm:

```bash
npm i finlight-client
```

---

## Usage

### REST API

#### Initialize the Client

```typescript
import { FinlightApi } from 'finlight-client';

const api = new FinlightApi({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.finlight.me',
});
```

#### Fetch Basic Articles

```typescript
(async () => {
  try {
    const articles = await api.articles.getBasicArticles({
      query: 'economy',
      language: 'en',
      page: 1,
      pageSize: 10,
    });
    console.log(articles);
  } catch (error) {
    console.error('Error fetching basic articles:', error);
  }
})();
```

#### Fetch Extended Articles

```typescript
(async () => {
  try {
    const articles = await api.articles.getExtendedArticles({
      query: 'technology',
      source: 'www.bbc.com',
      language: 'en',
      page: 1,
      pageSize: 5,
    });
    console.log(articles);
  } catch (error) {
    console.error('Error fetching extended articles:', error);
  }
})();
```

---

### WebSocket API

#### Subscribe to Basic or Extended Articles

```typescript
import { WebSocketClient } from 'finlight-client';

const websocketClient = new WebSocketClient('your-api-key');

// Subscribe to basic articles
websocketClient.connect({ query: 'economy', extended: false }, (article) => {
  console.log('Received basic article:', article);
});

// Subscribe to extended articles
websocketClient.connect({ query: 'technology', extended: true }, (article) => {
  console.log('Received extended article:', article);
});

// Disconnect when done
websocketClient.disconnect();
```

---

## API Documentation

### REST Endpoints

#### Articles Service

- `getBasicArticles(params: GetBasicArticlesParams): Promise<GetBasicArticleResponse>`

  - Fetch basic article information with filtering options.

- `getExtendedArticles(params: GetExtendedArticlesParams): Promise<GetBasicArticleResponse>`
  - Fetch extended article information, including full content and sentiment analysis.

### WebSocket Client

- `connect(requestPayload: GetArticlesRequestDto, onMessage: (article: Article | BasicArticle) => void): void`

  - Subscribe to basic or extended articles based on the `extended` field in `requestPayload`.

- `disconnect(): void`
  - Disconnect the WebSocket client.

---

## Types

### REST

#### `GetBasicArticlesParams`

```typescript
interface GetBasicArticlesParams {
  query: string;
  source?: string;
  language?: string;
  order?: 'ASC' | 'DESC';
  pageSize?: number;
  page?: number;
}
```

#### `GetBasicArticleResponse`

```typescript
interface GetBasicArticleResponse {
  status: string;
  totalResults: number;
  page: number;
  pageSize: number;
  articles: BasicArticle[];
}
```

#### `BasicArticle`

```typescript
interface BasicArticle {
  link: string;
  title: string;
  authors: string;
  publish_date: string;
  language: string;
  sentiment: string;
  confidence: string;
  source: string;
}
```

---

### WebSocket

#### `GetArticlesRequestDto`

```typescript
interface GetArticlesRequestDto {
  query?: string;
  source?: string;
  language?: string;
  extended: boolean;
}
```

#### `Article`

```typescript
interface Article {
  link: string;
  title: string;
  authors: string;
  publish_date: string;
  language: string;
  sentiment: string;
  confidence: string;
  source: string;
  content: string;
  summary: string;
}
```

---

## Configuration

You can configure the client using the following options:

- `apiKey` (required): Your Finlight API key.
- `baseUrl`: The base URL for API requests (default: `https://api.finlight.me`).
- `timeout`: Timeout for REST API requests in milliseconds (default: `5000`).
- `retryCount`: Number of retry attempts for failed API requests (default: `3`).

Example:

```typescript
const api = new FinlightApi({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.finlight.me',
  timeout: 10000,
  retryCount: 5,
});
```

---

## Error Handling

The client automatically retries failed requests (up to the configured `retryCount`) for the following HTTP status codes:

- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

For other errors, or if retries are exhausted, the client will throw an exception.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Support

If you encounter any issues or have questions, feel free to reach out:

- Email: [info@finlight.me](mailto:info@finlight.me)

Happy coding! 🎉
