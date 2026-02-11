// Basic types for API responses
export interface Article {
  link: string;
  title: string;
  publishDate: Date;
  source: string;
  language: string;
  sentiment?: string;
  confidence?: number;
  summary?: string;
  images?: string[];
  content?: string;
  companies?: Company[];
  createdAt?: Date;
  categories?: string[];
  countries?: string[];
}

export interface Listing {
  ticker: string;
  exchangeCode: string;
  exchangeCountry: string;
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
  primaryListing?: Listing;
  isins?: string[];
  otherListings?: Listing[];
}

export interface ApiResponse<T> {
  status: string;
  page: number;
  pageSize: number;
  articles: T[];
}
export type GetArticleApiResponse = ApiResponse<Article>;

export type ArticleCategories =
  | 'markets'
  | 'economy'
  | 'business'
  | 'politics'
  | 'geopolitics'
  | 'regulation'
  | 'technology'
  | 'energy'
  | 'commodities'
  | 'crypto'
  | 'health'
  | 'climate'
  | 'security';
// Types for Basic Article API
export interface GetArticlesParams {
  /**
   * Supports advanced query language:
   * e.g: (ticker:AAPL OR ticker:NVDA) AND NOT source:www.reuters.com AND "Elon Musk"
   */
  query?: string; // Search query
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

  includeContent?: boolean;
  /**
   * Whether to get tagged company data
   */
  includeEntities?: boolean;
  /**
   * Whether to skip articles that have no content
   */
  excludeEmptyContent?: boolean;

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
  orderBy?: 'publishDate' | 'createdAt'; // Order by
  order?: 'ASC' | 'DESC'; // Sort order
  pageSize?: number; // Results per page (1-1000)
  page?: number; // Page number
  countries?: string[]; // ISO 3166-1 alpha-2 country codes
  categories?: ArticleCategories[];
}

export interface GetArticlesWebSocketParams {
  query?: string; // Search query
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
  /**
   * @deprecated => includeContent
   * whether to include content
   */
  extended?: boolean;
  /**
   * Ticker of companies like: AAPL, NVDA
   */
  tickers?: string[];
  /**
   * Whether to get tagged company data
   */
  includeEntities?: boolean;
  /**
   * Whether to skip articles that have no content
   */
  excludeEmptyContent?: boolean;

  //  whether to include content
  includeContent?: boolean;

  countries?: string[]; // ISO 3166-1 alpha-2 country codes
  categories?: ArticleCategories[];
}

export interface GetRawArticlesWebSocketParams {
  query?: string;
  /**
   * Limit search to sources. Will overwrite default source set.
   */
  sources?: string[];
  /**
   * Sources to exclude from results
   */
  excludeSources?: string[];
  /**
   * Which sources should be taken additionally to the default sources set
   */
  optInSources?: string[];
  language?: string; // Language, default is "en"
}

export interface RawArticle {
  link: string;
  title: string;
  publishDate: Date;
  source: string;
  language: string;
  summary?: string;
  images?: string[];
}

export interface Source {
  domain: string;
  isContentAvailable: boolean;
  isDefaultSource: boolean;
}

export interface GetArticleByLinkParams {
  /** The URL of the article to fetch */
  link: string;
  /** Whether to include full article content */
  includeContent?: boolean;
  /** Whether to include tagged company data */
  includeEntities?: boolean;
}
