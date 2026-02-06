import { ApiClient } from '../client/apiClient';
import { Article, GetArticleApiResponse, GetArticleByLinkParams, GetArticlesParams } from '../types';
import { transformArticle, transformArticles } from '../utils';

/**
 * Service for fetching and managing financial news articles.
 */
export class ArticleService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Fetches financial news articles based on the provided search parameters.
   *
   * Supports advanced filtering by tickers, sources, dates, countries, and custom queries.
   * Articles are returned with metadata including sentiment, company tags, and content.
   *
   * @param params - Search parameters for filtering articles
   * @param params.query - Advanced query string. Supports boolean operators and field filters.
   *                       Example: `(ticker:AAPL OR ticker:NVDA) AND NOT source:reuters.com`
   * @param params.tickers - Filter by company tickers (e.g., ['AAPL', 'NVDA'])
   * @param params.sources - Limit to specific news sources (overrides default source set)
   * @param params.excludeSources - Sources to exclude from results
   * @param params.countries - Filter by country codes (e.g., ['US', 'GB'])
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
   *   countries: ['US'],
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

  /**
   * Fetches a single article by its URL.
   *
   * @param params - Parameters for fetching article by link
   * @param params.link - The URL of the article to fetch
   * @param params.includeContent - Whether to include full article content
   * @param params.includeEntities - Whether to include tagged company data
   *
   * @returns Promise resolving to the article if found
   *
   * @throws {Error} If the API request fails or article is not found
   *
   * @example
   * ```typescript
   * const article = await articleService.fetchArticleByLink({
   *   link: 'https://example.com/news/article',
   *   includeContent: true
   * });
   * ```
   */
  async fetchArticleByLink(params: GetArticleByLinkParams): Promise<Article> {
    const response = await this.apiClient.request<Article>('GET', '/v2/articles/by-link', params);
    return transformArticle(response);
  }
}
