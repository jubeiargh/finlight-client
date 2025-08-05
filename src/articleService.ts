import { ApiClient } from './apiClient';
import { GetArticleApiResponse, GetArticlesParams } from './types';
import { transformArticles } from './utils';

export class ArticleService {
  constructor(private apiClient: ApiClient) {}

  async fetchArticles(params: GetArticlesParams): Promise<GetArticleApiResponse> {
    const response = await this.apiClient.request<GetArticleApiResponse>('POST', '/v2/articles', params);

    // Transform articles to ensure proper types
    return {
      ...response,
      articles: transformArticles(response.articles),
    };
  }
}
