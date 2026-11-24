import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { decodeArticleStrict, DecodeFailure } from './decode';
import { FinlightDecodeError, WebhookVerificationError } from './errors';
import { isObject } from './internal/json';
import { attachRaw } from './internal/raw';
import type { WebhookEvent } from './models';
import { parseRfc3339 } from './time';

/** Header collections `constructEvent` accepts. Names are matched case-insensitively. */
export type WebhookHeaders =
  | IncomingHttpHeaders
  | Headers
  | Record<string, string | readonly string[] | undefined>
  | Iterable<readonly [string, string]>;

export interface WebhookVerifyOptions {
  /** Allowed clock difference in milliseconds, in both directions. Default 300000 (300 s). */
  toleranceMs?: number;
  /** Replaceable clock (epoch milliseconds), for tests. */
  now?: () => number;
}

export const DEFAULT_WEBHOOK_TOLERANCE_MS = 300_000;

const SIGNATURE_HEADER = 'x-webhook-signature';
const TIMESTAMP_HEADER = 'x-webhook-timestamp';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * Result for a correctly signed body that is not `payloadVersion` 3 (e.g. retries in the
 * old format for about 2 h after switching a webhook to v3). It is a result, not an error:
 * answer it with 2xx and keep `json` if you need the data.
 */
export class WrongPayloadVersion {
  /** Version by the server's rule: 3 only for the JSON number 3, otherwise 2. */
  readonly detectedVersion: 2;
  /** `payloadVersion` exactly as received; `undefined` when the key was missing. */
  readonly payloadVersion: unknown;
  readonly payloadVersionPresent: boolean;
  /** The parsed JSON body. Keep it if you need the data. */
  readonly raw: Record<string, unknown>;
  /** The article link, when it can be read. */
  readonly link: string | null;

  constructor(json: Record<string, unknown>) {
    this.detectedVersion = 2;
    this.payloadVersionPresent = Object.prototype.hasOwnProperty.call(json, 'payloadVersion');
    this.payloadVersion = json.payloadVersion;
    this.raw = json;
    const data = isObject(json.data) ? json.data : undefined;
    this.link = typeof json.link === 'string' ? json.link : typeof data?.link === 'string' ? data.link : null;
    attachRaw(this, json);
  }
}

export function isWrongPayloadVersion(value: unknown): value is WrongPayloadVersion {
  return value instanceof WrongPayloadVersion;
}

function headerValues(headers: WebhookHeaders, name: string): string[] {
  const cgi = `http_${name.replace(/-/g, '_')}`;
  const matches = (key: string): boolean => {
    const lower = key.toLowerCase();
    return lower === name || lower === cgi;
  };
  const values: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) for (const v of value) add(v);
  };
  if (typeof (headers as Headers).get === 'function' && typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => {
      if (matches(key)) add(value);
    });
    return values;
  }
  if (headers instanceof Map) {
    for (const [key, value] of headers as Map<string, unknown>) if (matches(String(key))) add(value);
    return values;
  }
  if (typeof (headers as Iterable<unknown>)[Symbol.iterator] === 'function' && !isObject(headers)) {
    for (const entry of headers as Iterable<readonly [string, string]>) {
      if (Array.isArray(entry) && matches(String(entry[0]))) add(entry[1]);
    }
    return values;
  }
  if (isObject(headers)) {
    for (const [key, value] of Object.entries(headers)) if (matches(key)) add(value);
  }
  return values;
}

function singleHeader(headers: WebhookHeaders, name: string, label: string): string | null {
  const values = headerValues(headers, name);
  if (values.length === 0) return null;
  // Node and Fetch join repeated headers with ", "; neither value can contain a comma.
  if (values.length > 1 || values[0].includes(',')) {
    throw new WebhookVerificationError('duplicate_header', `the ${label} header appears more than once`);
  }
  return values[0];
}

function toBytes(rawBody: unknown): Buffer {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (rawBody instanceof Uint8Array)
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  throw new WebhookVerificationError(
    'invalid_raw_body',
    'rawBody must be the raw request body (string or Uint8Array/Buffer) exactly as received. ' +
      'A parsed JSON object cannot be verified: read the raw body before any JSON body parser runs.',
  );
}

const ASCII = /^[\x20-\x7e]*$/;

