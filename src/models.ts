import type {
  CompanyRole,
  EventDirection,
  EventType,
  Importance,
  SentimentLabel,
  SourceType,
  StreamEventName,
  WebhookEventName,
} from './vocab';

/*
 * Models are plain data objects shaped like the wire JSON.
 *
 * - Keys that are always sent are always present here; `null` means "no value".
 * - Gated keys (`content`, `sentiment`, `companies`, `events`, `events[].companyIds`,
 *   `Source.hasContent`) are only present when the server sent them. A missing key means
 *   "not entitled, not requested, or raw" - it is never turned into `null`, `[]` or `false`.
 *   Use the presence guards (`contentPresent` etc.) to tell the states apart.
 * - Timestamps are the original strings; use `toDate()` for a `Date`.
 * - Unknown keys from the server stay on the objects; `rawJson()` returns the original JSON.
 */

export interface ArticleSource {
  /** Domain, e.g. `www.reuters.com`. Join key to `sources.list()`. */
  domain: string;
  /** Open vocabulary; always `null` today. */
  type: SourceType | null;
}

export interface Media {
  url: string | null;
}

export interface Sentiment {
  label: SentimentLabel | null;
  confidence: number | null;
}

export interface Listing {
  ticker: string | null;
  /** ISO 10383 MIC. */
  mic: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
}

/** A listing of a company record; `active: false` for expired listings. */
export interface CompanyListing extends Listing {
  active: boolean | null;
}

/** A company tagged on an article. */
export interface Company {
  companyId: number;
  name: string;
  isin: string | null;
  /** `null` when the company has no listing (e.g. a private company). */
  primaryListing: Listing | null;
  confidence: number | null;
  /** Position in the story (open enum). `null` for articles tagged before roles existed. */
  role: CompanyRole | null;
  /** Aboutness from 0 to 1. `null` for articles tagged before roles existed. */
  relevance: number | null;
}

/** An event classified on an article. Named `EventTag` because `Event` is a global class. */
export interface EventTag {
  type: EventType;
  direction: EventDirection | null;
  importance: Importance | null;
  confidence: number | null;
  /** Present only when the `companies` block is in the same payload. */
  companyIds?: number[];
}

export interface Article {
  /** 22 characters, base64url. Same in every channel. */
  id: string;
  link: string;
  source: ArticleSource;
  title: string;
  /** Can be `""` on legacy articles; delivered as sent. */
  summary: string | null;
  language: string | null;
  media: Media[];
  /** Can be `1970-01-01T00:00:00.000Z` on legacy articles; delivered as sent. */
  publishedAt: string | null;
  firstSeenAt: string | null;
  revisedAt: string | null;
  /** Always `null` on raw; `null` for articles from before the rollout. */
  availableAt: string | null;
  countries: string[];
  categories: string[];
  /** Present only with `include: ['content']` and full article access. */
  content?: string | null;
  /** Present only with sentiment access (no include needed). */
  sentiment?: Sentiment | null;
  /** Present only with `include: ['companies']` and entity access. `[]` means tagged, no company. */
  companies?: Company[];
  /** Present only with `include: ['events']` and event access. `[]` means classified, no event. */
  events?: EventTag[];
}

export interface Pagination {
  limit: number | null;
  returned: number | null;
  hasMore: boolean;
  /** Opaque. Pass it back unchanged; never parse it. `null` at the end. */
  nextCursor: string | null;
}

/** An entry of a list response that could not be decoded and was skipped. */
export interface SkippedEntry {
  index: number;
  raw: unknown;
  reason: string;
}

export interface ArticlePage {
  articles: Article[];
  pagination: Pagination;
  /** Entries that could not be decoded. They are also logged as warnings. */
  skipped: SkippedEntry[];
}

/** Company master data from `/v3/companies`. */
export interface CompanyRecord {
  companyId: number;
  name: string;
  country: string | null;
  sector: string | null;
  industry: string | null;
  isins: string[];
  primaryListing: Listing | null;
  /** Includes the primary listing and expired ones. */
  listings: CompanyListing[];
  updatedAt: string | null;
}

/** A source from the catalog (`/v3/sources`). */
export interface Source {
  domain: string;
  name: string | null;
  type: SourceType | null;
  isDefault: boolean | null;
  /** Present only with full article access. Missing means unknown, never "no content". */
  hasContent?: boolean;
  isCustom: boolean | null;
  country: string | null;
  /** Most common language first. */
  languages: string[];
}

/** Kind of a stream item. */
export type StreamEventKind = 'created' | 'updated' | 'other';

/**
 * One item of a stream. `created`/`updated` carry the article; `other` is an event this
 * SDK version does not know yet, with the frame kept as it arrived.
 */
export interface StreamEvent {
  readonly kind: StreamEventKind;
  /** Wire event name, e.g. `article.created` (open). */
  readonly event: StreamEventName;
  readonly article: Article | null;
  /** The frame as received (parsed JSON). */
  readonly frame: Readonly<Record<string, unknown>>;
}

/** A verified v3 webhook delivery. */
export interface WebhookEvent {
  /** Idempotency key: the same on every retry. Dedupe on it. */
  eventId: string;
  event: WebhookEventName;
  occurredAt: string;
  payloadVersion: number;
  /** Webhook id (raw UUID). */
  subscriptionId: string;
  /** Only on `article.updated` when the producer reported changes. */
  changedFields?: string[];
  data: Article;
  /** `true` for dashboard test deliveries (`eventId` starts with `evt_test`). */
  isTest: boolean;
}

/** Presence guard for `content`. `null` counts as present ("requested, entitled, no value"). */
export function contentPresent<T extends Article>(article: T): article is T & { content: string | null } {
  return Object.prototype.hasOwnProperty.call(article, 'content');
}

/** Presence guard for `sentiment`. `null` counts as present ("entitled, not computed"). */
export function sentimentPresent<T extends Article>(
  article: T,
): article is T & { sentiment: Sentiment | null } {
  return Object.prototype.hasOwnProperty.call(article, 'sentiment');
}

/** Presence guard for `companies`. A present `[]` means "tagged, no company". */
export function companiesPresent<T extends Article>(article: T): article is T & { companies: Company[] } {
  return Object.prototype.hasOwnProperty.call(article, 'companies');
}

/** Presence guard for `events`. A present `[]` means "classified, no event". */
export function eventsPresent<T extends Article>(article: T): article is T & { events: EventTag[] } {
  return Object.prototype.hasOwnProperty.call(article, 'events');
}
