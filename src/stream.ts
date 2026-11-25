import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { ResolvedConfig } from './config';
import { decodeArticleStrict } from './decode';
import {
  FinlightApiError,
  FinlightDecodeError,
  FinlightError,
  FinlightNetworkError,
  FinlightValidationError,
  PreemptedError,
  createApiError,
  type FieldIssue,
} from './errors';
import { decodeFrame, type DecodedFrame } from './frames';
import { canonicalJson, isObject } from './internal/json';
import { attachRaw } from './internal/raw';
import type { StreamEvent } from './models';
import { parseRfc3339 } from './time';

/** Signal after `connection.admitted`. It arrives before the subscribe is validated. */
export interface AdmittedInfo {
  leaseId: string | null;
  serverNow: number | null;
  clientNonce: string | null;
}

export type ReconnectReason =
  | 'rotation'
  | 'watchdog'
  | 'closed'
  | 'handshake_failed'
  | 'search_failed'
  | 'dial_failed'
  | 'dial_refused'
  | 'connection_limit'
  | 'rate_limited'
  | 'quota_exceeded';

/** Signal after every new connection except the first one. */
export interface ReconnectInfo {
  /**
   * Last timestamp seen on this stream: enriched `availableAt` (falling back to `firstSeenAt`),
   * raw `firstSeenAt`; `null` when nothing arrived yet. Use it to fill gaps via REST.
   */
  lastSeenAt: string | null;
  reason: ReconnectReason;
  /** Connections opened by this stream so far, the new one included. */
  connection: number;
}

export interface StreamOptions {
  /** Stops the stream; the iteration then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Send `x-takeover: true`: replace the stalest of your connections when at the limit. Default off. */
  takeover?: boolean;
  /** Called for every `connection.admitted` frame. */
  onAdmitted?: (info: AdmittedInfo) => void;
  /** Called after every new connection (reconnect or rotation). The SDK does not backfill. */
  onReconnect?: (info: ReconnectInfo) => void;
  /** Called for problems that do not end the stream (log-only errors, repeated failures). */
  onError?: (error: FinlightError) => void;
  /**
   * Called each time the stream waits for the WebSocket quota (see `quotaReconnect`):
   * after a `quota_exceeded` preemption and after every dial refused for the quota.
   */
  onQuotaWait?: (info: QuotaWaitInfo) => void;
}

/** A wait for the WebSocket quota of the current period to allow connections again. */
export interface QuotaWaitInfo {
  /** The refusal or preemption that caused the wait. */
  error: FinlightError;
  /** Time until the next attempt. */
  nextAttemptInMs: number;
  /** Consecutive quota waits, starting at 1. */
  attempt: number;
}

/**
 * A live stream. Iterate it once with `for await`; leaving the loop, `close()` or the
 * abort signal closes the socket with 1000 and stops every timer.
 * Terminal problems (refused key, plan without WebSockets, validation, a `connection_limit`
 * preemption) end the iteration with a typed error. An exhausted quota waits and retries
 * hourly unless `quotaReconnect` is `false`.
 */
export interface FinlightStream extends AsyncIterable<StreamEvent> {
  close(): Promise<void>;
  readonly lastSeenAt: string | null;
  readonly closed: boolean;
}

/** Internal hooks for tests; not part of the public API. */
export interface StreamTestHooks {
  nonce?: () => string;
  onFrame?: (frame: DecodedFrame) => void;
  onPong?: () => void;
  onPingSent?: () => void;
  onDuplicate?: (id: string) => void;
  onReconnectScheduled?: (info: { delayMs: number; reason: ReconnectReason }) => void;
  onConnectionClosed?: (info: { code: number; connection: number }) => void;
}

const TEST_HOOKS = new WeakMap<object, StreamTestHooks>();

export function setStreamTestHooks(stream: FinlightStream, hooks: StreamTestHooks): void {
  TEST_HOOKS.set(stream, hooks);
}

