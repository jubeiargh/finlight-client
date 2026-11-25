import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { waitFor } from './fake-clock';

export interface DialRecord {
  path: string;
  url: string;
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
  accepted: boolean;
  conn: ServerConn | null;
}

export type DialResponse = { status: 101 } | { status: number; body: string };

export class ServerConn {
  readonly messages: unknown[] = [];
  private consumed = 0;
  closedCode: number | null = null;
  pingsAnswered = 0;

  constructor(
    readonly ws: WebSocket,
    autoPong: () => boolean,
  ) {
    ws.on('message', (data) => {
      const text = data.toString();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep text
      }
      this.messages.push(parsed);
      if (autoPong() && parsed && typeof parsed === 'object' && (parsed as any).action === 'ping') {
        this.pingsAnswered += 1;
        ws.send(
          JSON.stringify({
            event: 'connection.pong',
            payloadVersion: 3,
            data: { t: (parsed as any).t, serverNow: 1 },
          }),
        );
      }
    });
    ws.on('close', (code) => {
      this.closedCode = code;
    });
  }

  /** Next message not consumed yet. */
  async next(what = 'a client message'): Promise<unknown> {
    await waitFor(() => this.messages.length > this.consumed, what);
    return this.messages[this.consumed++];
  }

  peek(): unknown {
    return this.messages.length > this.consumed ? this.messages[this.consumed] : undefined;
  }

  skip(): void {
    this.consumed += 1;
  }

  send(frame: unknown): void {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  get open(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }
}

/** In-process WebSocket server on 127.0.0.1 with scripted dial answers. */
export class WsMock {
  readonly dials: DialRecord[] = [];
  readonly dialScript: DialResponse[] = [];
  autoPong = true;
  private consumedDials = 0;
  private server: Server;
  private wss = new WebSocketServer({ noServer: true });
  url = '';

  constructor() {
    this.server = createServer((_req, res) => {
      res.writeHead(426);
      res.end();
    });
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const record: DialRecord = {
        path: url.pathname,
        url: req.url ?? '/',
        headers: req.headers,
        rawHeaders: req.rawHeaders,
        accepted: false,
        conn: null,
      };
      const answer = this.dialScript.shift() ?? { status: 101 };
      if (answer.status !== 101) {
        const body = (answer as { body: string }).body;
        socket.end(
          `HTTP/1.1 ${answer.status} Refused\r\nContent-Type: application/json\r\n` +
            `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        this.dials.push(record);
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        record.accepted = true;
        record.conn = new ServerConn(ws, () => this.autoPong);
        this.dials.push(record);
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `ws://127.0.0.1:${port}`;
    return this;
  }

  async nextDial(what = 'a dial'): Promise<DialRecord> {
    await waitFor(() => this.dials.length > this.consumedDials, what);
    return this.dials[this.consumedDials++];
  }

  get dialCount(): number {
    return this.dials.length;
  }

  openConnections(): number {
    return this.dials.filter((d) => d.conn?.open).length;
  }

  async stop(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
