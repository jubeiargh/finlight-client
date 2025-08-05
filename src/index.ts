import { ApiClient } from './apiClient';
import { ArticleService } from './articleService';
import { ApiClientConfig, defaultApiConfig } from './config';
import { SourceService } from './sourceService';
import { WebhookService } from './webhookService';
import { WebSocketClient } from './webSocketClient';

export { ApiClientConfig } from './config';
export type * from './types';
export { WebSocketResponse } from './webSocketClient';
export { WebhookService, WebhookVerificationError, WebhookEvent } from './webhookService';

export class FinlightApi {
  private apiClient: ApiClient;
  public articles: ArticleService;
  public sources: SourceService;
  public websocket: WebSocketClient;
  public webhook: WebhookService;

  constructor(config: Partial<ApiClientConfig> & Pick<ApiClientConfig, 'apiKey'>) {
    const finalConfig = { ...defaultApiConfig, ...config };
    this.apiClient = new ApiClient(finalConfig);
    this.articles = new ArticleService(this.apiClient);
    this.sources = new SourceService(this.apiClient);
    this.websocket = new WebSocketClient(finalConfig);
    this.webhook = new WebhookService();
  }
}
