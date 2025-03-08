import { ApiClient } from './apiClient';
import {
  GetBasicArticlesParams,
  GetExtendedArticlesParams,
  GetBasicArticleApiResponse,
  GetArticleApiResponse,
} from './types';

export class ArticleService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Fetch basic articles based on provided parameters.
   * @param params GetBasicArticlesParams - Filter parameters for the query
   */
  async getBasicArticles(
    params: GetBasicArticlesParams,
  ): Promise<GetBasicArticleApiResponse> {
    return this.apiClient.request<GetBasicArticleApiResponse>(
      'GET',
      '/v1/articles',
      params,
    );
  }

  /**
   * Fetch extended articles (with full content) based on provided parameters.
   * @param params GetExtendedArticlesParams - Filter parameters for the query
   */
  async getExtendedArticles(
    params: GetExtendedArticlesParams,
  ): Promise<GetArticleApiResponse> {
    return this.apiClient.request<GetArticleApiResponse>(
      'GET',
      '/v1/articles/extended',
      params,
    );
  }
}
