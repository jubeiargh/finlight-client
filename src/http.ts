import { randomUUID } from 'node:crypto';
import { sleep } from './clock';
import type { ResolvedConfig } from './config';
import {
  createApiError,
  FinlightApiError,
  FinlightDecodeError,
  FinlightNetworkError,
  FinlightTimeoutError,
  RateLimitedError,
  type FieldIssue,
  type RateLimitType,
} from './errors';
import { isObject } from './internal/json';
import { encodeQuery } from './params';

export interface HttpRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Array<[string, string]>;
  /** JSON text, sent as is. */
  body?: string;
  /** Raw body (tests only; bypasses JSON). */
  rawBody?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  /** One id per logical call; generated when missing. */
  requestId?: string;
  /** Treat 304 as success (conditional GET). */
  allowNotModified?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
  requestId: string;
}

const MONTHLY_MARKER = 'Exceeded token limit';
const BURST_MARKER = 'Exceeded rate limit';

/**
 * Classifies a 429 in exactly one place: the machine-readable `limitType` first, then the
 * `detail` text (exact, locale-independent substring comparison).
 */
export function classifyRateLimit(body: unknown): RateLimitType {
  if (isObject(body)) {
    // A value this SDK does not know is kept as sent (and never retried).
    if (typeof body.limitType === 'string' && body.limitType.length > 0) return body.limitType;
    const detail =
      typeof body.detail === 'string' ? body.detail : typeof body.message === 'string' ? body.message : '';
    if (detail.includes(MONTHLY_MARKER)) return 'monthly';
    if (detail.includes(BURST_MARKER)) return 'burst';
  }
  return 'unknown';
}

/** Parses `Retry-After` (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function fieldErrors(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((e) => {
    const out: FieldIssue = { field: stringOrNull(e.field), issue: stringOrNull(e.issue) };
    if (Array.isArray(e.allowedValues)) {
      out.allowedValues = e.allowedValues.filter((v): v is string => typeof v === 'string');
    }
    return out;
  });
}

/**
 * Builds the API error from a response, reading the body in this order:
 * problem+json, the NestJS form `{statusCode, message}`, then a non-JSON body.
 */
export function parseApiError(
  status: number,
  contentType: string | null,
  text: string,
  sentRequestId: string | null,
  retryAfterMs: number | null,
): FinlightApiError {
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  const isProblem =
    isObject(parsed) &&
    ((contentType ?? '').toLowerCase().includes('application/problem+json') ||
      (typeof parsed.code === 'string' &&
        (typeof parsed.type === 'string' || typeof parsed.title === 'string')));
  if (isObject(parsed) && isProblem) {
    return createApiError({
      status,
      code: stringOrNull(parsed.code),
      type: stringOrNull(parsed.type),
      title: stringOrNull(parsed.title),
      detail: stringOrNull(parsed.detail),
      requestId: stringOrNull(parsed.requestId) ?? sentRequestId,
      errors: fieldErrors(parsed.errors),
      raw: text,
      json: parsed,
      limitType: status === 429 ? classifyRateLimit(parsed) : null,
      retryAfterMs,
    });
  }
  if (isObject(parsed)) {
    // NestJS default form: {statusCode, message: string | string[], error}
    const message = parsed.message;
    const messages = Array.isArray(message)
      ? message.filter((m): m is string => typeof m === 'string')
      : typeof message === 'string'
        ? [message]
        : [];
    return createApiError({
      status,
      code: null,
      type: null,
      title: stringOrNull(parsed.error),
      detail: messages.length ? messages.join('; ') : null,
      requestId: stringOrNull(parsed.requestId) ?? sentRequestId,
      errors: Array.isArray(message) ? messages.map((m) => ({ field: null, issue: m })) : [],
      raw: text,
      json: parsed,
      limitType: status === 429 ? classifyRateLimit(parsed) : null,
      retryAfterMs,
    });
  }
  return createApiError({
    status,
    code: null,
    type: null,
    title: null,
    detail: null,
    requestId: sentRequestId,
    errors: [],
    raw: text.length ? text : null,
    ...(status >= 500 && status < 600 ? { apiKind: 'other' as const } : {}),
    limitType: status === 429 ? 'unknown' : null,
    retryAfterMs,
    message: `HTTP ${status}: the server answered with a non-JSON body`,
  });
}

/** Retry class of an API error: never, once after the burst wait, or backoff. */
export function retryClass(err: FinlightApiError): 'never' | 'burst' | 'backoff' {
  if (err instanceof RateLimitedError) return err.limitType === 'burst' ? 'burst' : 'never';
  if (err.status === 429) return 'never';
  if (err.status >= 500) return 'backoff';
  return 'never';
}

class AttemptTimeout extends Error {}

