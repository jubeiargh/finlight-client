import WebSocket from 'ws';
import { Article, BasicArticle, GetArticlesWebSocketParams } from './types';
import { ApiClientConfig } from './config';

export class WebSocketClient {
  private webSocket!: WebSocket;
  constructor(private readonly config: ApiClientConfig) {}

  public connect(
    requestPayload: GetArticlesWebSocketParams & { extended: false },
    onMessage: (article: BasicArticle) => void,
  ): void;
  public connect(
    requestPayload: GetArticlesWebSocketParams & { extended: true },
    onMessage: (article: Article) => void,
  ): void;
  public connect(
    requestPayload: GetArticlesWebSocketParams,
    onMessage: (article: Article) => void,
  ): void {
    this.webSocket = new WebSocket(this.config.wssUrl, {
      headers: {
        'x-api-key': this.config.apiKey,
      },
    });

    this.webSocket.on('open', () => {
      console.debug('Connected to web socket');
      this.sendRequest(requestPayload);
    });

    this.webSocket.on('message', (data) => {
      try {
        const article: Article = JSON.parse(data.toString());
        article.publishDate = new Date(article.publishDate);
        article.confidence = Number(article.confidence);
        onMessage(article);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    this.webSocket.on('close', (code, reason) => {
      console.log(
        `WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`,
      );
    });

    this.webSocket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
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
    if (this.webSocket) {
      this.webSocket.close();
    }
  }
}
