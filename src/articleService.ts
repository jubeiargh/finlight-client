import { ApiClient } from './apiClient';
import { GetArticleApiResponse, GetArticlesParams } from './types';

export class ArticleService {
  constructor(private apiClient: ApiClient) {}

  async fetchArticles(params: GetArticlesParams): Promise<GetArticleApiResponse> {
    return this.apiClient.request<GetArticleApiResponse>('POST', '/v2/articles', params);
  }
}
