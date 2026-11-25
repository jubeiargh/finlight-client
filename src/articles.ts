import { decodeArticle, decodeArticlePage, envelopeField } from './decode';
import { FinlightValidationError } from './errors';
import type { HttpTransport } from './http';
import type { Article, ArticlePage } from './models';
import {
  buildSearchBody,
  checkInclude,
  checkNonEmptyString,
  checkOptions,
  type SearchParams,
} from './params';

export interface CallOptions {
  /** Cancels the call, including retry and burst waits. */
  signal?: AbortSignal;
}

export interface LookupOptions extends CallOptions {
  /** Extra blocks: `content`, `companies`, `events`. Sent comma-joined. */
  include?: readonly string[];
}

export interface SearchAllOptions extends CallOptions {
  /** Page limit for this call. Default: the client's `maxPages` (10). */
  maxPages?: number;
}

/**
 * Result of `articles.searchAll`. Iterate it once, either by article (`for await (const a of r)`)
 * or by page (`for await (const p of r.pages())`). A second iteration throws.
 */
export interface SearchAllResult extends AsyncIterable<Article> {
  /** Iterates whole pages instead of articles. */
  pages(): AsyncIterable<ArticlePage>;
  /** The last `nextCursor` seen; set when the pager stopped at `maxPages`. Pass it as `cursor` to continue. */
  readonly nextCursor: string | null;
  /** `true` when the pager stopped because `maxPages` was reached while more pages exist. */
  readonly truncated: boolean;
  /** Pages fetched so far. */
  readonly pagesFetched: number;
}

class SearchAllIterator implements SearchAllResult {
  #used = false;
  #nextCursor: string | null = null;
  #truncated = false;
  #pagesFetched = 0;

  constructor(
    private readonly http: HttpTransport,
    private readonly frozenBody: string,
    private readonly maxPages: number,
    private readonly signal: AbortSignal | undefined,
  ) {}

  get nextCursor(): string | null {
    return this.#nextCursor;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  get pagesFetched(): number {
    return this.#pagesFetched;
  }

  private claim(): void {
    if (this.#used) {
      throw new FinlightValidationError(
        'searchAll results can be iterated only once; call searchAll again for a new search',
      );
    }
    this.#used = true;
  }

  async *pagesInternal(): AsyncGenerator<ArticlePage> {
    const log = this.http.config.log;
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= this.maxPages) {
        this.#truncated = true;
        log.warn(
          `searchAll stopped after maxPages (${this.maxPages}); more results exist. ` +
            'Continue with the nextCursor of the result.',
        );
        return;
      }
      // Page 1 is the frozen body; later pages only add or replace `cursor`.
      let body = this.frozenBody;
      if (cursor !== null) {
        const parsed = JSON.parse(this.frozenBody) as Record<string, unknown>;
        parsed.cursor = cursor;
        body = JSON.stringify(parsed);
      }
      const res = await this.http.request({
        method: 'POST',
        path: '/v3/articles/search',
        body,
        signal: this.signal,
      });
      const result = decodeArticlePage(res.body, log);
      this.#pagesFetched += 1;
      this.#nextCursor = result.pagination.nextCursor;
      yield result;
      if (!result.pagination.hasMore || result.pagination.nextCursor === null) {
        this.#nextCursor = null;
        return;
      }
      cursor = result.pagination.nextCursor;
    }
  }

  pages(): AsyncIterable<ArticlePage> {
    this.claim();
    return { [Symbol.asyncIterator]: () => this.pagesInternal() };
  }

  [Symbol.asyncIterator](): AsyncIterator<Article> {
    this.claim();
    const pages = this.pagesInternal();
    async function* articles(): AsyncGenerator<Article> {
      for await (const page of pages) {
        yield* page.articles;
      }
    }
    return articles();
  }
}

export class ArticlesService {
  constructor(private readonly http: HttpTransport) {}

  /** One page of `POST /v3/articles/search`. Sends only the parameters you set. */
  async search(params: SearchParams = {}, options?: CallOptions): Promise<ArticlePage> {
    const body = buildSearchBody(params);
    const opts = checkOptions(options, ['signal'], 'search');
    const res = await this.http.request({
      method: 'POST',
      path: '/v3/articles/search',
      body: JSON.stringify(body),
      signal: opts.signal as AbortSignal | undefined,
    });
    return decodeArticlePage(res.body, this.http.config.log);
  }

  /**
   * Walks the cursor for you. The request body is frozen at this call; later pages only
   * change `cursor`. Stops at `hasMore: false`, `nextCursor: null` or `maxPages`.
   * Each page is a separate metered call.
   */
  searchAll(params: SearchParams = {}, options?: SearchAllOptions): SearchAllResult {
    const body = buildSearchBody(params);
    const opts = checkOptions(options, ['signal', 'maxPages'], 'searchAll');
    let maxPages = this.http.config.maxPages;
    if (opts.maxPages !== undefined) {
      const v = opts.maxPages;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
        throw new FinlightValidationError('maxPages must be an integer of at least 1', 'maxPages');
      }
      maxPages = v;
    }
    return new SearchAllIterator(
      this.http,
      JSON.stringify(body),
      maxPages,
      opts.signal as AbortSignal | undefined,
    );
  }

  /** `GET /v3/articles/{id}`. A 404 is a `FinlightApiError`, not an empty result. */
  async get(id: string, options?: LookupOptions): Promise<Article> {
    checkNonEmptyString(id, 'id');
    const opts = checkOptions(options, ['signal', 'include'], 'get');
    const include = checkInclude(opts.include);
    const res = await this.http.request({
      method: 'GET',
      path: `/v3/articles/${encodeURIComponent(id)}`,
      query: include.length ? [['include', include.join(',')]] : [],
      signal: opts.signal as AbortSignal | undefined,
    });
    return decodeArticle(envelopeField(res.body, 'article'));
  }

  /** `GET /v3/articles/by-link`. Also finds articles from before the id rollout. Needs the custom-source grant and the plan date window; otherwise 404. */
  async getByLink(link: string, options?: LookupOptions): Promise<Article> {
    checkNonEmptyString(link, 'link');
    const opts = checkOptions(options, ['signal', 'include'], 'getByLink');
    const include = checkInclude(opts.include);
    const query: Array<[string, string]> = [['link', link]];
    if (include.length) query.push(['include', include.join(',')]);
    const res = await this.http.request({
      method: 'GET',
      path: '/v3/articles/by-link',
      query,
      signal: opts.signal as AbortSignal | undefined,
    });
    return decodeArticle(envelopeField(res.body, 'article'));
  }
}
