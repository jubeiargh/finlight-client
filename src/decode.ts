import { FinlightDecodeError } from './errors';
import { hasOwn, isObject, type JsonObject } from './internal/json';
import { attachRaw } from './internal/raw';
import type { InternalLogger } from './logger';
import type {
  Article,
  ArticlePage,
  ArticleSource,
  Company,
  CompanyRecord,
  EventTag,
  Listing,
  Media,
  Pagination,
  Sentiment,
  SkippedEntry,
  Source,
} from './models';

/*
 * Tolerant reader (R-MODELS-1): an entry fails only when a required key is missing, null
 * or of the wrong JSON type, or when another key is present with the wrong JSON type.
 * Values are never coerced ("0.95" stays a failure, not 0.95). Unknown keys are kept.
 */

export class DecodeFailure extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function requireObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw new DecodeFailure(path, `expected an object, got ${typeName(value)}`);
  return value;
}

function requiredString(obj: JsonObject, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new DecodeFailure(`${path}.${key}`, `required string, got ${typeName(v)}`);
  return v;
}

function requiredInteger(obj: JsonObject, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new DecodeFailure(`${path}.${key}`, `required integer, got ${typeName(v)}`);
  }
  return v;
}

function nullableString(obj: JsonObject, key: string, path: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DecodeFailure(`${path}.${key}`, `expected string, got ${typeName(v)}`);
  return v;
}

function nullableNumber(obj: JsonObject, key: string, path: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number') throw new DecodeFailure(`${path}.${key}`, `expected number, got ${typeName(v)}`);
  return v;
}

function nullableInteger(obj: JsonObject, key: string, path: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new DecodeFailure(`${path}.${key}`, `expected integer, got ${typeName(v)}`);
  }
  return v;
}

function nullableBoolean(obj: JsonObject, key: string, path: string): boolean | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean')
    throw new DecodeFailure(`${path}.${key}`, `expected boolean, got ${typeName(v)}`);
  return v;
}

/** A list that reads as `[]` when missing or null. */
function list<T>(obj: JsonObject, key: string, path: string, item: (v: unknown, p: string) => T): T[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DecodeFailure(`${path}.${key}`, `expected array, got ${typeName(v)}`);
  return v.map((entry, i) => item(entry, `${path}.${key}[${i}]`));
}

function stringItem(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new DecodeFailure(path, `expected string, got ${typeName(v)}`);
  return v;
}

function integerItem(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new DecodeFailure(path, `expected integer, got ${typeName(v)}`);
  }
  return v;
}

function decodeArticleSource(value: unknown, path: string): ArticleSource {
  const obj = requireObject(value, path);
  return { ...obj, domain: requiredString(obj, 'domain', path), type: nullableString(obj, 'type', path) };
}

function decodeMedia(value: unknown, path: string): Media {
  const obj = requireObject(value, path);
  return { ...obj, url: nullableString(obj, 'url', path) };
}

function decodeSentiment(value: unknown, path: string): Sentiment {
  const obj = requireObject(value, path);
  return {
    ...obj,
    label: nullableString(obj, 'label', path),
    confidence: nullableNumber(obj, 'confidence', path),
  };
}

function decodeListing(value: unknown, path: string): Listing {
  const obj = requireObject(value, path);
  return {
    ...obj,
    ticker: nullableString(obj, 'ticker', path),
    mic: nullableString(obj, 'mic', path),
    country: nullableString(obj, 'country', path),
  };
}

function nullableListing(obj: JsonObject, key: string, path: string): Listing | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  return decodeListing(v, `${path}.${key}`);
}

function decodeCompanyListing(value: unknown, path: string): Listing {
  const obj = requireObject(value, path);
  return { ...decodeListing(obj, path), active: nullableBoolean(obj, 'active', path) };
}

