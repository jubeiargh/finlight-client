import { inspect } from 'node:util';
import { ArticlesService } from './articles';
import { CompaniesService } from './companies';
import { resolveConfig, type FinlightClientConfig, type ResolvedConfig } from './config';
import { HttpTransport } from './http';
import { FinlightValidationError } from './errors';
import { buildSubscribe, checkOptions, type RawStreamParams, type StreamParams } from './params';
import { SourcesService } from './sources';
import { StreamSession, type FinlightStream, type StreamOptions } from './stream';

const STREAM_OPTION_KEYS = ['signal', 'takeover', 'onAdmitted', 'onReconnect', 'onError'];

function checkStreamOptions(options: unknown): StreamOptions {
  const opts = checkOptions(options, STREAM_OPTION_KEYS, 'stream');
  for (const hook of ['onAdmitted', 'onReconnect', 'onError']) {
    if (opts[hook] !== undefined && typeof opts[hook] !== 'function') {
      throw new FinlightValidationError(`${hook} must be a function`);
    }
  }
  if (opts.takeover !== undefined && typeof opts.takeover !== 'boolean') {
    throw new FinlightValidationError('takeover must be a boolean');
  }
  return opts as StreamOptions;
}

/**
 * Client for finlight API v3: REST, WebSocket streams and (statically) webhooks.
 * Safe to share; it may run several streams at the same time.
 */
export class FinlightClient {
  readonly articles: ArticlesService;
  readonly companies: CompaniesService;
  readonly sources: SourcesService;
  readonly #apiKey: string;
  readonly #config: ResolvedConfig;

  constructor(config: FinlightClientConfig) {
    const { apiKey, config: resolved } = resolveConfig(config);
    this.#apiKey = apiKey;
    this.#config = resolved;
    const http = new HttpTransport(apiKey, resolved);
    this.articles = new ArticlesService(http);
    this.companies = new CompaniesService(http);
    this.sources = new SourcesService(http);
  }

  /**
   * Enriched live stream (`wss://wss.finlight.me`). Connects lazily on the first iteration.
   * Parameters are checked at once; unknown keys throw before any connection.
   */
  stream(params: StreamParams = {}, options?: StreamOptions): FinlightStream {
    const subscribe = buildSubscribe(params, false);
    const opts = checkStreamOptions(options);
    return new StreamSession({ apiKey: this.#apiKey, config: this.#config }, false, subscribe, opts);
  }

  /** Raw live stream (`<wssUrl>/raw`): the article skeleton, before enrichment. No `include`. */
  rawStream(params: RawStreamParams = {}, options?: StreamOptions): FinlightStream {
    const subscribe = buildSubscribe(params, true);
    const opts = checkStreamOptions(options);
    return new StreamSession({ apiKey: this.#apiKey, config: this.#config }, true, subscribe, opts);
  }

  /** Never prints the API key. */
  [inspect.custom](): string {
    return `FinlightClient { baseUrl: '${this.#config.baseUrl}', wssUrl: '${this.#config.wssUrl}' }`;
  }

  toJSON(): Record<string, string> {
    return { baseUrl: this.#config.baseUrl, wssUrl: this.#config.wssUrl };
  }
}
