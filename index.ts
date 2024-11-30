import { ApiClientConfig, defaultApiConfig } from './src/config';
import { ArticleService } from './src/articleService';
import { ApiClient } from './src/apiClient';
import { WebSocketClient } from './src/webSocketClient';

export class FinlightApi {
  private apiClient: ApiClient;
  public articles: ArticleService;
  public websocket: WebSocketClient;

  constructor(
    config: Partial<ApiClientConfig> & Pick<ApiClientConfig, 'apiKey'>,
  ) {
    const finalConfig = { ...defaultApiConfig, ...config };
    this.apiClient = new ApiClient(finalConfig);
    this.articles = new ArticleService(this.apiClient);
    this.websocket = new WebSocketClient(finalConfig);
  }
}
