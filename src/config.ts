import type { Agent } from 'node:http';
import { systemClock, type Clock } from './clock';
import { FinlightValidationError } from './errors';
import { isObject } from './internal/json';
import { createLogger, type InternalLogger, type Logger } from './logger';
import { VERSION } from './version';

/** What to do with a 429 caused by the burst limit. */
export type RetryOnBurst = 'off' | 'once';

/**
 * Client configuration. All times are in milliseconds.
 */
export interface FinlightClientConfig {
  /** Required. */
  apiKey: string;
  /** Default `https://api.finlight.me`. A trailing slash does not matter. */
  baseUrl?: string;
  /** Default `wss://wss.finlight.me`. The raw stream uses `<wssUrl>/raw`. */
  wssUrl?: string;

  /** Timeout of one HTTP attempt. Default 30000. */
  timeoutMs?: number;
  /** Optional limit for a whole call, including retries and the burst wait. */
  totalTimeoutMs?: number;
  /** Retries after the first attempt for 5xx, network errors and attempt timeouts. Default 3. */
  maxRetries?: number;
  /** First backoff delay. Default 500. */
  retryBaseDelayMs?: number;
  /** Largest backoff delay. Default 8000. */
  retryMaxDelayMs?: number;
  /**
   * Burst 429 handling: `once` waits at least `burstWaitMs` and retries one time,
   * `off` throws at once. Default `once`.
   * This retry does not count against `maxRetries`.
   */
  retryOnBurst?: RetryOnBurst;
  /** Wait before the burst retry. Default and minimum 10000. A longer `Retry-After` wins. */
  burstWaitMs?: number;
  /** Page limit of `articles.searchAll`. Default 10. */
  maxPages?: number;
  /** Largest REST response body. Default 64 MiB. */
  maxResponseBytes?: number;
  /** Size of the ETag cache of `companies.get` (records). Default 256, 0 turns it off. */
  companyCacheSize?: number;

  /** Application ping interval on streams. Default 25000. */
  pingIntervalMs?: number;
  /** Reconnect when no pong arrived for this long. Default 60000. */
  watchdogTimeoutMs?: number;
  /** Proactive reconnect before the 2 h gateway limit. Default 6900000 (115 min). */
  rotationIntervalMs?: number;
  /** First reconnect delay. Default 1000. */
  reconnectBaseDelayMs?: number;
  /** Largest reconnect delay. Default 30000. */
  reconnectMaxDelayMs?: number;
  /** Delay after "too many connections" and 429 dial refusals. Default 60000. */
  longBackoffMs?: number;
  /**
   * When the WebSocket quota is used up (dial 403 "quota exceeded" or a `quota_exceeded`
   * preemption) the stream keeps trying every `quotaRetryIntervalMs` until the quota allows it
   * again. Default `true`. With `false` the stream ends with the typed error instead.
   */
  reconnectOnQuotaExhausted?: boolean;
  /** Interval of those quota attempts. Default 3600000 (1 h). */
  quotaRetryIntervalMs?: number;
  /** Entries of the per-stream duplicate filter. Default 1000. */
  dedupeCacheSize?: number;
  /** Largest incoming stream message. Default 32 MiB (at least 16 MiB). */
  maxMessageBytes?: number;
  /** WebSocket handshake timeout. Default 30000. */
  connectTimeoutMs?: number;

  /**
   * Your own `fetch` (e.g. with a proxy dispatcher). Its own timeouts and retries then apply;
   * make sure it does not retry on its own.
   */
  fetch?: typeof fetch;
  /** Your own HTTP agent for the WebSocket handshake (e.g. a proxy agent). */
  wsAgent?: Agent;
  /** Logger; default is silent (`NODE_DEBUG=finlight` shows debug output). */
  logger?: Logger;
  /** Replaceable clock, for tests. */
  clock?: Clock;
}

