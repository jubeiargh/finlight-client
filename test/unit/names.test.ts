import * as sdk from '../../src/index';
import type {
  Article,
  ArticlePage,
  ArticleSource,
  Company,
  CompanyRecord,
  EventTag,
  Listing,
  Media,
  Pagination,
  Sentiment,
  Source,
  StreamEvent,
  WebhookEvent,
} from '../../src/index';

// R-NAMES-1: the shared base words are exported under their names.
test('the public exports carry the shared names', () => {
  const values = [
    'FinlightClient',
    'Webhooks',
    'WrongPayloadVersion',
    'FinlightApiError',
    'FinlightValidationError',
    'FinlightNetworkError',
    'FinlightTimeoutError',
    'FinlightDecodeError',
    'WebhookVerificationError',
    'PreemptedError',
    'ValidationFailedError',
    'CursorInvalidError',
    'CursorMismatchError',
    'UnauthorizedError',
    'ForbiddenError',
    'NotFoundError',
    'RateLimitedError',
    'InternalServerError',
    'RATE_LIMIT_TYPES',
    'DEFAULT_WEBHOOK_TOLERANCE_MS',
    'cacheInfo',
    'isWrongPayloadVersion',
    'contentPresent',
    'sentimentPresent',
    'companiesPresent',
    'eventsPresent',
    'isFinlightApiError',
    'toDate',
    'rawJson',
  ];
  for (const name of values) expect(typeof (sdk as Record<string, unknown>)[name]).not.toBe('undefined');
  expect(typeof sdk.Webhooks.constructEvent).toBe('function');
  expect(typeof sdk.Webhooks.verifySignature).toBe('function');
  expect(typeof sdk.Webhooks.constructEventFromValues).toBe('function');
  const client = new sdk.FinlightClient({ apiKey: 'k' });
  for (const m of ['search', 'searchAll', 'get', 'getByLink'] as const)
    expect(typeof client.articles[m]).toBe('function');
  for (const m of ['search', 'getMany', 'get'] as const) expect(typeof client.companies[m]).toBe('function');
  expect(typeof client.sources.list).toBe('function');
  expect(typeof client.stream).toBe('function');
  expect(typeof client.rawStream).toBe('function');
  // No v2 names survive.
  for (const old of ['FinlightApi', 'WebhookService', 'ArticleService', 'SourceService', 'skippedEntries']) {
    expect(old in sdk).toBe(false);
  }
});

// Type-level presence of the model names (compile-time check).
export type ModelNames = [
  Article,
  ArticleSource,
  Media,
  Sentiment,
  Company,
  Listing,
  EventTag,
  CompanyRecord,
  Source,
  Pagination,
  ArticlePage,
  StreamEvent,
  WebhookEvent,
];

test('error tree: timeout is a network error, subclasses carry their kind', () => {
  const timeout = new sdk.FinlightTimeoutError('t');
  expect(timeout).toBeInstanceOf(sdk.FinlightNetworkError);
  expect(timeout.kind).toBe('timeout');
  const nf = new sdk.NotFoundError({
    status: 404,
    code: null,
    type: null,
    title: null,
    detail: null,
    requestId: null,
    errors: [],
    raw: null,
  });
  expect(nf).toBeInstanceOf(sdk.FinlightApiError);
  expect(nf.apiKind).toBe('not_found');
  const decode = new sdk.FinlightDecodeError('d', 'a.b', { x: 1 });
  expect(decode.raw).toEqual({ x: 1 });
});
