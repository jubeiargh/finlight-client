import { ApiClient } from './apiClient';
import { ArticleService } from './articleService';
import { ApiClientConfig, defaultApiConfig } from './config';
import { SourceService } from './sourceService';
import { WebSocketClient } from './webSocketClient';

export { ApiClientConfig } from './config';
export type * from './types';
export { WebSocketResponse } from './webSocketClient';

export class FinlightApi {
  private apiClient: ApiClient;
  public articles: ArticleService;
  public sources: SourceService;
  public websocket: WebSocketClient;

  constructor(
    config: Partial<ApiClientConfig> & Pick<ApiClientConfig, 'apiKey'>,
  ) {
    const finalConfig = { ...defaultApiConfig, ...config };
    this.apiClient = new ApiClient(finalConfig);
    this.articles = new ArticleService(this.apiClient);
    this.sources = new SourceService(this.apiClient);
    this.websocket = new WebSocketClient(finalConfig);
  }
}
