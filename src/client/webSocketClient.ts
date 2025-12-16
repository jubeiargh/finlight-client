import WebSocket from 'ws';
import { Article, GetArticlesWebSocketParams, ApiClientConfig } from '../types';
import { transformArticle } from '../utils';
import { Logger, createLogger } from '../logger';
import { CLIENT_VERSION } from '../version';

export type WebSocketResponse<T> = {
  action: string;
  data: T;
};

export interface WebSocketClientOptions {
  pingInterval?: number; // 25 seconds (matches HEARTBEAT_MS)
  pongTimeout?: number;
  baseReconnectDelay?: number; // Start with 500ms
  maxReconnectDelay?: number; // Cap at 10 seconds
  connectionLifetime?: number; // 115 minutes (2h - 5m)
  onClose?: (code: number, reason: string) => void;
  takeover?: boolean; // Whether to takeover existing connections
}

export class WebSocketClient {
  private webSocket?: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private pongWatchdog?: NodeJS.Timeout;
  private rotationTimeout?: NodeJS.Timeout;
  private _stop = false;
  private readonly log: Logger;
  private recentArticleLinks = new Set<string>();
  private readonly RECENT_ARTICLE_CACHE_SIZE = 10;

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

  constructor(
    private readonly config: ApiClientConfig,
    options: WebSocketClientOptions = {},
  ) {
    this.log = createLogger(config.logger ?? console, config.logLevel ?? 'info');
    this.pingIntervalMs = (options.pingInterval ?? 25) * 1000;
    this.pongTimeoutMs = (options.pongTimeout ?? 60) * 1000;
    this.baseReconnectDelayMs = (options.baseReconnectDelay ?? 0.5) * 1000;
    this.maxReconnectDelayMs = (options.maxReconnectDelay ?? 10.0) * 1000;
    this.connectionLifetimeMs = (options.connectionLifetime ?? 115) * 60 * 1000;
    this.onClose = options.onClose;
    this.takeover = options.takeover ?? false;
    this.currentReconnectDelayMs = this.baseReconnectDelayMs;

    process.on('SIGINT', () => {
      this.log.info?.('Caught interrupt signal. Shutting down gracefully...');
      this.stop();
      process.exit();
    });
  }

