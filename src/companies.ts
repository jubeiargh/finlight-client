import type { CallOptions } from './articles';
import { decodeCompanyRecord, decodeEntries, envelopeField, toDecodeError } from './decode';
import { FinlightValidationError } from './errors';
import type { HttpTransport } from './http';
import type { CompanyList, CompanyRecord, SkippedEntry } from './models';
import {
  checkCompanyId,
  checkCompanyIds,
  checkCompanySearch,
  checkOptions,
  type CompanySearchParams,
} from './params';

export interface CompanyGetOptions extends CallOptions {
  /**
   * Your own ETag, from `cacheInfo(record)` of a record you kept. The SDK sends it as
   * `If-None-Match`; on 304 the call returns `null` ("not modified"). Without this option
   * no `If-None-Match` is sent. A 304 costs 1 credit too.
   */
  ifNoneMatch?: string;
}

/**
 * HTTP caching data of a record from `companies.get`. The SDK keeps no cache of its own;
 * use this to keep records yourself and pass the ETag back as `ifNoneMatch`.
 */
export interface CacheInfo {
  etag: string | null;
  cacheControl: string | null;
}

const CACHE_INFO = new WeakMap<object, CacheInfo>();

/** ETag and Cache-Control of a record returned by `companies.get`, or `null`. */
export function cacheInfo(record: CompanyRecord): CacheInfo | null {
  return CACHE_INFO.get(record) ?? null;
}

/** An array of entries plus the entries that could not be decoded (`skipped`, also logged). */
export function withSkipped<T>(items: T[], skipped: SkippedEntry[]): T[] & { skipped: SkippedEntry[] } {
  // Not enumerable: the array still serializes and spreads like a plain array.
  Object.defineProperty(items, 'skipped', { value: skipped, enumerable: false });
  return items as T[] & { skipped: SkippedEntry[] };
}

/**
 * Company master data. Needs the `entityAccess` entitlement (403 otherwise).
 * Each call costs 1 credit, like an article request; a 304 revalidation and errors
 * cost 1 credit too.
 */
export class CompaniesService {
  constructor(private readonly http: HttpTransport) {}

  /** Resolves a ticker, name, ISIN or vendor notation. At most 10 results, no pages. Costs 1 credit. */
  async search(params: CompanySearchParams, options?: CallOptions): Promise<CompanyList> {
    const p = checkCompanySearch(params);
    const opts = checkOptions(options, ['signal'], 'companies.search');
    const query: Array<[string, string]> = [['q', p.q]];
    if (p.mic !== undefined) query.push(['mic', p.mic]);
    return this.list(query, opts.signal as AbortSignal | undefined);
  }

  /**
   * Batch resolve 1 to 10 ids. Unknown ids are left out; the order is not guaranteed.
   * Costs 1 credit per request, not per id.
   */
  async getMany(ids: readonly number[], options?: CallOptions): Promise<CompanyList> {
    const checked = checkCompanyIds(ids);
    const opts = checkOptions(options, ['signal'], 'companies.getMany');
    return this.list([['ids', checked.join(',')]], opts.signal as AbortSignal | undefined);
  }

  private async list(query: Array<[string, string]>, signal: AbortSignal | undefined): Promise<CompanyList> {
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
   * `GET /v3/companies/{companyId}`. The SDK keeps no cache: every call is a request and
   * costs 1 credit, like an article request, a 304 included. To save credits, keep the
   * record yourself and do not call again within `max-age`; `cacheInfo(record)` exposes the
   * ETag and Cache-Control. With `ifNoneMatch` a 304 returns `null`. A 404 is a
   * `FinlightApiError`.
   */
  get(companyId: number, options?: CallOptions): Promise<CompanyRecord>;
  get(companyId: number, options: CompanyGetOptions): Promise<CompanyRecord | null>;
  async get(companyId: number, options?: CompanyGetOptions): Promise<CompanyRecord | null> {
    const id = checkCompanyId(companyId);
    const opts = checkOptions(options, ['signal', 'ifNoneMatch'], 'companies.get');
    if (opts.ifNoneMatch !== undefined && (typeof opts.ifNoneMatch !== 'string' || !opts.ifNoneMatch)) {
      throw new FinlightValidationError('ifNoneMatch must be a non-empty string');
    }
    const etag = opts.ifNoneMatch as string | undefined;
    const res = await this.http.request({
      method: 'GET',
      path: `/v3/companies/${id}`,
      // fetch adds "Cache-Control: no-cache" to conditional requests unless one is set, and the
      // server then never answers 304. max-age=0 still asks for revalidation.
      headers: etag !== undefined ? { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } : {},
      allowNotModified: etag !== undefined,
      signal: opts.signal as AbortSignal | undefined,
    });
    // Only possible with your own ETag: "not modified" is null, never an error.
    if (res.status === 304) return null;
    let record: CompanyRecord;
    try {
      record = decodeCompanyRecord(envelopeField(res.body, 'company'));
    } catch (err) {
      throw toDecodeError(err, res.body);
    }
    CACHE_INFO.set(record, { etag: res.headers.get('etag'), cacheControl: res.headers.get('cache-control') });
    return record;
  }
}
