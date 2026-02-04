import { Article, GetArticlesWebSocketParams, ApiClientConfig } from '../types';
import { transformArticle } from '../utils';
import { BaseWebSocketClient, BaseWebSocketClientOptions } from './baseWebSocketClient';

export type WebSocketResponse<T> = {
  action: string;
  data: T;
};

export interface WebSocketClientOptions extends BaseWebSocketClientOptions {}

export class WebSocketClient extends BaseWebSocketClient<Article, GetArticlesWebSocketParams> {
  constructor(config: ApiClientConfig, options: WebSocketClientOptions = {}) {
    super(config, options);
  }

  protected getWebSocketUrl(): string {
    return this.config.wssUrl;
  }

  protected getLogPrefix(): string {
    return '';
  }

  protected transformMessage(data: any): Article {
    return transformArticle(data);
  }

  // Enable duplicate detection using article link
  protected getArticleIdentifier(article: Article): string | null {
    return article.link;
  }
}