type DelayKind = 'now' | 'backoff' | 'long' | 'quota';
type Planned =
  | { kind: 'terminal'; error: unknown }
  | { kind: 'reconnect'; reason: ReconnectReason; delay: DelayKind };

interface Conn {
  id: number;
  ws: WebSocket;
  opened: boolean;
  timers: { ping: unknown; watchdog: unknown; rotation: unknown };
  refusal: { status: number; message: string | null; body: string | null } | null;
  planned: Planned | null;
  closed: Promise<void>;
}

const NO_WEBSOCKETS_PREFIX = 'Your subscription does not include WebSockets';
const QUOTA_PREFIX = 'WebSocket quota exceeded';
const TOO_MANY_PREFIX = 'Too many concurrent connections';
/** How long a failed renewal waits for the old connection's close reply before dialing again. */
const ROTATION_CLOSE_WAIT_MS = 5_000;

function refusalMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (isObject(parsed)) {
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.error === 'string') return parsed.error;
    }
  } catch {
    // not JSON
  }
  return null;
}

function dialError(
  status: number,
  message: string | null,
  body: string | null,
  detail?: string,
): FinlightApiError {
  let json: unknown;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  // A refused dial has no problem code: the kind comes from the status.
  return createApiError({
    status,
    code: null,
    type: null,
    title: 'WebSocket connection refused',
    detail: detail ?? message,
    requestId: null,
    errors: [],
    raw: body || null,
    ...(json !== undefined ? { json } : {}),
    limitType: status === 429 ? 'unknown' : null,
    retryAfterMs: null,
    message: `WebSocket connection refused with HTTP ${status}${message ? `: ${message}` : ''}`,
  });
}

function streamError(code: string | null, message: string | null, details: unknown): FinlightApiError {
  const errors: FieldIssue[] = [];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (!isObject(d)) continue;
      const constraints: Record<string, string> = {};
      if (isObject(d.constraints)) {
        for (const [k, v] of Object.entries(d.constraints)) if (typeof v === 'string') constraints[k] = v;
      }
      const issue: FieldIssue = {
        field: typeof d.field === 'string' ? d.field : null,
        issue: Object.values(constraints).join('; ') || null,
        constraints,
      };
      if (Array.isArray(d.allowedValues)) {
        issue.allowedValues = d.allowedValues.filter((v): v is string => typeof v === 'string');
      }
      errors.push(issue);
    }
  }
  const data = { code, message, details };
  return createApiError({
    status: 0,
    code,
    type: null,
    title: 'Stream error',
    detail: message,
    requestId: null,
    errors,
    raw: JSON.stringify(data),
    json: data,
    ...(code === null ? { apiKind: 'other' as const } : {}),
    message: `stream error ${code ?? '(no code)'}: ${message ?? ''}`.trim(),
  });
}

export interface StreamDeps {
  apiKey: string;
  config: ResolvedConfig;
}

export class StreamSession implements FinlightStream {
  readonly #apiKey: string;
  readonly #cfg: ResolvedConfig;
  readonly #raw: boolean;
  readonly #subscribe: Record<string, unknown>;
  readonly #options: StreamOptions;

  #iterated = false;
  #ended = false;
  #terminal: { error: unknown } | null = null;
  #terminalDelivered = false;
  #queue: StreamEvent[] = [];
  #waiter: { resolve: (r: IteratorResult<StreamEvent>) => void; reject: (e: unknown) => void } | null = null;
  #conns = new Set<Conn>();
  #current: Conn | null = null;
  #rotatingFrom: Conn | null = null;
  #redialAfterClose: { conn: Conn; timer: unknown } | null = null;
  #reconnectTimer: unknown = null;
  #failures = 0;
  #quotaWaits = 0;
  #pendingQuotaError: FinlightError | null = null;
  #searchFailed = 0;
  #connections = 0;
  #dedupe = new Map<string, true>();
  #lastSeenAt: string | null = null;
  #lastSeenMs = -Infinity;
  #abortListener: (() => void) | null = null;