export function decodeCompany(value: unknown, path = 'company'): Company {
  const obj = requireObject(value, path);
  const company: Company = {
    ...obj,
    companyId: requiredInteger(obj, 'companyId', path),
    name: requiredString(obj, 'name', path),
    isin: nullableString(obj, 'isin', path),
    primaryListing: nullableListing(obj, 'primaryListing', path),
    confidence: nullableNumber(obj, 'confidence', path),
    role: nullableString(obj, 'role', path),
    relevance: nullableNumber(obj, 'relevance', path),
  };
  return attachRaw(company, value);
}

export function decodeEventTag(value: unknown, path = 'event'): EventTag {
  const obj = requireObject(value, path);
  const event: EventTag = {
    ...obj,
    type: requiredString(obj, 'type', path),
    direction: nullableString(obj, 'direction', path),
    importance: nullableString(obj, 'importance', path),
    confidence: nullableNumber(obj, 'confidence', path),
  };
  // Two-state key: present (a list) or absent. A null is read as absent.
  delete (event as { companyIds?: unknown }).companyIds;
  if (obj.companyIds !== undefined && obj.companyIds !== null) {
    if (!Array.isArray(obj.companyIds)) {
      throw new DecodeFailure(`${path}.companyIds`, `expected array, got ${typeName(obj.companyIds)}`);
    }
    event.companyIds = obj.companyIds.map((v, i) => integerItem(v, `${path}.companyIds[${i}]`));
  }
  return attachRaw(event, value);
}

/** Decodes one article. Throws `DecodeFailure`. */
export function decodeArticleStrict(value: unknown, path = 'article'): Article {
  const obj = requireObject(value, path);
  const article: Article = {
    ...obj,
    id: requiredString(obj, 'id', path),
    link: requiredString(obj, 'link', path),
    source: decodeArticleSource(obj.source, `${path}.source`),
    title: requiredString(obj, 'title', path),
    summary: nullableString(obj, 'summary', path),
    language: nullableString(obj, 'language', path),
    media: list(obj, 'media', path, decodeMedia),
    publishedAt: nullableString(obj, 'publishedAt', path),
    firstSeenAt: nullableString(obj, 'firstSeenAt', path),
    revisedAt: nullableString(obj, 'revisedAt', path),
    availableAt: nullableString(obj, 'availableAt', path),
    countries: list(obj, 'countries', path, stringItem),
    categories: list(obj, 'categories', path, stringItem),
  };
  // Gated keys: copy only when present (R-NULL-1).
  const gated = article as {
    content?: unknown;
    sentiment?: unknown;
    companies?: unknown;
    events?: unknown;
  };
  delete gated.content;
  delete gated.sentiment;
  delete gated.companies;
  delete gated.events;
  if (hasOwn(obj, 'content')) article.content = nullableString(obj, 'content', path);
  if (hasOwn(obj, 'sentiment')) {
    article.sentiment = obj.sentiment === null ? null : decodeSentiment(obj.sentiment, `${path}.sentiment`);
  }
  if (obj.companies !== undefined && obj.companies !== null) {
    if (!Array.isArray(obj.companies)) {
      throw new DecodeFailure(`${path}.companies`, `expected array, got ${typeName(obj.companies)}`);
    }
    article.companies = obj.companies.map((c, i) => decodeCompany(c, `${path}.companies[${i}]`));
  }
  if (obj.events !== undefined && obj.events !== null) {
    if (!Array.isArray(obj.events)) {
      throw new DecodeFailure(`${path}.events`, `expected array, got ${typeName(obj.events)}`);
    }
    article.events = obj.events.map((e, i) => decodeEventTag(e, `${path}.events[${i}]`));
  }
  return attachRaw(article, value);
}

/** Decodes one article for a single lookup. Throws `FinlightDecodeError`. */
export function decodeArticle(value: unknown, path = 'article'): Article {
  try {
    return decodeArticleStrict(value, path);
  } catch (err) {
    throw toDecodeError(err, value);
  }
}

