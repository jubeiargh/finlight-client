import { ApiClient } from './apiClient';
import { GetArticleApiResponse, GetArticlesParams } from './types';
import { transformArticles } from './utils';

/**
 * Service for fetching and managing financial news articles.
 */
export class ArticleService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Fetches financial news articles based on the provided search parameters.
   *
   * Supports advanced filtering by tickers, sources, dates, and custom queries.
   * Articles are returned with metadata including sentiment, company tags, and content.
   *
   * @param params - Search parameters for filtering articles
   * @param params.query - Advanced query string. Supports boolean operators and field filters.
   *                       Example: `(ticker:AAPL OR ticker:NVDA) AND NOT source:reuters.com`
   * @param params.tickers - Filter by company tickers (e.g., ['AAPL', 'NVDA'])
   * @param params.sources - Limit to specific news sources (overrides default source set)
   * @param params.excludeSources - Sources to exclude from results
   * @param params.from - Start date in YYYY-MM-DD format or ISO date string
   * @param params.to - End date in YYYY-MM-DD format or ISO date string
   * @param params.includeContent - Whether to include full article content
   * @param params.includeEntities - Whether to include tagged company data
   * @param params.page - Page number for pagination
   * @param params.pageSize - Number of results per page (1-1000)
   *
   * @returns Promise resolving to paginated article results with metadata
   *
   * @throws {Error} If the API request fails
   *
   * @example
   * ```typescript
   * const response = await articleService.fetchArticles({
   *   tickers: ['AAPL'],
   *   from: '2024-01-01',
   *   includeContent: true,
   *   pageSize: 20
   * });
   * ```
   */
  async fetchArticles(params: GetArticlesParams): Promise<GetArticleApiResponse> {
    const response = await this.apiClient.request<GetArticleApiResponse>('POST', '/v2/articles', params);

    // Transform articles to ensure proper types
    return {
      ...response,
      articles: transformArticles(response.articles),
    };
  }
}
