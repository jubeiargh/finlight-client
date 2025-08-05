import crypto from 'crypto';
import { WebhookService, WebhookVerificationError } from './webhookService';

describe('WebhookService', () => {
  const endpointSecret = 'test_secret_key';
  const validPayload = {
    eventId: 'evt_123',
    webhookId: 'whk_456',
    userId: 'usr_789',
    payload: { data: 'test data' },
    createdAt: '2024-01-01T00:00:00Z',
    retryCount: 0,
  };

  const createSignature = (payload: string, secret: string, timestamp?: string): string => {
    const message = timestamp ? `${timestamp}.${payload}` : payload;
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  };

  describe('constructEvent', () => {
    it('should successfully verify and construct event with valid signature and timestamp', () => {
      const rawBody = JSON.stringify(validPayload);
      const timestamp = new Date().toISOString();
      const signature = `sha256=${createSignature(rawBody, endpointSecret, timestamp)}`;

      const event = WebhookService.constructEvent(rawBody, signature, endpointSecret, timestamp);

      expect(event).toEqual(validPayload);
    });

    it('should successfully verify and construct event with valid signature without timestamp', () => {
      const rawBody = JSON.stringify(validPayload);
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;

      const event = WebhookService.constructEvent(rawBody, signature, endpointSecret);

      expect(event).toEqual(validPayload);
    });

    it('should work with signature without sha256= prefix', () => {
      const rawBody = JSON.stringify(validPayload);
      const timestamp = new Date().toISOString();
      const signature = createSignature(rawBody, endpointSecret, timestamp);

      const event = WebhookService.constructEvent(rawBody, signature, endpointSecret, timestamp);

      expect(event).toEqual(validPayload);
    });

    it('should throw error for invalid signature', () => {
      const rawBody = JSON.stringify(validPayload);
      const timestamp = new Date().toISOString();
      const invalidSignature = 'sha256=invalid_signature';

      expect(() => {
        WebhookService.constructEvent(rawBody, invalidSignature, endpointSecret, timestamp);
      }).toThrow(WebhookVerificationError);

      expect(() => {
        WebhookService.constructEvent(rawBody, invalidSignature, endpointSecret, timestamp);
      }).toThrow('Invalid webhook signature');
    });

    it('should throw error for mismatched secret', () => {
      const rawBody = JSON.stringify(validPayload);
      const timestamp = new Date().toISOString();
      const wrongSecret = 'wrong_secret';
      const signature = `sha256=${createSignature(rawBody, wrongSecret, timestamp)}`;

      expect(() => {
        WebhookService.constructEvent(rawBody, signature, endpointSecret, timestamp);
      }).toThrow('Invalid webhook signature');
    });

    it('should throw error for expired timestamp', () => {
      const rawBody = JSON.stringify(validPayload);
      const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 minutes ago
      const signature = `sha256=${createSignature(rawBody, endpointSecret, oldTimestamp)}`;

      expect(() => {
        WebhookService.constructEvent(rawBody, signature, endpointSecret, oldTimestamp);
      }).toThrow('Webhook timestamp outside allowed tolerance');
    });

    it('should accept timestamp within 5 minute tolerance', () => {
      const rawBody = JSON.stringify(validPayload);
      const recentTimestamp = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 minutes ago
      const signature = `sha256=${createSignature(rawBody, endpointSecret, recentTimestamp)}`;

      const event = WebhookService.constructEvent(rawBody, signature, endpointSecret, recentTimestamp);

      expect(event).toEqual(validPayload);
    });

    it('should throw error for invalid JSON payload', () => {
      const rawBody = 'invalid json';
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;

      expect(() => {
        WebhookService.constructEvent(rawBody, signature, endpointSecret);
      }).toThrow('Invalid JSON payload');
    });

    it('should handle payload with different data types', () => {
      const complexPayload = {
        eventId: 'evt_complex',
        webhookId: 'whk_complex',
        userId: 'usr_complex',
        payload: {
          string: 'test',
          number: 123,
          boolean: true,
          null: null,
          array: [1, 2, 3],
          nested: { key: 'value' },
        },
        createdAt: new Date().toISOString(),
        retryCount: 5,
      };

      const rawBody = JSON.stringify(complexPayload);
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;

      const event = WebhookService.constructEvent(rawBody, signature, endpointSecret);

      expect(event).toEqual(complexPayload);
    });

    it('should be case-sensitive for signatures', () => {
      const rawBody = JSON.stringify(validPayload);
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;
      const upperCaseSignature = signature.toUpperCase();

      expect(() => {
        WebhookService.constructEvent(rawBody, upperCaseSignature, endpointSecret);
      }).toThrow('Invalid webhook signature');
    });
  });
});
