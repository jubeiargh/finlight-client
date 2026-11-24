// Type test: compiles against the published declarations (dist/*.d.ts) with the oldest supported
// TypeScript (5.0) and the current one. Not run, only type-checked.
import {
  FinlightClient,
  Webhooks,
  WrongPayloadVersion,
  contentPresent,
  isFinlightApiError,
  toDate,
  type Article,
  type EventType,
  type SearchParams,
  type StreamEvent,
} from 'finlight-client';

declare const article: Article;
const client = new FinlightClient({ apiKey: 'k', retryOnBurst: 'off' });
const params: SearchParams = {
  eventTypes: ['earnings', 'a-future-type'],
  include: ['events'],
  from: new Date(),
};
const known: EventType = 'mna';
const open: EventType = 'whatever';
void client.articles.search(params);
if (contentPresent(article)) {
  const text: string | null = article.content;
  void text;
}
// @ts-expect-error content may be absent: it is optional without the guard
const unchecked: string | null = article.content;
const when: Date | null = toDate(article.publishedAt);
async function consume(): Promise<void> {
  for await (const ev of client.stream({ include: ['companies'] })) {
    const item: StreamEvent = ev;
    if (item.kind === 'created' || item.kind === 'updated') void item.article?.id;
  }
}
const result = Webhooks.constructEvent('{}', { 'x-webhook-signature': 's' }, 'secret');
if (result instanceof WrongPayloadVersion) void result.link;
else void result.eventId;
try {
  void 0;
} catch (err) {
  if (isFinlightApiError(err)) void err.apiKind;
}
void known;
void open;
void unchecked;
void when;
void consume;
