// Live articles over WebSocket. Reconnects, pings and rotation are handled by the SDK.
import { PreemptedError, isFinlightApiError } from 'finlight-client';
import { createClient } from './client';

export async function main(maxItems = 5, signal?: AbortSignal): Promise<void> {
  const client = createClient();
  const stream = client.stream(
    { query: 'ticker:NVDA OR ticker:AMD', language: 'en', includeUpdates: true, include: ['companies'] },
    {
      ...(signal ? { signal } : {}),
      onAdmitted: (a) => console.log(`admitted, lease ${a.leaseId}`),
      // The SDK does not backfill: fill gaps after a reconnect through REST if you need them.
      onReconnect: (r) =>
        console.log(`reconnected (${r.reason}), last seen ${r.lastSeenAt ?? 'nothing yet'}`),
      onError: (e) => console.warn(`stream problem: ${e.message}`),
    },
  );
  let seen = 0;
  try {
    for await (const item of stream) {
      if (item.kind === 'other') continue; // an event this SDK version does not know
      console.log(`${item.kind}: ${item.article?.title}`);
      seen += 1;
      if (seen >= maxItems) break; // leaving the loop closes the socket
    }
  } catch (err) {
    if (err instanceof PreemptedError) console.error(`preempted (${err.reason})`);
    else if (isFinlightApiError(err)) console.error(`stream refused: ${err.status} ${err.detail ?? ''}`);
    else throw err;
  }
}

if (require.main === module) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  void main(5, controller.signal).catch((err) => {
    if (!controller.signal.aborted) throw err;
  });
}
