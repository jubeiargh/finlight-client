import crypto from 'crypto';
import { Article } from './types';
import { transformArticle } from './utils';

const SIGNATURE_PREFIX = 'sha256=';
const REPLAY_ATTACK_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export class WebhookService {
  /**
   * Constructs and verifies a webhook event from the raw request data.
   *
   * @param rawBody - The raw request body as a string
   * @param signature - The signature from the X-Webhook-Signature header
   * @param endpointSecret - The webhook endpoint secret
   * @param timestamp - Optional timestamp from the X-Webhook-Timestamp header for replay protection
   * @returns The verified article
   * @throws {WebhookVerificationError} If verification fails
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