export function toDecodeError(err: unknown, raw: unknown): FinlightDecodeError {
  if (err instanceof FinlightDecodeError) return err;
  if (err instanceof DecodeFailure) {
    return new FinlightDecodeError(`could not decode the response: ${err.message}`, err.path, raw);
  }
  return new FinlightDecodeError('could not decode the response', null, raw, err);
}

export function decodeCompanyRecord(value: unknown, path = 'company'): CompanyRecord {
  const obj = requireObject(value, path);
  const record: CompanyRecord = {
    ...obj,
    companyId: requiredInteger(obj, 'companyId', path),
    name: requiredString(obj, 'name', path),
    country: nullableString(obj, 'country', path),
    sector: nullableString(obj, 'sector', path),
    industry: nullableString(obj, 'industry', path),
    isins: list(obj, 'isins', path, stringItem),
    primaryListing: nullableListing(obj, 'primaryListing', path),
    listings: list(obj, 'listings', path, decodeCompanyListing),
    updatedAt: nullableString(obj, 'updatedAt', path),
  };
  return attachRaw(record, value);
}

export function decodeSource(value: unknown, path = 'source'): Source {
  const obj = requireObject(value, path);
  const source: Source = {
    ...obj,
    domain: requiredString(obj, 'domain', path),
    name: nullableString(obj, 'name', path),
    type: nullableString(obj, 'type', path),
    isDefault: nullableBoolean(obj, 'isDefault', path),
    isCustom: nullableBoolean(obj, 'isCustom', path),
    country: nullableString(obj, 'country', path),
    languages: list(obj, 'languages', path, stringItem),
  };
  delete (source as { hasContent?: unknown }).hasContent;
  if (obj.hasContent !== undefined && obj.hasContent !== null) {
    if (typeof obj.hasContent !== 'boolean') {
      throw new DecodeFailure(`${path}.hasContent`, `expected boolean, got ${typeName(obj.hasContent)}`);
    }
    source.hasContent = obj.hasContent;
  }
  return attachRaw(source, value);
}

export function decodePagination(value: unknown, path = 'pagination'): Pagination {
  const obj = requireObject(value, path);
  const hasMore = nullableBoolean(obj, 'hasMore', path);
  return {
    ...obj,
    limit: nullableInteger(obj, 'limit', path),
    returned: nullableInteger(obj, 'returned', path),
    hasMore: hasMore === true,
    nextCursor: nullableString(obj, 'nextCursor', path),
  };
}

/** Decodes each entry on its own. Broken entries go to `skipped` and are logged. */
export function decodeEntries<T>(
  values: unknown,
  path: string,
  decode: (v: unknown, p: string) => T,
  log: InternalLogger,
): { items: T[]; skipped: SkippedEntry[] } {
  if (!Array.isArray(values)) throw new DecodeFailure(path, `expected array, got ${typeName(values)}`);
  const items: T[] = [];
  const skipped: SkippedEntry[] = [];
  values.forEach((entry, index) => {
    try {
      items.push(decode(entry, `${path}[${index}]`));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ index, raw: entry, reason });
      log.warn(`skipped an entry that could not be decoded: ${reason}`);
    }
  });
  return { items, skipped };
}

export function decodeArticlePage(body: unknown, log: InternalLogger): ArticlePage {
  try {
    const obj = requireObject(body, 'response');
    const { items, skipped } = decodeEntries(obj.articles, 'articles', decodeArticleStrict, log);
    const page: ArticlePage = {
      articles: items,
      pagination: decodePagination(obj.pagination),
      skipped,
    };
    return attachRaw(page, body);
  } catch (err) {
    throw toDecodeError(err, body);
  }
}

/** Unwraps `{"<key>": ...}` envelopes. */
export function envelopeField(body: unknown, key: string): unknown {
  if (!isObject(body) || !hasOwn(body, key)) {
    throw new FinlightDecodeError(`could not decode the response: missing "${key}"`, key, body);
  }
  return body[key];
}