async function readBody(res: Response, limit: number): Promise<string> {
  const declared = res.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new FinlightDecodeError(`response body larger than maxResponseBytes (${limit})`);
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new FinlightDecodeError(`response body larger than maxResponseBytes (${limit})`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class HttpTransport {
  readonly #apiKey: string;
  readonly #config: ResolvedConfig;

  constructor(apiKey: string, config: ResolvedConfig) {
    this.#apiKey = apiKey;
    this.#config = config;
  }

  get config(): ResolvedConfig {
    return this.#config;
  }

  url(path: string, query?: Array<[string, string]>): string {
    const qs = query && query.length ? `?${encodeQuery(query)}` : '';
    return `${this.#config.baseUrl}${path}${qs}`;
  }

  private backoff(retry: number): number {
    const { retryBaseDelayMs, retryMaxDelayMs } = this.#config;
    const capped = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** retry);
    return Math.round(capped * (0.5 + Math.random() * 0.5));
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const cfg = this.#config;
    const clock = cfg.clock;
    const requestId = req.requestId ?? `req_${randomUUID()}`;
    const started = clock.now();
    const deadline = cfg.totalTimeoutMs === null ? null : started + cfg.totalTimeoutMs;
    let retries = 0;
    let burstRetried = false;
    const url = this.url(req.path, req.query);
    const label = `${req.method} ${req.path}`;

    const waitOrGiveUp = async (ms: number, lastError: Error): Promise<void> => {
      if (deadline !== null && clock.now() + ms > deadline) {
        throw new FinlightTimeoutError(`${label}: totalTimeoutMs (${cfg.totalTimeoutMs}) reached`, lastError);
      }
      await sleep(clock, ms, req.signal);
    };

    for (;;) {
      if (req.signal?.aborted) throw req.signal.reason;
      let attemptTimeout = cfg.timeoutMs;
      if (deadline !== null) {
        const left = deadline - clock.now();
        if (left <= 0) {
          throw new FinlightTimeoutError(`${label}: totalTimeoutMs (${cfg.totalTimeoutMs}) reached`);
        }
        attemptTimeout = Math.min(attemptTimeout, left);
      }

      let failure: Error | null = null;
      let burstWait: { ms: number; error: FinlightApiError } | null = null;
      try {
        const response = await this.attempt(req, url, requestId, attemptTimeout);
        if (response.status < 300 || (response.status === 304 && req.allowNotModified)) {
          let body: unknown = null;
          if (response.status !== 304 && response.text.length > 0) {
            try {
              body = JSON.parse(response.text);
            } catch (err) {
              throw new FinlightDecodeError(`${label}: the response is not valid JSON`, null, undefined, err);
            }
          }
          cfg.log.debug(`${label} -> ${response.status} (${requestId})`);
          return { status: response.status, headers: response.headers, body, requestId };
        }
        if (response.status < 400) {
          throw new FinlightDecodeError(`${label}: unexpected HTTP ${response.status}`);
        }
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), clock.now());
        const apiError = parseApiError(
          response.status,
          response.headers.get('content-type'),
          response.text,
          requestId,
          retryAfterMs,
        );
        cfg.log.debug(`${label} -> ${response.status} ${apiError.code ?? ''} (${requestId})`);
        const cls = retryClass(apiError);
        if (cls === 'burst' && cfg.retryOnBurst === 'once' && !burstRetried) {
          burstWait = { ms: retryAfterMs ?? cfg.burstWaitMs, error: apiError };
        } else if (cls !== 'backoff' || retries >= cfg.maxRetries) {
          throw apiError;
        } else {
          failure = apiError;
        }
      } catch (err) {
        if (req.signal?.aborted) throw req.signal.reason;
        if (err instanceof FinlightApiError || err instanceof FinlightDecodeError) throw err;
        if (err instanceof AttemptTimeout) {
          failure = new FinlightTimeoutError(`${label}: no response within ${attemptTimeout} ms`);
        } else {
          const reason = err instanceof Error ? err.message : String(err);
          failure = new FinlightNetworkError(`${label}: request failed (${reason})`, err);
        }
        if (retries >= cfg.maxRetries) throw failure;
      }
      if (burstWait) {
        burstRetried = true;
        cfg.log.warn(`${label}: burst rate limit hit, retrying once in ${burstWait.ms} ms (${requestId})`);
        await waitOrGiveUp(burstWait.ms, burstWait.error);
        continue;
      }
      if (!failure) continue;
      const delay = this.backoff(retries);
      retries += 1;
      cfg.log.warn(
        `${label}: ${failure.message}; retry ${retries}/${cfg.maxRetries} in ${delay} ms (${requestId})`,
      );
      await waitOrGiveUp(delay, failure);
    }
  }

  private async attempt(
    req: HttpRequest,
    url: string,
    requestId: string,
    timeoutMs: number,
  ): Promise<{ status: number; headers: Headers; text: string }> {
    const cfg = this.#config;
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort(req.signal?.reason);
    req.signal?.addEventListener('abort', onAbort, { once: true });
    // Attempt timeouts use a real timer; the injectable clock drives retry and burst waits.
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new AttemptTimeout('timeout'));
    }, timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'User-Agent': cfg.userAgent,
      'x-client-version': cfg.clientVersion,
      'X-API-KEY': this.#apiKey,
      'X-Request-Id': requestId,
      ...(req.headers ?? {}),
    };
    let body: string | undefined;
    if (req.rawBody !== undefined) {
      body = req.rawBody;
      headers['Content-Type'] = 'application/json';
    } else if (req.body !== undefined) {
      body = req.body;
      headers['Content-Type'] = 'application/json';
    }
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: controller.signal,
        redirect: 'follow',
      };
      if (body !== undefined) init.body = body;
      const res = await cfg.fetch(url, init);
      const text = await readBody(res, cfg.maxResponseBytes);
      return { status: res.status, headers: res.headers, text };
    } catch (err) {
      if (timedOut && !req.signal?.aborted) throw new AttemptTimeout('timeout');
      throw err;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
