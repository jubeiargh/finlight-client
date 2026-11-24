import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  params: URLSearchParams;
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
  body: string;
}

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  /** Object -> JSON; string -> sent as is; null -> empty body. */
  body?: unknown;
}

export type Responder = MockResponse | ((req: RecordedRequest) => MockResponse);

/** HTTP server on 127.0.0.1 that answers from a script and records every request. */
export class HttpMock {
  readonly requests: RecordedRequest[] = [];
  private script: Responder[] = [];
  private fallback: Responder | null = null;
  private server: Server;
  baseUrl = '';

  constructor() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const recorded: RecordedRequest = {
          method: req.method ?? '',
          path: url.pathname,
          query: url.search.replace(/^\?/, ''),
          params: url.searchParams,
          headers: req.headers,
          rawHeaders: req.rawHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        this.requests.push(recorded);
        const responder = this.script.shift() ?? this.fallback;
        const response: MockResponse =
          typeof responder === 'function'
            ? responder(recorded)
            : (responder ?? { status: 599, body: 'no script' });
        let body = '';
        if (response.body !== undefined && response.body !== null) {
          body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
        }
        const headers: Record<string, string> = { ...(response.headers ?? {}) };
        if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['content-type'] = 'application/json; charset=utf-8';
        }
        res.writeHead(response.status, headers);
        res.end(body);
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this;
  }

  enqueue(...responses: Responder[]): this {
    this.script.push(...responses);
    return this;
  }

  always(response: Responder): this {
    this.fallback = response;
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.script = [];
    this.fallback = null;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
