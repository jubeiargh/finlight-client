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
}

export interface Article extends BasicArticle {
  content: string;
  summary?: string;
}

export interface ApiResponse<T> {
  status: string;
  totalResults: number;
  page: number;
  pageSize: number;
  articles: T[];
}
export type GetBasicArticleApiResponse = ApiResponse<BasicArticle>;
export type GetArticleApiResponse = ApiResponse<Article>;

// Types for Basic Article API
export interface GetBasicArticlesParams {
  query: string; // Search query
  source?: string; // Source of the article
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

export type GetExtendedArticlesParams = GetBasicArticlesParams;

export interface GetArticlesWebSocketParams {
  query: string; // Search query
  source?: string; // Source of the article
  language?: string; // Language, default is "en"
  extended: boolean;
}