export interface ResolvedConfig {
  baseUrl: string;
  wssUrl: string;
  timeoutMs: number;
  totalTimeoutMs: number | null;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryOnBurst: RetryOnBurst;
  burstWaitMs: number;
  maxPages: number;
  maxResponseBytes: number;
  companyCacheSize: number;
  pingIntervalMs: number;
  watchdogTimeoutMs: number;
  rotationIntervalMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  longBackoffMs: number;
  reconnectOnQuotaExhausted: boolean;
  quotaRetryIntervalMs: number;
  dedupeCacheSize: number;
  maxMessageBytes: number;
  connectTimeoutMs: number;
  fetch: typeof fetch;
  wsAgent: Agent | undefined;
  log: InternalLogger;
  clock: Clock;
  userAgent: string;
  clientVersion: string;
}

export const DEFAULTS = {
  baseUrl: 'https://api.finlight.me',
  wssUrl: 'wss://wss.finlight.me',
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 8_000,
  retryOnBurst: 'once' as RetryOnBurst,
  burstWaitMs: 10_000,
  maxPages: 10,
  maxResponseBytes: 64 * 1024 * 1024,
  companyCacheSize: 256,
  pingIntervalMs: 25_000,
  watchdogTimeoutMs: 60_000,
  rotationIntervalMs: 115 * 60_000,
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 30_000,
  longBackoffMs: 60_000,
  reconnectOnQuotaExhausted: true,
  quotaRetryIntervalMs: 60 * 60_000,
  dedupeCacheSize: 1000,
  maxMessageBytes: 32 * 1024 * 1024,
  connectTimeoutMs: 30_000,
} as const;

export const MIN_BURST_WAIT_MS = 10_000;
export const MIN_MESSAGE_BYTES = 16 * 1024 * 1024;

const CONFIG_KEYS: ReadonlyArray<keyof FinlightClientConfig> = [
  'apiKey',
  'baseUrl',
  'wssUrl',
  'timeoutMs',
  'totalTimeoutMs',
  'maxRetries',
  'retryBaseDelayMs',
  'retryMaxDelayMs',
  'retryOnBurst',
  'burstWaitMs',
  'maxPages',
  'maxResponseBytes',
  'companyCacheSize',
  'pingIntervalMs',
  'watchdogTimeoutMs',
  'rotationIntervalMs',
  'reconnectBaseDelayMs',
  'reconnectMaxDelayMs',
  'longBackoffMs',
  'reconnectOnQuotaExhausted',
  'quotaRetryIntervalMs',
  'dedupeCacheSize',
  'maxMessageBytes',
  'connectTimeoutMs',
  'fetch',
  'wsAgent',
  'logger',
  'clock',
];

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function checkUrl(value: unknown, key: string, protocols: string[]): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FinlightValidationError(`${key} must be a non-empty string`, key);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FinlightValidationError(`${key} is not a valid URL`, key);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new FinlightValidationError(`${key} must use ${protocols.join(' or ')}`, key);
  }
  return stripSlash(value);
}

function num(config: Record<string, unknown>, key: string, fallback: number, min: number): number {
  const v = config[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
    throw new FinlightValidationError(`${key} must be a number of at least ${min}`, key);
  }
  return v;
}

