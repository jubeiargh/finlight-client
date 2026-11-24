import { FinlightValidationError } from './errors';
import { isObject } from './internal/json';
import type {
  CompanyRole,
  EventDirection,
  EventType,
  Importance,
  IncludeBlock,
  OrderBy,
  SortOrder,
} from './vocab';
import { PAYLOAD_VERSION } from './vocab';

/*
 * Request rules:
 * - Only keys the caller set are sent. No defaults are injected (no `languages: ['en']`,
 *   no `to = now`, no `limit`). An empty search sends exactly `{}`.
 * - Unknown keys are rejected before any network call (the server would drop them
 *   silently and still charge the call). Values of vocabularies are not checked here.
 * - `undefined` means "not set". `null` is rejected: leave the key out instead.
 */

type List<T> = readonly T[];

/** A timestamp: a `Date` (sent as UTC ISO 8601 with milliseconds) or a string (sent unchanged). */
export type DateInput = Date | string;

export interface SearchParams {
  /** Query language, e.g. `ticker:AAPL AND eventType:earnings`. */
  query?: string;
  /** Restrict to these source domains. */
  sources?: List<string>;
  /** Add non-default sources to the default pool. */
  optInSources?: List<string>;
  excludeSources?: List<string>;
  /** Lower bound on the `orderBy` timestamp. */
  from?: DateInput;
  /** Upper bound on the `orderBy` timestamp. */
  to?: DateInput;
  /** ISO 639-1 codes. The server default is `['en']`. Must not be empty. */
  languages?: List<string>;
  tickers?: List<string>;
  /** The story's geographic focus (ISO alpha-2). */
  countries?: List<string>;
  categories?: List<string>;
  /** `true` keeps only articles with scraped content. */
  hasContent?: boolean;
  roles?: List<CompanyRole>;
  /** 0 to 1. */
  minRelevance?: number;
  eventTypes?: List<EventType>;
  eventDirections?: List<EventDirection>;
  minImportance?: Importance;
  sectors?: List<string>;
  /** Where the company is domiciled (ISO alpha-2). */
  companyCountries?: List<string>;
  /** Primary-listing MICs. */
  exchanges?: List<string>;
  orderBy?: OrderBy;
  order?: SortOrder;
  /** Page size, 1 to 100. The server default is 20. */
  limit?: number;
  /** `pagination.nextCursor` of the previous page. */
  cursor?: string;
  /** Extra blocks: `content`, `companies`, `events` (at most 3). */
  include?: List<IncludeBlock>;
}

/** Subscribe parameters of the enriched stream (`client.stream`). */
export interface StreamParams {
  query?: string;
  sources?: List<string>;
  excludeSources?: List<string>;
  optInSources?: List<string>;
  /** One language, ISO 639-1. The server default is `en`. */
  language?: string;
  tickers?: List<string>;
  countries?: List<string>;
  categories?: List<string>;
  excludeEmptyContent?: boolean;
  /** Without it the server never sends `article.updated`. */
  includeUpdates?: boolean;
  include?: List<IncludeBlock>;
}

/** Subscribe parameters of the raw stream (`client.rawStream`). Raw knows no `include`. */
export interface RawStreamParams {
  query?: string;
  sources?: List<string>;
  excludeSources?: List<string>;
  language?: string;
  includeUpdates?: boolean;
}

export interface CompanySearchParams {
  /** Ticker, name, alias, ISIN, `XNAS:AMD` or vendor notations. At most 200 characters. */
  q: string;
  /** MIC or alias that narrows the hits. At most 32 characters. */
  mic?: string;
}

type Kind = 'string' | 'strings' | 'boolean' | 'number' | 'integer' | 'date' | 'include';

const SEARCH_KEYS: Record<keyof SearchParams, Kind> = {
  query: 'string',
  sources: 'strings',
  optInSources: 'strings',
  excludeSources: 'strings',
  from: 'date',
  to: 'date',
  languages: 'strings',
  tickers: 'strings',
  countries: 'strings',
  categories: 'strings',
  hasContent: 'boolean',
  roles: 'strings',
  minRelevance: 'number',
  eventTypes: 'strings',
  eventDirections: 'strings',
  minImportance: 'string',
  sectors: 'strings',
  companyCountries: 'strings',
  exchanges: 'strings',
  orderBy: 'string',
  order: 'string',
  limit: 'integer',
  cursor: 'string',
  include: 'include',
};

const STREAM_KEYS: Record<keyof StreamParams, Kind> = {
  query: 'string',
  sources: 'strings',
  excludeSources: 'strings',
  optInSources: 'strings',
  language: 'string',
  tickers: 'strings',
  countries: 'strings',
  categories: 'strings',
  excludeEmptyContent: 'boolean',
  includeUpdates: 'boolean',
  include: 'include',
};

const RAW_STREAM_KEYS: Record<keyof RawStreamParams, Kind> = {
  query: 'string',
  sources: 'strings',
  excludeSources: 'strings',
  language: 'string',
  includeUpdates: 'boolean',
};

function fail(message: string, param: string | null = null): never {
  throw new FinlightValidationError(message, param);
}

export function assertParamsObject(params: unknown, what: string): Record<string, unknown> {
  if (params === undefined) return {};
  if (!isObject(params)) fail(`${what} must be an object`);
  return params as Record<string, unknown>;
}

