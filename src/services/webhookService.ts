import crypto from 'crypto';
import { Article } from '../types';
import { transformArticle } from '../utils';

const SIGNATURE_PREFIX = 'sha256=';
const REPLAY_ATTACK_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Custom error thrown when webhook verification fails.
 *
 * This can occur due to invalid signatures, expired timestamps,
 * or malformed payloads.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * Service for securely receiving and verifying webhook events from Finlight.
 *
 * Webhooks provide real-time notifications when new articles are published.
 * This service handles HMAC signature verification and replay attack protection.
 */
export class WebhookService {
  /**
   * Constructs and verifies a webhook event from raw request data.
   *
   * Verifies the HMAC-SHA256 signature to ensure the webhook came from Finlight
   * and hasn't been tampered with. Optionally validates the timestamp to prevent
   * replay attacks (5 minute tolerance window).
   *
   * @param rawBody - The raw request body as a string (must be unparsed)
   * @param signature - The signature from the `X-Webhook-Signature` header
   * @param endpointSecret - Your webhook endpoint secret from the Finlight dashboard
   * @param timestamp - Optional timestamp from the `X-Webhook-Timestamp` header for replay protection
   *
   * @returns The verified and parsed article object
   *
   * @throws {WebhookVerificationError} If verification fails
   *
   * @example
   * ```typescript
   * // Express.js webhook endpoint
   * app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
   *   try {
   *     const article = WebhookService.constructEvent(
   *       req.body.toString(),
   *       req.headers['x-webhook-signature'],
   *       process.env.WEBHOOK_SECRET,
   *       req.headers['x-webhook-timestamp']
   *     );
   *     console.log('New article:', article.title);
   *     res.sendStatus(200);
   *   } catch (err) {
   *     res.sendStatus(400);
   *   }
   * });
   * ```
   */
  static constructEvent(rawBody: string, signature: string, endpointSecret: string, timestamp?: string): Article {
    const normalizedSignature = this.normalizeSignature(signature);

    this.verifySignature(rawBody, normalizedSignature, endpointSecret, timestamp);

    if (timestamp) {
      this.verifyTimestamp(timestamp);
    }

    return this.parsePayload(rawBody);
  }

  private static normalizeSignature(signature: string): string {
    return signature.replace(SIGNATURE_PREFIX, '');
  }

  private static verifySignature(payload: string, signature: string, secret: string, timestamp?: string): void {
    const expectedSignature = timestamp
      ? this.computeSignatureWithTimestamp(payload, secret, timestamp)
      : this.computeSignature(payload, secret);

    if (!this.secureCompare(signature, expectedSignature)) {
      throw new WebhookVerificationError('Invalid webhook signature');
    }
  }

  private static verifyTimestamp(timestamp: string): void {
    const webhookTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    const timeDifference = Math.abs(currentTime - webhookTime);

    if (timeDifference > REPLAY_ATTACK_TOLERANCE_MS) {
      throw new WebhookVerificationError('Webhook timestamp outside allowed tolerance');
    }
  }

  private static parsePayload(rawBody: string): Article {
    try {
      const parsed = JSON.parse(rawBody);
      return transformArticle(parsed);
    } catch (error) {
      throw new WebhookVerificationError('Invalid JSON payload');
    }
  }

  private static computeSignatureWithTimestamp(payload: string, secret: string, timestamp: string): string {
    const message = `${timestamp}.${payload}`;
    return this.computeSignature(message, secret);
  }

  private static computeSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
