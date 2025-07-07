// Basic types for API responses
export interface Article {
  link: string;
  title: string;
  publishDate: Date;
  authors: string;
  source: string;
  language: string;
  sentiment?: string;
  confidence?: number;
  summary?: string;
  images?: string[];
  content?: string;
  companies?: Company[];
}

export interface Company {
  companyId: number;
  confidence?: number;
  country?: string;
  exchange?: string;
  industry?: string;
  sector?: string;
  name: string;
  ticker: string;
  isin?: string;
  openfigi?: string;
}

export interface ApiResponse<T> {
  status: string;
  page: number;
  pageSize: number;
  articles: T[];
}
export type GetArticleApiResponse = ApiResponse<Article>;

// Types for Basic Article API
export interface GetArticlesParams {
  /**
   * Supports advanced query language:
   * e.g: (ticker:AAPL OR ticker:NVDA) AND NOT source:www.reuters.com AND "Elon Musk"
   */
  query: string; // Search query
  /**
   * @deprecated => use sources
   * source of the articles
   */
  source?: string;
  /**
   * source of the articles, accepts multiple
   * if you select sources than "includeAllSources" is not necessary
   */
  sources?: string[];

  /**
   * Ticker of companies like: AAPL, NVDA
   */
  tickers?: string[];

  /**
   * Which sources should be taken additionally to the default sources set
   */
  optInSources?: string[];

  /**
   * Whether to get tagged company data
   */
  includeCompanies?: boolean;
  /**
   * Whether to skip articles that have no content
   */
  hasContent?: boolean;

  /**
   * source to exclude, accepts multiple
   */
  excludeSources?: string[];
  /**
   *  Start date in (YYYY-MM-DD) or ISO Date string
   */
  from?: string;
  /**
   *  End date in (YYYY-MM-DD) or ISO Date string
   */
  to?: string;
  language?: string; // Language, default is "en"
  order?: 'ASC' | 'DESC'; // Sort order
  pageSize?: number; // Results per page (1-1000)
  page?: number; // Page number
}

export interface GetArticlesWebSocketParams {
  query: string; // Search query
  /**
   * @deprecated => use sources
   * source of the articles
   */
  source?: string; // Source of the article
  /**
   * Limit search to sources. Will overwrite default source set. Take a look at the sources API endpoint to know which endpoints are available and are on by default
   */
  sources?: string[]; // Source of the article
  excludeSources?: string[];
  /**
   * Which sources should be taken additionally to the default sources set
   */
  optInSources?: string[];
  language?: string; // Language, default is "en"
  extended: boolean;
  /**
   * Ticker of companies like: AAPL, NVDA
   */
  tickers?: string[];
  /**
   * Whether to get tagged company data
   */
  includeCompanies?: boolean;
  /**
   * Whether to skip articles that have no content
   */
  hasContent?: boolean;
}
