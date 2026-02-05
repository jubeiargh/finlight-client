import { RawArticle, GetRawArticlesWebSocketParams, ApiClientConfig } from '../types';
import { transformRawArticle } from '../utils';
import { BaseWebSocketClient, BaseWebSocketClientOptions } from './baseWebSocketClient';

export class RawWebSocketClient extends BaseWebSocketClient<RawArticle, GetRawArticlesWebSocketParams> {
  constructor(config: ApiClientConfig, options: BaseWebSocketClientOptions = {}) {
    super(config, options);
  }

  protected getWebSocketUrl(): string {
    return this.config.wssUrl + '/raw';
  }

  protected getLogPrefix(): string {
    return '[Raw] ';
  }

  protected transformMessage(data: any): RawArticle {
    return transformRawArticle(data);
  }
}