function bool(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = config[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new FinlightValidationError(`${key} must be a boolean`, key);
  return v;
}

export function resolveConfig(input: unknown): { apiKey: string; config: ResolvedConfig } {
  if (!isObject(input)) throw new FinlightValidationError('config must be an object with an apiKey');
  for (const key of Object.keys(input)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new FinlightValidationError(`unknown config key "${key}"`, key);
    }
  }
  const apiKey = input.apiKey;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new FinlightValidationError('apiKey is required', 'apiKey');
  }
  const retryOnBurst = input.retryOnBurst ?? DEFAULTS.retryOnBurst;
  if (retryOnBurst !== 'off' && retryOnBurst !== 'once') {
    throw new FinlightValidationError("retryOnBurst must be 'off' or 'once'", 'retryOnBurst');
  }
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new FinlightValidationError('no fetch implementation available (Node >= 20 is required)', 'fetch');
  }
  const totalTimeout = input.totalTimeoutMs;
  if (totalTimeout !== undefined && (typeof totalTimeout !== 'number' || !(totalTimeout > 0))) {
    throw new FinlightValidationError('totalTimeoutMs must be a positive number', 'totalTimeoutMs');
  }
  const maxRetries = num(input, 'maxRetries', DEFAULTS.maxRetries, 0);
  if (!Number.isInteger(maxRetries))
    throw new FinlightValidationError('maxRetries must be an integer', 'maxRetries');
  const maxPages = num(input, 'maxPages', DEFAULTS.maxPages, 1);
  if (!Number.isInteger(maxPages))
    throw new FinlightValidationError('maxPages must be an integer', 'maxPages');

  const config: ResolvedConfig = {
    baseUrl:
      input.baseUrl === undefined
        ? DEFAULTS.baseUrl
        : checkUrl(input.baseUrl, 'baseUrl', ['https:', 'http:']),
    wssUrl: input.wssUrl === undefined ? DEFAULTS.wssUrl : checkUrl(input.wssUrl, 'wssUrl', ['wss:', 'ws:']),
    timeoutMs: num(input, 'timeoutMs', DEFAULTS.timeoutMs, 1),
    totalTimeoutMs: (totalTimeout as number | undefined) ?? null,
    maxRetries,
    retryBaseDelayMs: num(input, 'retryBaseDelayMs', DEFAULTS.retryBaseDelayMs, 0),
    retryMaxDelayMs: num(input, 'retryMaxDelayMs', DEFAULTS.retryMaxDelayMs, 0),
    retryOnBurst,
    burstWaitMs: Math.max(MIN_BURST_WAIT_MS, num(input, 'burstWaitMs', DEFAULTS.burstWaitMs, 0)),
    maxPages,
    maxResponseBytes: num(input, 'maxResponseBytes', DEFAULTS.maxResponseBytes, 1024),
    companyCacheSize: Math.floor(num(input, 'companyCacheSize', DEFAULTS.companyCacheSize, 0)),
    pingIntervalMs: num(input, 'pingIntervalMs', DEFAULTS.pingIntervalMs, 1),
    watchdogTimeoutMs: num(input, 'watchdogTimeoutMs', DEFAULTS.watchdogTimeoutMs, 1),
    rotationIntervalMs: num(input, 'rotationIntervalMs', DEFAULTS.rotationIntervalMs, 1),
    reconnectBaseDelayMs: num(input, 'reconnectBaseDelayMs', DEFAULTS.reconnectBaseDelayMs, 0),
    reconnectMaxDelayMs: num(input, 'reconnectMaxDelayMs', DEFAULTS.reconnectMaxDelayMs, 0),
    longBackoffMs: num(input, 'longBackoffMs', DEFAULTS.longBackoffMs, 0),
    reconnectOnQuotaExhausted: bool(input, 'reconnectOnQuotaExhausted', DEFAULTS.reconnectOnQuotaExhausted),
    quotaRetryIntervalMs: num(input, 'quotaRetryIntervalMs', DEFAULTS.quotaRetryIntervalMs, 1),
    dedupeCacheSize: Math.floor(num(input, 'dedupeCacheSize', DEFAULTS.dedupeCacheSize, 0)),
    maxMessageBytes: Math.max(MIN_MESSAGE_BYTES, num(input, 'maxMessageBytes', DEFAULTS.maxMessageBytes, 1)),
    connectTimeoutMs: num(input, 'connectTimeoutMs', DEFAULTS.connectTimeoutMs, 1),
    fetch: fetchImpl as typeof fetch,
    wsAgent: input.wsAgent as Agent | undefined,
    log: createLogger(input.logger as Logger | undefined),
    clock: (input.clock as Clock | undefined) ?? systemClock,
    userAgent: `finlight-client-typescript/${VERSION}`,
    clientVersion: VERSION,
  };
  return { apiKey: apiKey, config };
}
