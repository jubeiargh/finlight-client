/**
 * Vocabularies of finlight API v3.
 *
 * Response enums are open: the types accept any string and the arrays list the values
 * known today. Unknown values from the server are kept as they are. Compare by string.
 * Request vocabularies are checked by the server (400 with `allowedValues`), so the SDK
 * sends any string you pass.
 */

/** `include` blocks for REST and the enriched stream. */
export const INCLUDE_BLOCKS = ['content', 'companies', 'events'] as const;
export type IncludeBlock = (typeof INCLUDE_BLOCKS)[number] | (string & {});

/** Sort timestamps for `articles.search`. `from`/`to` apply to the same field. */
export const ORDER_BY_VALUES = ['publishedAt', 'firstSeenAt', 'revisedAt', 'availableAt'] as const;
export type OrderBy = (typeof ORDER_BY_VALUES)[number] | (string & {});

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number] | (string & {});

/** Position of a company in the story (`companies[].role`, search filter `roles`). */
export const COMPANY_ROLES = [
  'acquirer',
  'target',
  'seller',
  'defendant',
  'subject',
  'counterparty',
  'supplier',
  'customer',
  'competitor',
  'mentioned',
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number] | (string & {});

/** `events[].type` and search filter `eventTypes`. */
export const EVENT_TYPES = [
  'earnings',
  'guidance',
  'mna',
  'ipo_listing',
  'capital_action',
  'rating_action',
  'management_change',
  'legal',
  'regulatory',
  'bankruptcy_distress',
  'product_partnership',
  'investment_expansion',
  'operational_incident',
  'labor_restructuring',
  'macro',
  'geopolitics',
] as const;
export type EventType = (typeof EVENT_TYPES)[number] | (string & {});

/** `events[].direction` and search filter `eventDirections`. */
export const EVENT_DIRECTIONS = ['positive', 'negative', 'neutral', 'unclear'] as const;
export type EventDirection = (typeof EVENT_DIRECTIONS)[number] | (string & {});

/** `events[].importance` and search filter `minImportance`. Ordinal, lowest first. */
export const IMPORTANCE_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number] | (string & {});

/** `sentiment.label`. */
export const SENTIMENT_LABELS = ['positive', 'negative', 'neutral'] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number] | (string & {});

/**
 * `source.type`, `/v3/sources` `type` and search filters `sourceTypes`/`excludeSourceTypes`.
 * `source.type` is null when the source is not classified.
 */
export const SOURCE_TYPES = [
  'newswire',
  'press_release',
  'financial_media',
  'general_media',
  'aggregator',
  'blog',
  'government',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number] | (string & {});

/** WebSocket `event` names. */
export const STREAM_EVENT_NAMES = [
  'article.created',
  'article.updated',
  'connection.admitted',
  'connection.pong',
  'connection.preempted',
  'connection.error',
] as const;
export type StreamEventName = (typeof STREAM_EVENT_NAMES)[number] | (string & {});

export const ARTICLE_EVENT_NAMES = ['article.created', 'article.updated'] as const;
export const CONNECTION_EVENT_NAMES = [
  'connection.admitted',
  'connection.pong',
  'connection.preempted',
  'connection.error',
] as const;

/** `connection.error` codes on the WebSocket. */
export const CONNECTION_ERROR_CODES = [
  'PING_ON_DEFAULT_ROUTE',
  'HANDSHAKE_FAILED',
  'VALIDATION_FAILED',
  'SEARCH_FAILED',
  'INTERNAL_ERROR',
] as const;
export type ConnectionErrorCode = (typeof CONNECTION_ERROR_CODES)[number] | (string & {});

/** `connection.preempted` reasons. */
export const PREEMPT_REASONS = ['connection_limit', 'quota_exceeded'] as const;
export type PreemptReason = (typeof PREEMPT_REASONS)[number] | (string & {});

/** Webhook `event` names. */
export const WEBHOOK_EVENT_NAMES = ['article.created', 'article.updated'] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENT_NAMES)[number] | (string & {});

/** Problem `code` values of REST errors. */
export const PROBLEM_CODES = [
  'VALIDATION_FAILED',
  'CURSOR_INVALID',
  'CURSOR_MISMATCH',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number] | (string & {});

/** Base URL of the documentation page for each problem code. */
export function problemTypeUrl(code: string): string {
  return `https://docs.finlight.me/errors/${code.toLowerCase().replace(/_/g, '-')}`;
}

/** The only payload version this SDK speaks. Always sent as the JSON number 3. */
export const PAYLOAD_VERSION = 3;
