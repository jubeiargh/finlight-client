import { ApiClient } from './apiClient';
import { ArticleService } from './articleService';
import { ApiClientConfig, defaultApiConfig } from './config';
import { SourceService } from './sourceService';
import { WebhookService } from './webhookService';
import { WebSocketClient, WebSocketClientOptions } from './webSocketClient';

export { ApiClientConfig } from './config';
export type * from './types';
export { WebSocketResponse, WebSocketClientOptions } from './webSocketClient';
export { WebhookService, WebhookVerificationError } from './webhookService';
export { transformArticle, transformArticles } from './utils';

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
