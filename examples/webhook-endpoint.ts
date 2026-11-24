// A webhook endpoint on node:http. With Express use express.raw({ type: 'application/json' })
// so the body stays raw; never verify a re-serialized JSON body.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebhookVerificationError, Webhooks, WrongPayloadVersion, type WebhookEvent } from 'finlight-client';

const seen = new Set<string>(); // use a shared store (Redis, a DB table) in production

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function createHandler(secret: string, onEvent: (event: WebhookEvent) => Promise<void> | void) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rawBody = await readRawBody(req);
    let result: WebhookEvent | WrongPayloadVersion;
    try {
      result = Webhooks.constructEvent(rawBody, req.headers, secret);
    } catch (err) {
      // Answer verification failures with 400. Never answer with 410: it disables the webhook.
      res.writeHead(err instanceof WebhookVerificationError ? 400 : 500).end();
      return;
    }
    if (result instanceof WrongPayloadVersion) {
      // Old-format retries after switching the webhook to v3: acknowledge with 2xx, keep the raw JSON if needed.
      res.writeHead(204).end();
      return;
    }
    // Answer within 5 s, then do the slow work.
    res.writeHead(204).end();
    if (seen.has(result.eventId)) return; // the same event can arrive more than once
    seen.add(result.eventId);
    setImmediate(() => void onEvent(result as WebhookEvent));
  };
}

if (require.main === module) {
  const secret = process.env.FINLIGHT_WEBHOOK_SECRET;
  if (!secret) throw new Error('Set FINLIGHT_WEBHOOK_SECRET');
  const handler = createHandler(secret, (event) => {
    console.log(`${event.event} ${event.data.title}${event.isTest ? ' (test)' : ''}`);
  });
  createServer((req, res) => void handler(req, res)).listen(3000, () => console.log('listening on :3000'));
}
