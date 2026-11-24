import type { CallOptions } from './articles';
import { decodeCompanyRecord, decodeEntries, envelopeField, toDecodeError } from './decode';
import { FinlightApiError, FinlightValidationError } from './errors';
import type { HttpTransport } from './http';
import type { CompanyRecord, SkippedEntry } from './models';
import {
  checkCompanyId,
  checkCompanyIds,
  checkCompanySearch,
  checkOptions,
  type CompanySearchParams,
} from './params';

export interface CompanyGetOptions extends CallOptions {
  /**
   * Send `If-None-Match` with this ETag. On 304 the SDK returns its cached record for it.
   * Without this option the SDK revalidates its own cache automatically.
   */
  ifNoneMatch?: string;
}

/** HTTP caching data of a record from `companies.get`. */
export interface CacheInfo {
  etag: string | null;
  cacheControl: string | null;
  /** `true` when the server answered 304 and the cached record was returned. */
  notModified: boolean;
}

const CACHE_INFO = new WeakMap<object, CacheInfo>();
const SKIPPED = new WeakMap<object, SkippedEntry[]>();

/** ETag and Cache-Control of a record returned by `companies.get`, or `null`. */
export function cacheInfo(record: CompanyRecord): CacheInfo | null {
  return CACHE_INFO.get(record) ?? null;
}

/** Entries of a list result (`companies.*`, `sources.list`) that could not be decoded. */
export function skippedEntries(list: readonly object[]): SkippedEntry[] {
  return SKIPPED.get(list) ?? [];
}

export function withSkipped<T extends object>(items: T[], skipped: SkippedEntry[]): T[] {
  SKIPPED.set(items, skipped);
  return items;
}

/** Company master data. Needs the `entityAccess` entitlement (403 otherwise). */
export class CompaniesService {
  readonly #cache = new Map<number, { etag: string; record: CompanyRecord }>();

  constructor(private readonly http: HttpTransport) {}

  /** Resolves a ticker, name, ISIN or vendor notation. At most 10 results, no pages. */
  async search(params: CompanySearchParams, options?: CallOptions): Promise<CompanyRecord[]> {
    const p = checkCompanySearch(params);
    const opts = checkOptions(options, ['signal'], 'companies.search');
    const query: Array<[string, string]> = [['q', p.q]];
    if (p.mic !== undefined) query.push(['mic', p.mic]);
    return this.list(query, opts.signal as AbortSignal | undefined);
  }

  /** Batch resolve 1 to 10 ids. Unknown ids are left out; the order is not guaranteed. */
  async getMany(ids: readonly number[], options?: CallOptions): Promise<CompanyRecord[]> {
    const checked = checkCompanyIds(ids);
    const opts = checkOptions(options, ['signal'], 'companies.getMany');
    return this.list([['ids', checked.join(',')]], opts.signal as AbortSignal | undefined);
  }

  private async list(
    query: Array<[string, string]>,
    signal: AbortSignal | undefined,
  ): Promise<CompanyRecord[]> {
    const res = await this.http.request({ method: 'GET', path: '/v3/companies', query, signal });
    try {
      const { items, skipped } = decodeEntries(
        envelopeField(res.body, 'companies'),
        'companies',
        decodeCompanyRecord,
        this.http.config.log,
      );
      return withSkipped(items, skipped);
    } catch (err) {
      throw toDecodeError(err, res.body);
    }
  }

  /**
   * `GET /v3/companies/{companyId}`. Revalidates with the ETag of a cached copy and serves
   * that copy on 304. `cacheInfo(record)` exposes the ETag. A 404 is a `FinlightApiError`.
   */
  async get(companyId: number, options?: CompanyGetOptions): Promise<CompanyRecord> {
    const id = checkCompanyId(companyId);
    const opts = checkOptions(options, ['signal', 'ifNoneMatch'], 'companies.get');
    if (opts.ifNoneMatch !== undefined && (typeof opts.ifNoneMatch !== 'string' || !opts.ifNoneMatch)) {
      throw new FinlightValidationError('ifNoneMatch must be a non-empty string');
    }
    const cached = this.#cache.get(id);
    const etag = (opts.ifNoneMatch as string | undefined) ?? cached?.etag;
    const res = await this.http.request({
      method: 'GET',
      path: `/v3/companies/${id}`,
      // fetch adds "Cache-Control: no-cache" to conditional requests unless one is set, and the
      // server then never answers 304. max-age=0 still asks for revalidation.
      headers: etag ? { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } : {},
      allowNotModified: etag !== undefined,
      signal: opts.signal as AbortSignal | undefined,
    });
    const cacheControl = res.headers.get('cache-control');
    if (res.status === 304) {
      if (cached && cached.etag === etag) {
        CACHE_INFO.set(cached.record, { etag: cached.etag, cacheControl, notModified: true });
        this.touch(id, cached);
        return cached.record;
      }
      throw new FinlightApiError({
        status: 304,
        code: null,
        type: null,
        title: 'Not Modified',
        detail: 'The record did not change, and the SDK holds no cached copy for this ETag.',
        requestId: res.requestId,
        errors: [],
        raw: null,
        channel: 'rest',
        limitType: null,
        retryAfterMs: null,
      });
    }
    let record: CompanyRecord;
    try {
      record = decodeCompanyRecord(envelopeField(res.body, 'company'));
    } catch (err) {
      throw toDecodeError(err, res.body);
    }
    const newEtag = res.headers.get('etag');
    CACHE_INFO.set(record, { etag: newEtag, cacheControl, notModified: false });
    if (newEtag) this.touch(id, { etag: newEtag, record });
    return record;
  }

  private touch(id: number, entry: { etag: string; record: CompanyRecord }): void {
    const size = this.http.config.companyCacheSize;
    if (size <= 0) return;
    this.#cache.delete(id);
    this.#cache.set(id, entry);
    while (this.#cache.size > size) {
      const oldest = this.#cache.keys().next().value as number;
      this.#cache.delete(oldest);
    }
  }
}