function checkKeys(params: Record<string, unknown>, allowed: Record<string, Kind>, what: string): void {
  for (const key of Object.keys(params)) {
    if (!Object.prototype.hasOwnProperty.call(allowed, key)) {
      fail(
        `unknown ${what} parameter "${key}"; the server would ignore it silently. ` +
          'See https://docs.finlight.me for the v3 parameters.',
        key,
      );
    }
  }
}

function formatDate(key: string, value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(`${key} is an invalid Date`, key);
    return value.toISOString();
  }
  return fail(`${key} must be a Date or a string`, key);
}

function convert(key: string, kind: Kind, value: unknown): unknown {
  if (value === null) fail(`${key} must not be null; leave it out instead`, key);
  switch (kind) {
    case 'string':
      if (typeof value !== 'string') fail(`${key} must be a string`, key);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') fail(`${key} must be a boolean`, key);
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a finite number`, key);
      return value;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${key} must be an integer`, key);
      return value;
    case 'date':
      return formatDate(key, value);
    case 'strings':
    case 'include':
      if (!Array.isArray(value)) fail(`${key} must be an array of strings`, key);
      for (const item of value as unknown[]) {
        if (typeof item !== 'string') fail(`${key} must be an array of strings`, key);
      }
      return [...(value as string[])];
  }
}

function build(
  params: Record<string, unknown>,
  allowed: Record<string, Kind>,
  what: string,
): Record<string, unknown> {
  checkKeys(params, allowed, what);
  const out: Record<string, unknown> = {};
  // Built from the fixed key list, never by copying the caller's object.
  for (const [key, kind] of Object.entries(allowed)) {
    const value = params[key];
    if (value === undefined) continue;
    const converted = convert(key, kind, value);
    if (kind === 'include') {
      const blocks = converted as string[];
      if (blocks.length > 3) fail('include takes at most 3 values', key);
      if (blocks.length === 0) continue;
    }
    out[key] = converted;
  }
  return out;
}

/** Validates search params and returns the JSON body. */
export function buildSearchBody(input: unknown): Record<string, unknown> {
  const params = assertParamsObject(input, 'search');
  const body = build(params, SEARCH_KEYS, 'search');
  if (body.limit !== undefined) {
    const limit = body.limit as number;
    if (limit < 1 || limit > 100) fail('limit must be between 1 and 100', 'limit');
  }
  if (body.languages !== undefined && (body.languages as string[]).length === 0) {
    fail('languages must not be empty; leave it out for the server default', 'languages');
  }
  if (body.minRelevance !== undefined) {
    const v = body.minRelevance as number;
    if (v < 0 || v > 1) fail('minRelevance must be between 0 and 1', 'minRelevance');
  }
  if (body.cursor !== undefined && (body.cursor as string).length === 0) {
    fail('cursor must not be empty', 'cursor');
  }
  return body;
}

/** Validates stream params and returns the subscribe frame without `clientNonce`. */
export function buildSubscribe(input: unknown, raw: boolean): Record<string, unknown> {
  const params = assertParamsObject(input, raw ? 'rawStream' : 'stream');
  if (raw && Object.prototype.hasOwnProperty.call(params, 'include')) {
    fail('rawStream has no include: raw delivers the article skeleton only', 'include');
  }
  const fields = build(params, raw ? RAW_STREAM_KEYS : STREAM_KEYS, raw ? 'rawStream' : 'stream');
  return { payloadVersion: PAYLOAD_VERSION, ...fields };
}

/** Validates an `include` option for GET lookups. */
export function checkInclude(include: unknown): string[] {
  if (include === undefined) return [];
  const list = convert('include', 'include', include) as string[];
  if (list.length > 3) fail('include takes at most 3 values', 'include');
  return list;
}

export function checkNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`, name);
  return value;
}

export function checkCompanySearch(input: unknown): CompanySearchParams {
  const params = assertParamsObject(input, 'companies.search');
  checkKeys(params, { q: 'string', mic: 'string' }, 'companies.search');
  const q = params.q;
  if (typeof q !== 'string' || q.length === 0) fail('q must be a non-empty string', 'q');
  if (q.length > 200) fail('q must be at most 200 characters', 'q');
  const out: CompanySearchParams = { q };
  if (params.mic !== undefined) {
    if (typeof params.mic !== 'string' || params.mic.length === 0)
      fail('mic must be a non-empty string', 'mic');
    if (params.mic.length > 32) fail('mic must be at most 32 characters', 'mic');
    out.mic = params.mic;
  }
  return out;
}

export function checkCompanyId(value: unknown, name = 'companyId'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(`${name} must be an integer of at least 1`, name);
  }
  return value;
}

export function checkCompanyIds(value: unknown): number[] {
  if (!Array.isArray(value)) fail('ids must be an array of integers', 'ids');
  const ids = value as unknown[];
  if (ids.length < 1 || ids.length > 10) fail('ids takes 1 to 10 values', 'ids');
  return ids.map((id) => checkCompanyId(id, 'ids'));
}

/** Checks option objects (`{ signal, include, ... }`) for unknown keys. */
export function checkOptions(
  input: unknown,
  allowed: readonly string[],
  what: string,
): Record<string, unknown> {
  if (input === undefined) return {};
  if (!isObject(input)) fail(`${what} options must be an object`);
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) fail(`unknown ${what} option "${key}"`, key);
  }
  const signal = input.signal;
  const looksLikeSignal =
    isObject(signal) && typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function';
  if (signal !== undefined && !looksLikeSignal) fail('signal must be an AbortSignal', 'signal');
  return input;
}

/** Encodes query pairs. Arrays are comma-joined into one parameter (never `key[]=`). */
export function encodeQuery(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
