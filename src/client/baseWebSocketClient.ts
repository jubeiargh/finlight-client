import WebSocket from 'ws';
import { ApiClientConfig } from '../types';
import { Logger, createLogger } from '../logger';
import { CLIENT_VERSION } from '../version';

export interface BaseWebSocketClientOptions {
  pingInterval?: number; // 25 seconds (matches HEARTBEAT_MS)
  pongTimeout?: number;
  baseReconnectDelay?: number; // Start with 500ms
  maxReconnectDelay?: number; // Cap at 10 seconds
  connectionLifetime?: number; // 115 minutes (2h - 5m)
  onClose?: (code: number, reason: string) => void;
  takeover?: boolean; // Whether to takeover existing connections
}

export abstract class BaseWebSocketClient<TArticle, TRequestPayload> {
  private webSocket?: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private pongWatchdog?: NodeJS.Timeout;
  private rotationTimeout?: NodeJS.Timeout;
  private _stop = false;
  protected readonly log: Logger;

  // Configuration
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly connectionLifetimeMs: number;
  private readonly onClose?: (code: number, reason: string) => void;
  private readonly takeover: boolean;

  // State tracking
  private currentReconnectDelayMs: number;
  private lastPongTime = 0;
  private connectionStartTime = 0;
  private reconnectAt = 0; // Timestamp when we can reconnect (for rate limits/blocks)
  private leaseId?: string; // Store lease ID from admission
  private clientNonce?: string; // For idempotent handshake

  // Duplicate detection (optional, can be overridden by subclasses)
  protected recentArticleLinks = new Set<string>();
  protected readonly RECENT_ARTICLE_CACHE_SIZE = 10;

  constructor(
    protected readonly config: ApiClientConfig,
    options: BaseWebSocketClientOptions = {},
  ) {
    this.log = createLogger(config.logger ?? console, config.logLevel ?? 'info');
    this.pingIntervalMs = (options.pingInterval ?? 25) * 1000;
    this.pongTimeoutMs = (options.pongTimeout ?? 60) * 1000;
    this.baseReconnectDelayMs = (options.baseReconnectDelay ?? 0.5) * 1000;
    this.maxReconnectDelayMs = (options.maxReconnectDelay ?? 10.0) * 1000;
    this.connectionLifetimeMs = (options.connectionLifetime ?? 115 * 60) * 1000;
    this.onClose = options.onClose;
    this.takeover = options.takeover ?? false;
    this.currentReconnectDelayMs = this.baseReconnectDelayMs;

    process.on('SIGINT', () => {
      this.log.info?.('Caught interrupt signal. Shutting down gracefully...');
      this.stop();
      process.exit();
    });
  }

  protected abstract getWebSocketUrl(): string;
  protected abstract getLogPrefix(): string;
  protected abstract transformMessage(data: any): TArticle;

  // Optional: Get unique identifier for duplicate detection (override to enable)
  protected getArticleIdentifier(_article: TArticle): string | null {
    return null; // Default: no duplicate detection
  }

  // Check if article is duplicate
  protected isDuplicate(identifier: string): boolean {
    return this.recentArticleLinks.has(identifier);
  }

  // Track article to prevent duplicates
  protected trackArticle(identifier: string): void {
    this.recentArticleLinks.add(identifier);

    // Maintain cache size by removing oldest entry when limit is reached
    if (this.recentArticleLinks.size > this.RECENT_ARTICLE_CACHE_SIZE) {
      const firstLink = this.recentArticleLinks.values().next().value;
      if (firstLink) {
        this.recentArticleLinks.delete(firstLink);
      }
    }
  }

