import { ApiClient } from './client/apiClient';
import { WebSocketClient, WebSocketClientOptions } from './client/webSocketClient';
import { ArticleService } from './services/articleService';
import { SourceService } from './services/sourceService';
import { WebhookService } from './services/webhookService';
import { ApiClientConfig, defaultApiConfig } from './types/config';

export { ApiClientConfig } from './types/config';
export type * from './types/types';
export { WebSocketResponse, WebSocketClientOptions } from './client/webSocketClient';
export { WebhookService, WebhookVerificationError } from './services/webhookService';
export { transformArticle, transformArticles } from './utils';
export { Logger, LogLevel, noopLogger, createLogger } from './logger';

export class FinlightApi {
  private apiClient: ApiClient;
  public articles: ArticleService;
  public sources: SourceService;
  public websocket: WebSocketClient;
  public webhook: WebhookService;

  constructor(
    config: Partial<ApiClientConfig> & Pick<ApiClientConfig, 'apiKey'>,
    websocketOptions?: WebSocketClientOptions,
  ) {
    const finalConfig = { ...defaultApiConfig, ...config };
    this.apiClient = new ApiClient(finalConfig);
    this.articles = new ArticleService(this.apiClient);
    this.sources = new SourceService(this.apiClient);
    this.websocket = new WebSocketClient(finalConfig, websocketOptions);
    this.webhook = new WebhookService();
  }
}