  public async connect(
    requestPayload: GetArticlesWebSocketParams,
    onMessage: (article: Article) => void,
  ): Promise<void> {
    while (!this._stop) {
      try {
        this.log.info?.('🔄 Attempting to connect...');

        // Prepare headers
        const headers: Record<string, string> = { 'x-api-key': this.config.apiKey, 'x-client-version': CLIENT_VERSION };
        if (this.takeover) {
          headers['x-takeover'] = 'true';
          this.log.info?.('🔄 Connecting with takeover=true');
        }

        this.webSocket = new WebSocket(this.config.wssUrl, { headers });

        await new Promise<void>((resolve, reject) => {
          if (!this.webSocket) return reject(new Error('WebSocket not initialized'));

          this.webSocket.on('open', () => {
            this.log.info?.('✅ Connected.');

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
            this.log.error?.('❌ Connection error:', error);
            reject(error);
          });
        });
      } catch (error) {
        this.log.error?.('❌ Connection error:', error);

        // Check if this is a 429 rate limit error
        if (error instanceof Error && error.message.includes('429')) {
          // Use fixed delay for 429 responses since we can't get server retry timing
          const retryAfterSeconds = 60; // Fixed 1 minute delay for capacity limits
          this.reconnectAt = Date.now() + retryAfterSeconds * 1000;
          this.log.warn?.(`⏰ Server rejected connection (429) - waiting ${retryAfterSeconds}s before retry`);
        }

        if (!this._stop) {
          await this.handleReconnect();
        }
      }
    }
  }
  private handleMessage(message: string, onArticle: (article: Article) => void): void {
    try {
      const msg = JSON.parse(message);
      const msgAction = msg.action;

      if (msgAction === 'pong') {
        const pingTime = msg.t;
        if (pingTime) {
          const rtt = Date.now() - pingTime;
          this.log.debug?.(`← PONG received (RTT: ${rtt}ms)`);
        } else {
          this.log.debug?.('← PONG received');
        }
        this.lastPongTime = Date.now();
      } else if (msgAction === 'admit') {
        this.leaseId = msg.leaseId;
        const serverNow = msg.serverNow;
        const clientNonce = msg.clientNonce;
        this.log.info?.(`✅ Admitted (leaseId: ${this.leaseId}, serverNow: ${serverNow})`);
        if (clientNonce && clientNonce !== this.clientNonce) {
          this.log.warn?.(`⚠️ Nonce mismatch: expected ${this.clientNonce}, got ${clientNonce}`);
        }
      } else if (msgAction === 'preempted') {
        const reason = msg.reason || 'unknown';
        const newLeaseId = msg.newLeaseId || '';
        this.log.warn?.(`🔄 Connection preempted: ${reason} (new lease: ${newLeaseId})`);
        // Stop reconnecting - this connection was legitimately replaced
        this._stop = true;
        this.webSocket?.close(1000, 'Preempted by server');
      } else if (msgAction === 'sendArticle') {
        const data = msg.data || {};
        const transformedArticle = transformArticle(data);

        // Skip if it's a duplicate article (e.g., last article resent on reconnect)
        if (this.recentArticleLinks.has(transformedArticle.link)) {
          this.log.debug?.(`⏭️ Skipping duplicate article: ${transformedArticle.link}`);
          return;
        }

        // Track this article ID
        this.recentArticleLinks.add(transformedArticle.link);

        // Maintain cache size by removing oldest entry when limit is reached
        if (this.recentArticleLinks.size > this.RECENT_ARTICLE_CACHE_SIZE) {
          const firstLink = this.recentArticleLinks.values().next().value;
          this.recentArticleLinks.delete(firstLink!);
        }

        onArticle(transformedArticle);
      } else if (msgAction === 'admin_kick') {
        const retryAfter = msg.retryAfter || 900000; // 15 minutes default
        const retryAfterSeconds = retryAfter / 1000;
        this.reconnectAt = Date.now() + retryAfter;
        this.log.warn?.(`🚫 Admin kicked - retry after ${retryAfterSeconds}s`);
        // Close with custom code and let reconnect logic handle the delay
        this.webSocket?.close(4003, `Admin kick - retry after ${retryAfter}ms`);
      } else if (msgAction === 'error') {
        const errorData = msg.data || msg.error || 'Unknown error';
        this.log.error?.(`❌ Server error: ${errorData}`);

        // Check if it's a rate limit or blocked error
        if (String(errorData).toLowerCase().includes('limit')) {
          // Set reconnectAt for rate limits
          this.reconnectAt = Date.now() + 60000; // Wait 1 minute for rate limits
          this.webSocket?.close(4001, 'Rate limited');
        } else if (String(errorData).toLowerCase().includes('blocked')) {
          // Set reconnectAt for blocked users
          this.reconnectAt = Date.now() + 3600000; // Wait 1 hour for blocks
          this.webSocket?.close(4002, 'User blocked');
        }
      } else {
        this.log.warn?.(`⚠️ Unknown message action: ${msgAction}`);
        this.log.debug?.(msg);
      }
    } catch (error) {
      this.log.error?.('❌ Error handling message:', error);
      this.log.debug?.(`Raw message: ${message}`);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.log.info?.(`🔌 Connection closed: ${code} - ${reason}`);

    this.clearTimers();

    if (this.onClose) {
      try {
        this.onClose(code, reason);
      } catch (callbackError) {
        this.log.error?.('❌ Close callback error:', callbackError);
      }
    }

    // Handle specific close codes for reconnection logic
    if (code === 1008) {
      // Policy violation (blocked user)
      this.log.warn?.('🚫 Connection rejected by server (blocked user)');
      this._stop = true; // Stop reconnecting
    } else if (code === 1013) {
      // Try again later (rate limited)
      this.log.warn?.('⏰ Rate limited, waiting before reconnect...');
      // The main loop will handle reconnect delay
    } else if (code === 4001) {
      // Custom: Rate limited
      this.log.warn?.('⏰ Rate limited - custom close code');
    } else if (code === 4002) {
      // Custom: User blocked
      this.log.warn?.('🚫 User blocked - custom close code');
    } else if (code === 4003) {
      // Custom: Admin kick
      this.log.warn?.('👮 Admin kick - custom close code');
    }

    if (!this._stop) {
      void this.handleReconnect();
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.webSocket?.readyState !== WebSocket.OPEN) {
        this.log.debug?.('WebSocket is not open. Skipping ping.');
        return;
      }

      const pingTime = Date.now();
      this.log.debug?.(`→ Sending ping (t=${pingTime})`);
      this.webSocket?.send(JSON.stringify({ action: 'ping', t: pingTime }));
    }, this.pingIntervalMs);
  }

  private startPongWatchdog(): void {
    this.pongWatchdog = setInterval(() => {
      if (Date.now() - this.lastPongTime > this.pongTimeoutMs) {
        this.log.warn?.('❌ No pong received in time — forcing reconnect.');
        this.webSocket?.close();
      }
    }, 5000); // Check every 5 seconds
  }

  private startProactiveRotation(): void {
    this.rotationTimeout = setTimeout(() => {
      const connectionAge = Date.now() - this.connectionStartTime;
      this.log.info?.(
        `🔄 Proactive rotation after ${(connectionAge / 60000).toFixed(1)} minutes (before 2h AWS limit)`,
      );

      // Gracefully close the connection with custom code
      this.webSocket?.close(4000, 'Proactive rotation');
    }, this.connectionLifetimeMs) as any;
  }

  private async handleReconnect(): Promise<void> {
    const now = Date.now();

    // Check if we need to wait due to rate limits/blocks
    if (this.reconnectAt && now < this.reconnectAt) {
      const waitTime = (this.reconnectAt - now) / 1000;
      this.log.info?.(`⏰ Waiting ${waitTime.toFixed(1)}s until reconnectAt before attempting reconnect`);
      await this.sleep(this.reconnectAt - now);
    } else {
      // Regular exponential backoff
      this.log.info?.(`🔁 Reconnecting in ${(this.currentReconnectDelayMs / 1000).toFixed(1)}s...`);
      await this.sleep(this.currentReconnectDelayMs);

      // Increase delay for next time (exponential backoff)
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
    // Simple UUID v4 generator compatible with CommonJS
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