  public async connect(requestPayload: TRequestPayload, onMessage: (article: TArticle) => void): Promise<void> {
    while (!this._stop) {
      try {
        this.log.info?.(`🔄 ${this.getLogPrefix()}Attempting to connect...`);

        // Prepare headers
        const headers: Record<string, string> = { 'x-api-key': this.config.apiKey, 'x-client-version': CLIENT_VERSION };
        if (this.takeover) {
          headers['x-takeover'] = 'true';
          this.log.info?.(`🔄 ${this.getLogPrefix()}Connecting with takeover=true`);
        }

        this.webSocket = new WebSocket(this.getWebSocketUrl(), { headers });

        await new Promise<void>((resolve, reject) => {
          if (!this.webSocket) return reject(new Error('WebSocket not initialized'));

          this.webSocket.on('open', () => {
            this.log.info?.(`✅ ${this.getLogPrefix()}Connected.`);

            // Reset backoff on successful connection
            this.resetBackoff();
            this.reconnectAt = 0; // Clear any reconnectAt restriction

            this.lastPongTime = Date.now();
            this.connectionStartTime = Date.now(); // Track connection start

            this.startPingInterval();
            this.startPongWatchdog();
            this.startProactiveRotation();

            // Prepare first message with handshake fields
            this.clientNonce = this.generateUuid();

            // Create message with handshake fields
            const messageData = { ...requestPayload, clientNonce: this.clientNonce };

            // Send article search request to $default route
            this.webSocket?.send(JSON.stringify(messageData));
          });

          this.webSocket.on('message', (data) => {
            this.handleMessage(data.toString(), onMessage);
          });

          this.webSocket.on('close', (code, reason) => {
            this.handleClose(code, reason.toString());
            resolve();
          });

          this.webSocket.on('error', (error) => {
            this.log.error?.(`❌ ${this.getLogPrefix()}Connection error:`, error);
            reject(error);
          });
        });
      } catch (error) {
        this.log.error?.(`❌ ${this.getLogPrefix()}Connection error:`, error);

        // Check if this is a 429 rate limit error
        if (error instanceof Error && error.message.includes('429')) {
          const retryAfterSeconds = 60;
          this.reconnectAt = Date.now() + retryAfterSeconds * 1000;
          this.log.warn?.(`⏰ ${this.getLogPrefix()}Server rejected connection (429) - waiting ${retryAfterSeconds}s before retry`);
        }

        if (!this._stop) {
          await this.handleReconnect();
        }
      }
    }
  }

