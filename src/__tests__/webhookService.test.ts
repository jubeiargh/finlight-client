import crypto from 'crypto';
import { WebhookService, WebhookVerificationError } from '../services/webhookService';

describe('WebhookService', () => {
  const endpointSecret = 'test_secret_key';
  const validPayload = {
    link: 'https://example.com/article',
    title: 'Test Article',
    publishDate: '2024-01-01T00:00:00Z',
    authors: 'John Doe',
    source: 'example.com',
    language: 'en',
    sentiment: 'positive',
    confidence: '0.95',
    summary: 'This is a test article',
    companies: [
      {
        companyId: 1,
        confidence: '0.90',
        name: 'Apple Inc.',
        ticker: 'AAPL',
        exchange: 'NASDAQ',
      },
    ],
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

      const article = WebhookService.constructEvent(rawBody, signature, endpointSecret, timestamp);

      expect(article.title).toBe(validPayload.title);
      expect(article.link).toBe(validPayload.link);
      expect(article.publishDate).toBeInstanceOf(Date);
      expect(article.publishDate.getTime()).toBe(new Date(validPayload.publishDate).getTime());
      expect(article.confidence).toBe(0.95);
      expect(article.companies?.[0].confidence).toBe(0.9);
    });

    it('should successfully verify and construct event with valid signature without timestamp', () => {
      const rawBody = JSON.stringify(validPayload);
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;

      const article = WebhookService.constructEvent(rawBody, signature, endpointSecret);

      expect(article.title).toBe(validPayload.title);
      expect(article.publishDate).toBeInstanceOf(Date);
      expect(article.confidence).toBe(0.95);
    });

    it('should work with signature without sha256= prefix', () => {
      const rawBody = JSON.stringify(validPayload);
      const timestamp = new Date().toISOString();
      const signature = createSignature(rawBody, endpointSecret, timestamp);

      const article = WebhookService.constructEvent(rawBody, signature, endpointSecret, timestamp);

      expect(article.title).toBe(validPayload.title);
      expect(article.publishDate).toBeInstanceOf(Date);
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

      const article = WebhookService.constructEvent(rawBody, signature, endpointSecret, recentTimestamp);

      expect(article.title).toBe(validPayload.title);
      expect(article.publishDate).toBeInstanceOf(Date);
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
        link: 'https://example.com/complex-article',
        title: 'Complex Article with Multiple Companies',
        publishDate: '2024-01-01T12:30:00Z',
        authors: 'Jane Smith, Bob Johnson',
        source: 'financial-news.com',
        language: 'en',
        sentiment: 'neutral',
        confidence: '0.85',
        summary: 'A comprehensive analysis of market trends',
        images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
        content: 'Full article content here...',
        companies: [
          {
            companyId: 1,
            confidence: '0.95',
            country: 'US',
            exchange: 'NASDAQ',
            industry: 'Technology',
            sector: 'Software',
            name: 'Apple Inc.',
            ticker: 'AAPL',
            isin: 'US0378331005',
            openfigi: 'BBG000B9XRY4',
          },
          {
            companyId: 2,
            confidence: '0.88',
            name: 'Microsoft Corporation',
            ticker: 'MSFT',
          },
        ],
      };

      const rawBody = JSON.stringify(complexPayload);
      const signature = `sha256=${createSignature(rawBody, endpointSecret)}`;

      const article = WebhookService.constructEvent(rawBody, signature, endpointSecret);

      expect(article.title).toBe(complexPayload.title);
      expect(article.companies).toHaveLength(2);
      expect(article.companies?.[0].confidence).toBe(0.95);
      expect(article.companies?.[1].confidence).toBe(0.88);
      expect(article.publishDate).toBeInstanceOf(Date);
      expect(article.confidence).toBe(0.85);
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