function verifyBytes(
  body: Buffer,
  signature: string | null,
  timestamp: string | null,
  secret: unknown,
  options: WebhookVerifyOptions | undefined,
): void {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new WebhookVerificationError('invalid_secret', 'the webhook secret must be a non-empty string');
  }
  if (signature === null || signature === '') {
    throw new WebhookVerificationError('missing_signature', 'the X-Webhook-Signature header is missing');
  }
  if (timestamp === null || timestamp === '') {
    throw new WebhookVerificationError('missing_timestamp', 'the X-Webhook-Timestamp header is missing');
  }
  if (!ASCII.test(signature) || !ASCII.test(timestamp)) {
    throw new WebhookVerificationError('non_ascii_header', 'a webhook header contains non-ASCII characters');
  }
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    throw new WebhookVerificationError(
      'unsupported_signature_scheme',
      'the X-Webhook-Signature header must start with "sha256="',
    );
  }
  const signedAt = parseRfc3339(timestamp);
  if (signedAt === null) {
    throw new WebhookVerificationError(
      'unparseable_timestamp',
      'the X-Webhook-Timestamp header is not an RFC 3339 timestamp',
    );
  }
  const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${timestamp}.`, 'utf8')
    .update(body)
    .digest();
  const given = signature.slice(SIGNATURE_PREFIX.length);
  const givenBytes =
    /^[0-9a-fA-F]+$/.test(given) && given.length === expected.length * 2 ? Buffer.from(given, 'hex') : null;
  if (
    givenBytes === null ||
    givenBytes.length !== expected.length ||
    !timingSafeEqual(givenBytes, expected)
  ) {
    throw new WebhookVerificationError('signature_mismatch', 'the webhook signature does not match');
  }
  const tolerance = options?.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS;
  if (typeof tolerance !== 'number' || !(tolerance >= 0)) {
    throw new WebhookVerificationError(
      'timestamp_outside_tolerance',
      'toleranceMs must be a non-negative number',
    );
  }
  const now = options?.now ? options.now() : Date.now();
  if (Math.abs(now - signedAt) > tolerance) {
    throw new WebhookVerificationError(
      'timestamp_outside_tolerance',
      'the webhook timestamp is outside the allowed tolerance',
    );
  }
}

function decodeEnvelope(json: Record<string, unknown>): WebhookEvent {
  const req = (key: string): string => {
    const v = json[key];
    if (typeof v !== 'string')
      throw new DecodeFailure(key, `required string, got ${v === null ? 'null' : typeof v}`);
    return v;
  };
  const eventId = req('eventId');
  const event: WebhookEvent = {
    ...json,
    eventId,
    event: req('event'),
    occurredAt: req('occurredAt'),
    payloadVersion: json.payloadVersion as number,
    subscriptionId: req('subscriptionId'),
    data: decodeArticleStrict(json.data, 'data'),
    isTest: eventId.startsWith('evt_test'),
  };
  delete event.changedFields;
  if (json.changedFields !== undefined && json.changedFields !== null) {
    if (!Array.isArray(json.changedFields) || json.changedFields.some((f) => typeof f !== 'string')) {
      throw new DecodeFailure('changedFields', 'expected an array of strings');
    }
    event.changedFields = [...(json.changedFields as string[])];
  }
  return attachRaw(event, json);
}

/** Parses a verified body: payload version first, then the envelope. */
function readEvent(body: Buffer): WebhookEvent | WrongPayloadVersion {
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw new FinlightDecodeError('the verified webhook body is not JSON', null, undefined, err);
  }
  if (!isObject(json))
    throw new FinlightDecodeError('the verified webhook body is not a JSON object', null, json);
  const version = json.payloadVersion;
  if (!(typeof version === 'number' && version === 3)) return new WrongPayloadVersion(json);
  try {
    return decodeEnvelope(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FinlightDecodeError(
      `could not decode the webhook: ${message}`,
      err instanceof DecodeFailure ? err.path : null,
      json,
    );
  }
}

/**
 * Verifies and reads incoming finlight webhooks. Always pass the raw body exactly as
 * received; never re-serialize parsed JSON.
 */
export const Webhooks = {
  /**
   * Verifies the signature (HMAC-SHA256 over `timestamp + "." + rawBody`, keyed with the
   * UTF-8 bytes of the secret), checks the timestamp tolerance, then parses the body.
   *
   * Returns the `WebhookEvent`, or a `WrongPayloadVersion` result for a correctly signed body
   * in another payload version (answer it with 2xx). Throws `WebhookVerificationError`
   * when verification fails and `FinlightDecodeError` when a verified body is unreadable.
   */
  constructEvent(
    rawBody: string | Uint8Array,
    headers: WebhookHeaders,
    secret: string,
    options?: WebhookVerifyOptions,
  ): WebhookEvent | WrongPayloadVersion {
    const body = toBytes(rawBody);
    if (headers === null || typeof headers !== 'object') {
      throw new WebhookVerificationError('missing_signature', 'headers must be a header collection');
    }
    const signature = singleHeader(headers, SIGNATURE_HEADER, 'X-Webhook-Signature');
    const timestamp = singleHeader(headers, TIMESTAMP_HEADER, 'X-Webhook-Timestamp');
    verifyBytes(body, signature, timestamp, secret, options);
    return readEvent(body);
  },

  /**
   * Same as `constructEvent`, with the two header values passed directly
   * (`X-Webhook-Signature`, `X-Webhook-Timestamp`).
   */
  constructEventFromValues(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    timestamp: string | null | undefined,
    secret: string,
    options?: WebhookVerifyOptions,
  ): WebhookEvent | WrongPayloadVersion {
    const body = toBytes(rawBody);
    verifyBytes(body, signature ?? null, timestamp ?? null, secret, options);
    return readEvent(body);
  },

  /**
   * Verifies a webhook from the two header values. Throws `WebhookVerificationError`;
   * returns nothing on success. Use it when your framework hands you the values directly.
   */
  verifySignature(
    rawBody: string | Uint8Array,
    signature: string | null | undefined,
    timestamp: string | null | undefined,
    secret: string,
    options?: WebhookVerifyOptions,
  ): void {
    verifyBytes(toBytes(rawBody), signature ?? null, timestamp ?? null, secret, options);
  },
} as const;