  private handleMessage(message: string, onArticle: (article: TArticle) => void): void {
    try {
      const msg = JSON.parse(message);
      const msgAction = msg.action;

      if (msgAction === 'pong') {
        const pingTime = msg.t;
        if (pingTime) {
          const rtt = Date.now() - pingTime;
          this.log.debug?.(`← ${this.getLogPrefix()}PONG received (RTT: ${rtt}ms)`);
        } else {
          this.log.debug?.(`← ${this.getLogPrefix()}PONG received`);
        }
        this.lastPongTime = Date.now();
      } else if (msgAction === 'admit') {
        this.leaseId = msg.leaseId;
        const serverNow = msg.serverNow;
        const clientNonce = msg.clientNonce;
        this.log.info?.(`✅ ${this.getLogPrefix()}Admitted (leaseId: ${this.leaseId}, serverNow: ${serverNow})`);
        if (clientNonce && clientNonce !== this.clientNonce) {
          this.log.warn?.(`⚠️ ${this.getLogPrefix()}Nonce mismatch: expected ${this.clientNonce}, got ${clientNonce}`);
        }
      } else if (msgAction === 'preempted') {
        const reason = msg.reason || 'unknown';
        const newLeaseId = msg.newLeaseId || '';
        this.log.warn?.(`🔄 ${this.getLogPrefix()}Connection preempted: ${reason} (new lease: ${newLeaseId})`);
        this._stop = true;
        this.webSocket?.close(1000, 'Preempted by server');
      } else if (msgAction === 'sendArticle') {
        const data = msg.data || {};
        const transformedArticle = this.transformMessage(data);

        // Check for duplicates if identifier is provided
        const identifier = this.getArticleIdentifier(transformedArticle);
        if (identifier) {
          if (this.isDuplicate(identifier)) {
            this.log.debug?.(`⏭️ ${this.getLogPrefix()}Skipping duplicate article: ${identifier}`);
            return;
          }
          this.trackArticle(identifier);
        }

        onArticle(transformedArticle);
      } else if (msgAction === 'admin_kick') {
        const retryAfter = msg.retryAfter || 900000; // 15 minutes default
        const retryAfterSeconds = retryAfter / 1000;
        this.reconnectAt = Date.now() + retryAfter;
        this.log.warn?.(`🚫 ${this.getLogPrefix()}Admin kicked - retry after ${retryAfterSeconds}s`);
        this.webSocket?.close(4003, `Admin kick - retry after ${retryAfter}ms`);
      } else if (msgAction === 'error') {
        const errorData = msg.data || msg.error || 'Unknown error';
        this.log.error?.(`❌ ${this.getLogPrefix()}Server error: ${errorData}`);

        if (String(errorData).toLowerCase().includes('limit')) {
          this.reconnectAt = Date.now() + 60000;
          this.webSocket?.close(4001, 'Rate limited');
        } else if (String(errorData).toLowerCase().includes('blocked')) {
          this.reconnectAt = Date.now() + 3600000;
          this.webSocket?.close(4002, 'User blocked');
        }
      } else {
        this.log.warn?.(`⚠️ ${this.getLogPrefix()}Unknown message action: ${msgAction}`);
        this.log.debug?.(msg);
      }
    } catch (error) {
      this.log.error?.(`❌ ${this.getLogPrefix()}Error handling message:`, error);
      this.log.debug?.(`Raw message: ${message}`);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.log.info?.(`🔌 ${this.getLogPrefix()}Connection closed: ${code} - ${reason}`);

    this.clearTimers();

    if (this.onClose) {
      try {
        this.onClose(code, reason);
      } catch (callbackError) {
        this.log.error?.(`❌ ${this.getLogPrefix()}Close callback error:`, callbackError);
      }
    }

    if (code === 1008) {
      this.log.warn?.(`🚫 ${this.getLogPrefix()}Connection rejected by server (blocked user)`);
      this._stop = true;
    } else if (code === 1013) {
      this.log.warn?.(`⏰ ${this.getLogPrefix()}Rate limited, waiting before reconnect...`);
    } else if (code === 4001) {
      this.log.warn?.(`⏰ ${this.getLogPrefix()}Rate limited - custom close code`);
    } else if (code === 4002) {
      this.log.warn?.(`🚫 ${this.getLogPrefix()}User blocked - custom close code`);
    } else if (code === 4003) {
      this.log.warn?.(`👮 ${this.getLogPrefix()}Admin kick - custom close code`);
    }

    if (!this._stop) {
      void this.handleReconnect();
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.webSocket?.readyState !== WebSocket.OPEN) {
        this.log.debug?.(`${this.getLogPrefix()}WebSocket is not open. Skipping ping.`);
        return;
      }

      const pingTime = Date.now();
      this.log.debug?.(`→ ${this.getLogPrefix()}Sending ping (t=${pingTime})`);
      this.webSocket?.send(JSON.stringify({ action: 'ping', t: pingTime }));
    }, this.pingIntervalMs);
  }

  private startPongWatchdog(): void {
    this.pongWatchdog = setInterval(() => {
      if (Date.now() - this.lastPongTime > this.pongTimeoutMs) {
        this.log.warn?.(`❌ ${this.getLogPrefix()}No pong received in time — forcing reconnect.`);
        this.webSocket?.close();
      }
    }, 5000);
  }

  private startProactiveRotation(): void {
    this.rotationTimeout = setTimeout(() => {
      const connectionAge = Date.now() - this.connectionStartTime;
      this.log.info?.(
        `🔄 ${this.getLogPrefix()}Proactive rotation after ${(connectionAge / 60000).toFixed(1)} minutes (before 2h AWS limit)`,
      );
      this.webSocket?.close(4000, 'Proactive rotation');
    }, this.connectionLifetimeMs) as any;
  }

  private async handleReconnect(): Promise<void> {
    const now = Date.now();

    if (this.reconnectAt && now < this.reconnectAt) {
      const waitTime = (this.reconnectAt - now) / 1000;
      this.log.info?.(`⏰ ${this.getLogPrefix()}Waiting ${waitTime.toFixed(1)}s until reconnectAt before attempting reconnect`);
      await this.sleep(this.reconnectAt - now);
    } else {
      this.log.info?.(`🔁 ${this.getLogPrefix()}Reconnecting in ${(this.currentReconnectDelayMs / 1000).toFixed(1)}s...`);
      await this.sleep(this.currentReconnectDelayMs);
      this.currentReconnectDelayMs = Math.min(this.currentReconnectDelayMs * 2, this.maxReconnectDelayMs);
    }
  }

  private resetBackoff(): void {
    this.currentReconnectDelayMs = this.baseReconnectDelayMs;
  }

  private clearTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    if (this.pongWatchdog) {
      clearInterval(this.pongWatchdog);
      this.pongWatchdog = undefined;
    }
    if (this.rotationTimeout) {
      clearTimeout(this.rotationTimeout);
      this.rotationTimeout = undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  public stop(): void {
    this._stop = true;
    this.clearTimers();
    this.webSocket?.close();
  }

  public disconnect(): void {
    this.stop();
  }
}
