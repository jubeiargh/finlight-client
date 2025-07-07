import WebSocket from 'ws';
import { Article, GetArticlesWebSocketParams } from './types';
import { ApiClientConfig } from './config';

export type WebSocketResponse<T> = {
  action: string;
  data: T;
};
export class WebSocketClient {
  private webSocket?: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private shouldReconnect = true;

  constructor(private readonly config: ApiClientConfig) {
    process.on('SIGINT', () => {
      console.log('Caught interrupt signal. Shutting down gracefully...');
      this.shouldReconnect = false;
      this.disconnect();
      process.exit();
    });
  }

  public connect(requestPayload: GetArticlesWebSocketParams, onMessage: (article: Article) => void): void {
    this.webSocket = new WebSocket(this.config.wssUrl, {
      headers: {
        'x-api-key': this.config.apiKey,
      },
    });

    this.webSocket.on('open', () => {
      console.debug('Connected to web socket');
      this.sendRequest(requestPayload);
      this.createPingInterval();
    });

    this.webSocket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const action = message.action;

        if (action === 'pong') {
          this.handlePong();
        }

        if (action === 'sendArticle') {
          this.receiveArticle(message, onMessage);
        }

        if (action === 'error') {
          this.handleError(data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    this.webSocket.on('close', (code, reason) => {
      console.debug(`WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`);
      clearInterval(this.pingInterval);
      if (this.shouldReconnect) {
        console.debug('Attempting to reconnect in 1 second...');
        setTimeout(() => this.connect(requestPayload, onMessage), 1000);
      }
    });

    this.webSocket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }
  handleError(error: WebSocket.RawData) {
    console.error('WebSocket error:', error);
    clearInterval(this.pingInterval);
    this.shouldReconnect = false;
    this.disconnect();
  }

  private createPingInterval() {
    this.pingInterval = setInterval(
      () => {
        if (this.webSocket?.readyState !== WebSocket.OPEN) {
          console.debug('WebSocket is not open. Skipping ping.');
          return;
        }

        console.debug('PING');
        this.webSocket?.send(JSON.stringify({ action: 'ping' }));
      },
      4 * 60 * 1_000,
    ); // ~ 8 min
  }

  /**
   * Send the request payload to the server.
   * @param payload The data to send.
   */
  private sendRequest(payload: GetArticlesWebSocketParams): void {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(payload));
    } else {
      console.error('WebSocket is not open. Cannot send message.');
    }
  }

  /**
   * Disconnect the WebSocket connection.
   */
  disconnect(): void {
    clearInterval(this.pingInterval);
    this.webSocket?.close();
  }

  private receiveArticle(response: WebSocketResponse<Article>, callback: (article: Article) => void) {
    const article = response.data;
    article.publishDate = new Date(article.publishDate);
    article.confidence = Number(article.confidence);

    callback(article);
  }
  private handlePong() {
    console.debug('PONG');
  }
}
