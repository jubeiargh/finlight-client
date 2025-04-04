// Basic types for API responses
export interface BasicArticle {
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
}

export interface Article extends BasicArticle {
  content?: string;
}

export interface ApiResponse<T> {
  status: string;
  page: number;
  pageSize: number;
  articles: T[];
}
export type GetBasicArticleApiResponse = ApiResponse<BasicArticle>;
export type GetArticleApiResponse = ApiResponse<Article>;

// Types for Basic Article API
export interface GetBasicArticlesParams {
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

  /**
   * include sources that are less mainstream western financially relevant
   * could be sources with more state controlled and propaganda
   * or regions of earth where west doesn't give a f*ck about
   */
  includeAllSources?: boolean;

  sourceRegion?: string;

  alignment?: string;
}

export type GetExtendedArticlesParams = GetBasicArticlesParams;

export interface GetArticlesWebSocketParams {
  query: string; // Search query
  source?: string; // Source of the article
  sources?: string[]; // Source of the article
  language?: string; // Language, default is "en"
  extended: boolean;
}
