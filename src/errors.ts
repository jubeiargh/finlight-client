import { attachRaw } from './internal/raw';
import type { PreemptReason, ProblemCode } from './vocab';

/** Text field that names the error type, usable without `instanceof`. */
export type FinlightErrorKind =
  | 'api'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'decode'
  | 'webhook_verification'
  | 'preempted';

/** Common base of every error the SDK throws. */
export class FinlightError extends Error {
  readonly kind: FinlightErrorKind;

  constructor(kind: FinlightErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.name = new.target.name;
  }
}

/**
 * Kind of an API error. There is one kind per known problem code, `other` for unknown
 * codes and bodies without a code. For the NestJS fallback form (no code) the kind comes
 * from the HTTP status.
 */
export type ApiErrorKind =
  | 'validation_failed'
  | 'cursor_invalid'
  | 'cursor_mismatch'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'internal_error'
  | 'other';

/** Kind of a 429: monthly token quota, burst limit, or not recognisable. */
export type RateLimitType = 'monthly' | 'burst' | 'unknown';

export interface ApiFieldError {
  /** Request property, e.g. `eventTypes`. `null` when the server named none. */
  field: string | null;
  /** Explanation from the server. */
  issue: string | null;
  /** Allowed values, only for closed request vocabularies. */
  allowedValues?: string[];
  /** WebSocket validation details (`{rule: text}`), only on stream errors. */
  constraints?: Record<string, string>;
}

export interface FinlightApiErrorInit {
  status: number;
  code: string | null;
  type: string | null;
  title: string | null;
  detail: string | null;
  requestId: string | null;
  errors: ApiFieldError[];
  raw: unknown;
  channel: 'rest' | 'websocket';
  limitType: RateLimitType | null;
  retryAfterMs: number | null;
  message?: string;
}

const KIND_BY_CODE: Record<string, ApiErrorKind> = {
  VALIDATION_FAILED: 'validation_failed',
  CURSOR_INVALID: 'cursor_invalid',
  CURSOR_MISMATCH: 'cursor_mismatch',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_ERROR: 'internal_error',
};

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation_failed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal_error';
  return 'other';
}

/**
 * An error answered by the finlight API (REST status >= 400, a refused WebSocket dial,
 * or a terminal `connection.error` on a stream).
 */
export class FinlightApiError extends FinlightError {
  readonly status: number;
  /** Problem code (open). `null` for the NestJS fallback form and non-JSON bodies. */
  readonly code: ProblemCode | null;
  readonly type: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  /** The server's request id, or the `X-Request-Id` the SDK sent. */
  readonly requestId: string | null;
  readonly errors: ApiFieldError[];
  /** Parsed error body, or its text when it was not JSON. */
  readonly raw: unknown;
  readonly apiKind: ApiErrorKind;
  /** Only for 429: `monthly`, `burst` or `unknown`. */
  readonly limitType: RateLimitType | null;
  /** Wait time from a `Retry-After` header, if the server sent one. */
  readonly retryAfterMs: number | null;
  readonly channel: 'rest' | 'websocket';

  constructor(init: FinlightApiErrorInit) {
    const label = init.code ?? `HTTP ${init.status}`;
    super('api', init.message ?? `${label}: ${init.detail ?? init.title ?? 'request failed'}`);
    this.status = init.status;
    this.code = init.code;
    this.type = init.type;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.errors = init.errors;
    this.raw = init.raw;
    this.channel = init.channel;
    this.limitType = init.limitType;
    this.retryAfterMs = init.retryAfterMs;
    if (init.code !== null) {
      this.apiKind = KIND_BY_CODE[init.code] ?? 'other';
    } else if (init.raw !== null && typeof init.raw === 'object') {
      this.apiKind = kindFromStatus(init.status);
    } else {
      this.apiKind = init.status === 429 ? 'rate_limited' : 'other';
    }
    attachRaw(this, init.raw);
  }
}

/** A parameter or option was rejected locally, before any network call. */
export class FinlightValidationError extends FinlightError {
  /** The offending parameter, when there is one. */
  readonly param: string | null;

  constructor(message: string, param: string | null = null) {
    super('validation', message);
    this.param = param;
  }
}

/** The connection failed (DNS, TCP, TLS, reset). The original error is the `cause`. */
export class FinlightNetworkError extends FinlightError {
  constructor(message: string, cause?: unknown) {
    super('network', message, { cause });
  }
}

/** An attempt or the whole call ran out of time. */
export class FinlightTimeoutError extends FinlightError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, cause?: unknown) {
    super('timeout', message, { cause });
    this.timeoutMs = timeoutMs;
  }
}

/** A response could not be decoded into the model (single lookups, envelopes). */
export class FinlightDecodeError extends FinlightError {
  /** JSON path of the failing value, e.g. `article.source.domain`. */
  readonly path: string | null;

  constructor(message: string, path: string | null = null, raw?: unknown, cause?: unknown) {
    super('decode', message, { cause });
    this.path = path;
    if (raw !== undefined) attachRaw(this, raw);
  }
}

export type WebhookVerificationReason =
  | 'invalid_raw_body'
  | 'invalid_secret'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'duplicate_header'
  | 'non_ascii_header'
  | 'unsupported_signature_scheme'
  | 'unparseable_timestamp'
  | 'signature_mismatch'
  | 'timestamp_outside_tolerance';

/** A webhook request failed verification. Answer it with 4xx; never with 410. */
export class WebhookVerificationError extends FinlightError {
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super('webhook_verification', message);
    this.reason = reason;
  }
}

/** The stream was preempted by the server. Terminal: the SDK does not reconnect. */
export class PreemptedError extends FinlightError {
  readonly reason: PreemptReason;
  readonly newLeaseId: string | null;
  readonly timestamp: number | null;

  constructor(reason: PreemptReason, newLeaseId: string | null, timestamp: number | null) {
    super('preempted', `stream preempted by the server (${reason})`);
    this.reason = reason;
    this.newLeaseId = newLeaseId;
    this.timestamp = timestamp;
  }
}

function hasKind(value: unknown, kind: string): boolean {
  return value instanceof Error && (value as { kind?: unknown }).kind === kind;
}

/** True for every error thrown by this SDK (also across duplicate SDK copies). */
export function isFinlightError(value: unknown): value is FinlightError {
  if (value instanceof FinlightError) return true;
  const kind = value instanceof Error ? (value as { kind?: unknown }).kind : undefined;
  return (
    typeof kind === 'string' &&
    ['api', 'validation', 'network', 'timeout', 'decode', 'webhook_verification', 'preempted'].includes(kind)
  );
}

/** True for API errors; works without `instanceof`. */
export function isFinlightApiError(value: unknown): value is FinlightApiError {
  return (
    value instanceof FinlightApiError ||
    (hasKind(value, 'api') && typeof (value as { status?: unknown }).status === 'number')
  );
}
