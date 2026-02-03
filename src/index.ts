import { ApiClient } from './client/apiClient';
import { WebSocketClient, WebSocketClientOptions } from './client/webSocketClient';
import { RawWebSocketClient, RawWebSocketClientOptions } from './client/rawWebSocketClient';
import { ArticleService } from './services/articleService';
import { SourceService } from './services/sourceService';
import { WebhookService } from './services/webhookService';
import { ApiClientConfig, defaultApiConfig } from './types/config';

export { ApiClientConfig } from './types/config';
export type * from './types/types';
export { WebSocketResponse, WebSocketClientOptions } from './client/webSocketClient';
export { RawWebSocketClientOptions } from './client/rawWebSocketClient';
export { WebhookService, WebhookVerificationError } from './services/webhookService';
export { transformArticle, transformArticles, transformRawArticle, transformRawArticles } from './utils';
export { Logger, LogLevel, noopLogger, createLogger } from './logger';

export class FinlightApi {
  private apiClient: ApiClient;
  public articles: ArticleService;
  public sources: SourceService;
  public websocket: WebSocketClient;
  public rawWebsocket: RawWebSocketClient;
  public webhook: WebhookService;

  constructor(
    config: Partial<ApiClientConfig> & Pick<ApiClientConfig, 'apiKey'>,
    websocketOptions?: WebSocketClientOptions,
    rawWebsocketOptions?: RawWebSocketClientOptions,
  ) {
    const finalConfig = { ...defaultApiConfig, ...config };
    this.apiClient = new ApiClient(finalConfig);
    this.articles = new ArticleService(this.apiClient);
    this.sources = new SourceService(this.apiClient);
    this.websocket = new WebSocketClient(finalConfig, websocketOptions);
    this.rawWebsocket = new RawWebSocketClient(finalConfig, rawWebsocketOptions);
    this.webhook = new WebhookService();
  }
}