  constructor(deps: StreamDeps, raw: boolean, subscribe: Record<string, unknown>, options: StreamOptions) {
    this.#apiKey = deps.apiKey;
    this.#cfg = deps.config;
    this.#raw = raw;
    this.#subscribe = subscribe;
    this.#options = options;
  }

  get lastSeenAt(): string | null {
    return this.#lastSeenAt;
  }

  get closed(): boolean {
    return this.#ended;
  }

  private get hooks(): StreamTestHooks {
    return TEST_HOOKS.get(this) ?? {};
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    if (this.#iterated) {
      throw new FinlightValidationError(
        'a stream can be iterated only once; call stream() again for a new one',
      );
    }
    this.#iterated = true;
    this.start();
    return {
      next: () => this.next(),
      return: async () => {
        await this.close();
        return { done: true, value: undefined };
      },
    };
  }

  /** Stops the stream: closes sockets with 1000 and clears every timer. */
  async close(): Promise<void> {
    const pending = [...this.#conns].map((c) => c.closed);
    this.finish(null);
    await Promise.all([...pending, ...[...this.#conns].map((c) => c.closed)]);
  }

  private start(): void {
    const signal = this.#options.signal;
    if (signal?.aborted) {
      this.finish({ error: signal.reason });
      return;
    }
    if (signal) {
      this.#abortListener = () => this.finish({ error: signal.reason });
      signal.addEventListener('abort', this.#abortListener, { once: true });
    }
    this.connect('closed', true);
  }

  private next(): Promise<IteratorResult<StreamEvent>> {
    const item = this.#queue.shift();
    if (item) return Promise.resolve({ value: item, done: false });
    if (this.#terminal && !this.#terminalDelivered) {
      this.#terminalDelivered = true;
      return Promise.reject(this.#terminal.error);
    }
    if (this.#ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  private push(item: StreamEvent): void {
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = null;
      waiter.resolve({ value: item, done: false });
    } else {
      this.#queue.push(item);
    }
  }

  /** Ends the stream. `terminal` carries the error the iteration ends with. */
  private finish(terminal: { error: unknown } | null): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#terminal = terminal;
    if (this.#abortListener && this.#options.signal) {
      this.#options.signal.removeEventListener('abort', this.#abortListener);
    }
    if (this.#reconnectTimer !== null) {
      this.#cfg.clock.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#redialAfterClose) {
      this.#cfg.clock.clearTimeout(this.#redialAfterClose.timer);
      this.#redialAfterClose = null;
    }
    for (const conn of this.#conns) this.shutdown(conn, true);
    this.#current = null;
    this.#rotatingFrom = null;
    this.#dedupe.clear();
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = null;
      if (terminal) {
        this.#terminalDelivered = true;
        waiter.reject(terminal.error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  private callUser<T>(name: string, fn: ((arg: T) => void) | undefined, arg: T): void {
    if (!fn) return;
    try {
      fn(arg);
    } catch (err) {
      this.#cfg.log.error(`the ${name} hook threw; the stream continues`, err);
    }
  }

  private report(error: FinlightError): void {
    this.#cfg.log.warn(error.message);
    this.callUser('onError', this.#options.onError, error);
  }

  private connect(reason: ReconnectReason, first = false): void {
    if (this.#ended) return;
    this.#reconnectTimer = null;
    this.#connections += 1;
    const id = this.#connections;
    const cfg = this.#cfg;
    const url = this.#raw ? `${cfg.wssUrl}/raw` : cfg.wssUrl;
    // Header names are written exactly like this: the gateway looks up x-api-key case-sensitively.
    const headers: Record<string, string> = {
      'x-api-key': this.#apiKey,
      'x-client-version': cfg.clientVersion,
      'User-Agent': cfg.userAgent,
    };
    if (this.#options.takeover) headers['x-takeover'] = 'true';
    const wsOptions: WebSocket.ClientOptions = {
      headers,
      maxPayload: cfg.maxMessageBytes,
      handshakeTimeout: cfg.connectTimeoutMs,
      perMessageDeflate: false,
      followRedirects: false,
    };
    if (cfg.wsAgent) wsOptions.agent = cfg.wsAgent;

    let resolveClosed!: () => void;
    const closed = new Promise<void>((r) => (resolveClosed = r));
    const ws = new WebSocket(url, wsOptions);
    const conn: Conn = {
      id,
      ws,
      opened: false,
      timers: { ping: null, watchdog: null, rotation: null },
      refusal: null,
      planned: null,
      closed,
    };
    this.#conns.add(conn);
    if (this.#current && this.#current !== conn) this.#rotatingFrom = this.#current;
    this.#current = conn;

    ws.on('unexpected-response', (req: ClientRequest, res: IncomingMessage) =>
      this.onRefusal(conn, req, res),
    );
    ws.on('open', () => this.onOpen(conn, reason, first));
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(conn, data));
    ws.on('error', (err: Error) => {
      cfg.log.debug(`stream connection ${id} error: ${err.message}`);
    });
    ws.on('close', (code: number) => {
      this.onClose(conn, code);
      resolveClosed();
    });
  }

  private onRefusal(conn: Conn, _req: ClientRequest, res: IncomingMessage): void {
    conn.refusal = { status: res.statusCode ?? 0, message: null, body: null };
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finishRead = (): void => {
      if (done) return;
      done = true;
      if (conn.refusal) {
        conn.refusal.body = Buffer.concat(chunks).toString('utf8');
        conn.refusal.message = refusalMessage(conn.refusal.body);
      }
      conn.ws.terminate();
    };
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 64 * 1024) chunks.push(chunk);
    });
    res.once('end', finishRead);
    res.once('error', finishRead);
    res.once('close', finishRead);
  }

  private onOpen(conn: Conn, reason: ReconnectReason, first: boolean): void {
    if (this.#ended) {
      this.shutdown(conn, true);
      return;
    }
    conn.opened = true;
    const nonce = this.hooks.nonce ? this.hooks.nonce() : `c-${randomUUID()}`;
    // The frame is the validated, fixed-key subscribe plus the SDK's clientNonce.
    conn.ws.send(JSON.stringify({ ...this.#subscribe, clientNonce: nonce }));
    this.schedulePing(conn);
    this.armWatchdog(conn);
    conn.timers.rotation = this.#cfg.clock.setTimeout(() => this.rotate(conn), this.#cfg.rotationIntervalMs);
    if (!first) {
      this.callUser('onReconnect', this.#options.onReconnect, {
        lastSeenAt: this.#lastSeenAt,
        reason,
        connection: conn.id,
      });
    }
  }

  private schedulePing(conn: Conn): void {
    conn.timers.ping = this.#cfg.clock.setTimeout(() => {
      if (conn.ws.readyState !== WebSocket.OPEN) return;
      conn.ws.send(JSON.stringify({ action: 'ping', t: this.#cfg.clock.now() }));
      this.hooks.onPingSent?.();
      this.schedulePing(conn);
    }, this.#cfg.pingIntervalMs);
  }

  private armWatchdog(conn: Conn, byPong = false): void {
    if (conn.timers.watchdog !== null) this.#cfg.clock.clearTimeout(conn.timers.watchdog);
    if (byPong) this.hooks.onPong?.();
    conn.timers.watchdog = this.#cfg.clock.setTimeout(() => {
      conn.timers.watchdog = null;
      this.#cfg.log.warn(`no pong for ${this.#cfg.watchdogTimeoutMs} ms; reconnecting`);
      this.drop(conn, { kind: 'reconnect', reason: 'watchdog', delay: 'now' }, false);
    }, this.#cfg.watchdogTimeoutMs);
  }

  private clearTimers(conn: Conn): void {
    const clock = this.#cfg.clock;
    for (const key of ['ping', 'watchdog', 'rotation'] as const) {
      if (conn.timers[key] !== null) clock.clearTimeout(conn.timers[key]);
      conn.timers[key] = null;
    }
  }

  private shutdown(conn: Conn, graceful: boolean): void {
    this.clearTimers(conn);
    const ws = conn.ws;
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) {
      if (graceful) ws.close(1000);
      else ws.terminate();
    }
  }

  /** Closes a connection with a decided follow-up action. */
  private drop(conn: Conn, planned: Planned, graceful: boolean): void {
    if (!conn.planned) conn.planned = planned;
    this.shutdown(conn, graceful);
  }

  private rotate(conn: Conn): void {
    if (this.#ended || conn !== this.#current) return;
    this.#cfg.log.info('rotating the stream connection before the 2 h gateway limit');
    this.hooks.onReconnectScheduled?.({ delayMs: 0, reason: 'rotation' });
    this.connect('rotation');
  }

  private onMessage(conn: Conn, data: WebSocket.RawData): void {
    if (this.#ended) return;
    const text = Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data).toString('utf8');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.#cfg.log.warn('ignored a stream frame that is not JSON');
      return;
    }
    const frame = decodeFrame(json);
    this.handleFrame(conn, frame, json);
    this.hooks.onFrame?.(frame);
  }

  private handleFrame(conn: Conn, frame: DecodedFrame, json: unknown): void {
    switch (frame.type) {
      case 'pong':
        // The connection works: the reconnect backoff starts over.
        this.#failures = 0;
        this.armWatchdog(conn, true);
        return;
      case 'admitted': {
        // Admitted comes before the subscribe is checked, so it does not reset the
        // reconnect backoff (admitted then SEARCH_FAILED must back off); a pong or an article does.
        this.#quotaWaits = 0;
        if (conn === this.#current && this.#rotatingFrom) {
          const old = this.#rotatingFrom;
          this.#rotatingFrom = null;
          this.drop(old, { kind: 'reconnect', reason: 'rotation', delay: 'now' }, true);
        }
        this.callUser('onAdmitted', this.#options.onAdmitted, {
          leaseId: frame.leaseId,
          serverNow: frame.serverNow,
          clientNonce: frame.clientNonce,
        });
        return;
      }
      case 'preempted': {
        const error = new PreemptedError(frame.reason, frame.newLeaseId, frame.timestamp);
        if (frame.reason === 'quota_exceeded') {
          const planned = this.quotaPlan(error);
          if (planned.kind === 'reconnect') {
            this.drop(conn, planned, true);
            return;
          }
        }
        this.finish({ error });
        return;
      }
      case 'error':
        this.handleError(conn, frame);
        return;
      case 'article':
        this.handleArticle(frame, json);
        return;
      case 'other': {
        const item: StreamEvent = Object.freeze({
          kind: 'other' as const,
          event: frame.event,
          data: null,
        });
        this.push(attachRaw(item, json));
        return;
      }
      case 'ignored':
        this.#cfg.log.debug(`ignored a stream frame: ${frame.reason}`);
        return;
    }
  }

  private handleError(conn: Conn, frame: Extract<DecodedFrame, { type: 'error' }>): void {
    const error = streamError(frame.code, frame.message, frame.details);
    switch (frame.code) {
      case 'VALIDATION_FAILED':
        this.finish({ error });
        return;
      case 'HANDSHAKE_FAILED':
        this.#cfg.log.warn('stream handshake failed; reconnecting');
        this.drop(conn, { kind: 'reconnect', reason: 'handshake_failed', delay: 'backoff' }, true);
        return;
      case 'SEARCH_FAILED':
        this.#searchFailed += 1;
        if (this.#searchFailed >= this.#cfg.searchFailedThreshold) {
          this.#searchFailed = 0;
          this.report(error);
        } else {
          this.#cfg.log.warn('the initial stream search failed; reconnecting');
        }
        this.drop(conn, { kind: 'reconnect', reason: 'search_failed', delay: 'backoff' }, true);
        return;
      default:
        // PING_ON_DEFAULT_ROUTE, INTERNAL_ERROR, unknown codes and v2-form errors: report only.
        this.report(error);
    }
  }

  private handleArticle(frame: Extract<DecodedFrame, { type: 'article' }>, json: unknown): void {
    this.#failures = 0;
    this.#searchFailed = 0;
    let article;
    try {
      article = decodeArticleStrict(frame.data, 'data');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.report(
        new FinlightDecodeError(`skipped a stream article that could not be decoded: ${reason}`, null, json),
      );
      return;
    }
    const key = `${frame.event}\n${article.id}\n${createHash('sha256').update(canonicalJson(frame.data)).digest('hex')}`;
    if (this.#dedupe.has(key)) {
      this.#dedupe.delete(key);
      this.#dedupe.set(key, true);
      this.#cfg.log.debug(`dropped a duplicate ${frame.event} for ${article.id}`);
      this.hooks.onDuplicate?.(article.id);
      return;
    }
    this.#dedupe.set(key, true);
    while (this.#dedupe.size > this.#cfg.dedupeCacheSize) {
      this.#dedupe.delete(this.#dedupe.keys().next().value as string);
    }
    const seen = this.#raw ? article.firstSeenAt : (article.availableAt ?? article.firstSeenAt);
    if (seen !== null) {
      const ms = parseRfc3339(seen);
      if (ms !== null && ms >= this.#lastSeenMs) {
        this.#lastSeenMs = ms;
        this.#lastSeenAt = seen;
      }
    }
    const item: StreamEvent = Object.freeze({
      kind: frame.kind,
      event: frame.event,
      data: article,
    });
    this.push(attachRaw(item, json));
  }

  private onClose(conn: Conn, code: number): void {
    this.clearTimers(conn);
    this.#conns.delete(conn);
    this.hooks.onConnectionClosed?.({ code, connection: conn.id });
    if (this.#ended) return;
    if (conn === this.#redialAfterClose?.conn) {
      this.redialAfterRotation();
      return;
    }
    if (conn === this.#rotatingFrom) {
      this.#rotatingFrom = null;
      return;
    }
    if (conn !== this.#current) return;
    this.#current = null;

    const old = this.#rotatingFrom;
    // A failed renewal dial is expected at a connection limit of 1: it is not reported.
    const planned = conn.planned ?? this.classifyClose(conn, code, old !== null);
    if (old) {
      this.#rotatingFrom = null;
      if (planned.kind === 'reconnect') {
        // The renewal dial was refused or failed, often because the old connection still counts
        // against the plan's limit. Break before make: close the old connection, wait for its
        // close reply (at most 5 s), then dial again at once. Only a second refusal waits.
        this.#pendingQuotaError = null;
        this.#redialAfterClose = {
          conn: old,
          timer: this.#cfg.clock.setTimeout(() => {
            old.ws.terminate();
            this.redialAfterRotation();
          }, ROTATION_CLOSE_WAIT_MS),
        };
        this.shutdown(old, true);
        return;
      }
      this.shutdown(old, true);
    }
    if (planned.kind === 'terminal') {
      this.finish({ error: planned.error });
      return;
    }
    this.scheduleReconnect(planned.reason, planned.delay);
  }

  private redialAfterRotation(): void {
    if (!this.#redialAfterClose) return;
    this.#cfg.clock.clearTimeout(this.#redialAfterClose.timer);
    this.#redialAfterClose = null;
    this.scheduleReconnect('rotation', 'now');
  }

  private classifyClose(conn: Conn, code: number, quiet = false): Planned {
    const report = (error: FinlightError): void => {
      if (quiet)
        this.#cfg.log.info(`the renewal dial failed (${error.message}); closing the old connection first`);
      else this.report(error);
    };
    const refusal = conn.refusal;
    if (refusal) {
      const { status, message, body } = refusal;
      const text = message ?? '';
      if (status === 401) return { kind: 'terminal', error: dialError(status, message, body) };
      if (status === 403) {
        if (text.startsWith(NO_WEBSOCKETS_PREFIX)) {
          return { kind: 'terminal', error: dialError(status, message, body) };
        }
        if (text.startsWith(QUOTA_PREFIX)) return this.quotaPlan(dialError(status, message, body));
        if (text.startsWith(TOO_MANY_PREFIX)) {
          report(
            dialError(
              status,
              message,
              body,
              `${text} Your connection limit is shared by enriched, raw and older SDK streams; ` +
                'the SDK retries after a long wait. Pass { takeover: true } to replace your stalest connection.',
            ),
          );
          return { kind: 'reconnect', reason: 'connection_limit', delay: 'long' };
        }
        report(dialError(status, message, body));
        return { kind: 'reconnect', reason: 'dial_refused', delay: 'long' };
      }
      if (status === 429) {
        report(dialError(status, message, body));
        return { kind: 'reconnect', reason: 'rate_limited', delay: 'long' };
      }
      if (status >= 500) return { kind: 'reconnect', reason: 'dial_refused', delay: 'backoff' };
      report(dialError(status, message, body));
      return { kind: 'reconnect', reason: 'dial_refused', delay: 'backoff' };
    }
    if (code === 1008) {
      return {
        kind: 'terminal',
        error: createApiError({
          status: 1008,
          code: null,
          type: null,
          title: 'Policy violation',
          detail: 'the server closed the stream with code 1008',
          requestId: null,
          errors: [],
          raw: null,
          apiKind: 'other',
        }),
      };
    }
    if (!conn.opened) {
      report(new FinlightNetworkError('could not connect to the stream endpoint'));
      return { kind: 'reconnect', reason: 'dial_failed', delay: 'backoff' };
    }
    return { kind: 'reconnect', reason: 'closed', delay: 'backoff' };
  }

  /** Exhausted quota: wait and retry hourly (default), or end the stream when switched off. */
  private quotaPlan(error: FinlightError): Planned {
    if (!this.#cfg.quotaReconnect) return { kind: 'terminal', error };
    this.#pendingQuotaError = error;
    return { kind: 'reconnect', reason: 'quota_exceeded', delay: 'quota' };
  }

  private backoff(): number {
    const { reconnectBaseDelayMs, reconnectMaxDelayMs } = this.#cfg;
    const capped = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** Math.min(this.#failures, 16));
    return Math.round(capped * (0.5 + Math.random() * 0.5));
  }

  private scheduleReconnect(reason: ReconnectReason, kind: DelayKind): void {
    let delayMs = 0;
    if (kind === 'backoff') delayMs = this.backoff();
    if (kind === 'long')
      delayMs = this.#cfg.longBackoffMs + Math.round(Math.random() * 0.2 * this.#cfg.longBackoffMs);
    if (kind === 'quota') {
      delayMs = this.#cfg.quotaReconnectIntervalMs;
      this.#quotaWaits += 1;
      const error = this.#pendingQuotaError ?? dialError(403, QUOTA_PREFIX, null);
      this.#pendingQuotaError = null;
      this.#cfg.log.warn(
        `WebSocket quota exhausted (${error.message}); attempt ${this.#quotaWaits}, next try in ${delayMs} ms`,
      );
      this.callUser('onQuotaWait', this.#options.onQuotaWait, {
        error,
        nextAttemptInMs: delayMs,
        attempt: this.#quotaWaits,
      });
    }
    this.#failures += 1;
    this.#cfg.log.debug(`stream reconnect (${reason}) in ${delayMs} ms`);
    this.hooks.onReconnectScheduled?.({ delayMs, reason });
    if (delayMs === 0) {
      this.connect(reason);
      return;
    }
    this.#reconnectTimer = this.#cfg.clock.setTimeout(() => this.connect(reason), delayMs);
  }
}
