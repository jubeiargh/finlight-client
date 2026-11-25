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

/** Common base of every error the SDK throws. Every error has one of the seven kinds. */
export class FinlightError extends Error {
  readonly kind: FinlightErrorKind;

  constructor(kind: FinlightErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.name = new.target.name;
  }
}

/**
 * Kind of an API error: one per known problem code, `other` for unknown codes and bodies
 * without a code. In the NestJS fallback form (no code) and for refused stream dials the
 * kind comes from the HTTP status.
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

/** Known `limitType` values of a 429 (vocab `limitTypes`). */
export const RATE_LIMIT_TYPES = ['monthly', 'burst'] as const;
/**
 * Kind of a 429: `monthly` (quota of the period), `burst`, `unknown` (not recognisable) or a
 * value the server sent that this SDK version does not know yet (kept as is, never retried).
 */
export type RateLimitType = (typeof RATE_LIMIT_TYPES)[number] | 'unknown' | (string & {});

/** One entry of `FinlightApiError.errors`. */
export interface FieldIssue {
  /** Request property, e.g. `eventTypes`. `null` when the server named none. */
  field: string | null;
  /** Explanation from the server. */
  issue: string | null;
  /** Allowed values, only for closed request vocabularies. */
  allowedValues?: string[];
  /** Stream validation details (`{rule: text}`), only on stream errors. */
  constraints?: Record<string, string>;
}

export interface ApiErrorInit {
  status: number;
  code: string | null;
  type: string | null;
  title: string | null;
  detail: string | null;
  requestId: string | null;
  errors: FieldIssue[];
  /** The body as received (text), or `null` when there was none. */
  raw: string | null;
  /** The parsed body, when it was JSON. */
  json?: unknown;
  /** Kind when it cannot come from the code (no code). Default: from the status. */
  apiKind?: ApiErrorKind;
  limitType?: RateLimitType | null;
  retryAfterMs?: number | null;
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

/** Kind from the HTTP status (bodies without a problem code). */
export function apiKindFromStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation_failed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'internal_error';
  return 'other';
}

/**
 * An error answered by the finlight API: a REST status >= 400, a refused stream dial or a
 * terminal `connection.error`. Known kinds use the subclasses below; `apiKind` names the kind.
 */
export class FinlightApiError extends FinlightError {
  readonly status: number;
  /** Problem code (open). `null` for the NestJS fallback form, non-JSON bodies and refused dials. */
  readonly code: ProblemCode | null;
  readonly type: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  /** The server's request id, or the `X-Request-Id` the SDK sent. */
  readonly requestId: string | null;
  readonly errors: FieldIssue[];
  /** The error body as received (text). `rawJson(error)` returns the parsed JSON. */
  readonly raw: string | null;
  readonly apiKind: ApiErrorKind;

  constructor(init: ApiErrorInit, apiKind?: ApiErrorKind) {
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
    this.apiKind = apiKind ?? 'other';
    if (init.json !== undefined) attachRaw(this, init.json);
  }
}

export class ValidationFailedError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'validation_failed');
  }
}
export class CursorInvalidError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'cursor_invalid');
  }
}
export class CursorMismatchError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'cursor_mismatch');
  }
}
export class UnauthorizedError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'unauthorized');
  }
}
export class ForbiddenError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'forbidden');
  }
}
export class NotFoundError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'not_found');
  }
}
export class InternalServerError extends FinlightApiError {
  constructor(init: ApiErrorInit) {
    super(init, 'internal_error');
  }
}
/** 429. `limitType` says which limit; burst answers carry `retryAfterMs`. */
export class RateLimitedError extends FinlightApiError {
  readonly limitType: RateLimitType;
  /** The `Retry-After` header in milliseconds, or `null` when the server sent none. */
  readonly retryAfterMs: number | null;

  constructor(init: ApiErrorInit) {
    super(init, 'rate_limited');
    this.limitType = init.limitType ?? 'unknown';
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/** Builds the API error with the subclass of its kind (code first, else the given kind or status). */
export function createApiError(init: ApiErrorInit): FinlightApiError {
  let kind: ApiErrorKind;
  if (init.code !== null) kind = KIND_BY_CODE[init.code] ?? 'other';
  else kind = init.apiKind ?? apiKindFromStatus(init.status);
  switch (kind) {
    case 'validation_failed':
      return new ValidationFailedError(init);
    case 'cursor_invalid':
      return new CursorInvalidError(init);
    case 'cursor_mismatch':
      return new CursorMismatchError(init);
    case 'unauthorized':
      return new UnauthorizedError(init);
    case 'forbidden':
      return new ForbiddenError(init);
    case 'not_found':
      return new NotFoundError(init);
    case 'rate_limited':
      return new RateLimitedError(init);
    case 'internal_error':
      return new InternalServerError(init);
    default:
      return new FinlightApiError(init, 'other');
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
  constructor(message: string, cause?: unknown, kind: 'network' | 'timeout' = 'network') {
    super(kind, message, { cause });
  }
}

/** An attempt or the whole call ran out of time. */
export class FinlightTimeoutError extends FinlightNetworkError {
  constructor(message: string, cause?: unknown) {
    super(message, cause, 'timeout');
  }
}

/** A response could not be decoded into the model (single lookups, envelopes). */
export class FinlightDecodeError extends FinlightError {
  /** JSON path of the failing value, e.g. `article.source.domain`. */
  readonly path: string | null;
  /** The value that did not fit. */
  readonly raw: unknown;

  constructor(message: string, path: string | null = null, raw?: unknown, cause?: unknown) {
    super('decode', message, { cause });
    this.path = path;
    this.raw = raw;
    if (raw !== undefined && raw !== null && typeof raw === 'object') attachRaw(this, raw);
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

/** The stream was preempted by the server. */
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

const KINDS = ['api', 'validation', 'network', 'timeout', 'decode', 'webhook_verification', 'preempted'];

/** True for every error thrown by this SDK (also across duplicate SDK copies). */
export function isFinlightError(value: unknown): value is FinlightError {
  if (value instanceof FinlightError) return true;
  const kind = value instanceof Error ? (value as { kind?: unknown }).kind : undefined;
  return typeof kind === 'string' && KINDS.includes(kind);
}

/** True for API errors; works without `instanceof`. */
export function isFinlightApiError(value: unknown): value is FinlightApiError {
  return (
    value instanceof FinlightApiError ||
    (value instanceof Error &&
      (value as { kind?: unknown }).kind === 'api' &&
      typeof (value as { status?: unknown }).status === 'number')
  );
}
