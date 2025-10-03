/**
 * API Integration Tests
 *
 * These tests require a valid API key in the FINLIGHT_API_KEY environment variable.
 * Run with: FINLIGHT_API_KEY=your_key npm test
 */

import { FinlightApi, noopLogger } from '../../index';

const API_KEY = process.env.FINLIGHT_API_KEY;
const TEST_TIMEOUT = 30000; // 30 seconds for API tests

describe('API Integration Tests', () => {
  if (!API_KEY) {
    it.skip('Skipping integration tests - FINLIGHT_API_KEY not set', () => {
      console.warn('⚠️  Set FINLIGHT_API_KEY environment variable to run integration tests');
    });
    return;
  }

  let client: FinlightApi;

  beforeEach(() => {
    client = new FinlightApi({
      apiKey: API_KEY!,
      logLevel: 'info',
    });
  });

  describe('Article Service', () => {
    it(
      'should fetch articles with basic query',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Tesla',
          pageSize: 5,
        });

        expect(response).toHaveProperty('articles');
        expect(Array.isArray(response.articles)).toBe(true);
        expect(response.articles.length).toBeGreaterThan(0);
        expect(response.articles.length).toBeLessThanOrEqual(5);

        // Validate article structure
        const article = response.articles[0];
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('link');
        expect(article).toHaveProperty('publishDate');
        expect(article.publishDate).toBeInstanceOf(Date);
      },
      TEST_TIMEOUT,
    );

    it(
      'should fetch articles with multiple tickers',
      async () => {
        const response = await client.articles.fetchArticles({
          tickers: ['AAPL', 'MSFT'],
          pageSize: 10,
        });

        expect(response.articles).toBeDefined();
        expect(response.articles.length).toBeGreaterThan(0);
        expect(response.articles.length).toBeLessThanOrEqual(10);
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle pagination',
      async () => {
        const firstPage = await client.articles.fetchArticles({
          query: 'Tesla',
          pageSize: 5,
          page: 1,
        });

        const secondPage = await client.articles.fetchArticles({
          query: 'Tesla',
          pageSize: 5,
          page: 2,
        });

        expect(firstPage.articles.length).toBeGreaterThan(0);
        expect(secondPage.articles.length).toBeGreaterThan(0);

        // Pages should have different articles
        const firstIds = firstPage.articles.map((a) => a.link);
        const secondIds = secondPage.articles.map((a) => a.link);
        const overlap = firstIds.filter((id) => secondIds.includes(id));
        expect(overlap.length).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'should filter articles by date range',
      async () => {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 7); // Last 7 days

        const response = await client.articles.fetchArticles({
          tickers: ['AAPL'],
          from: fromDate.toISOString().split('T')[0], // YYYY-MM-DD format
          to: toDate.toISOString().split('T')[0],
          pageSize: 10,
        });

        expect(response.articles.length).toBeGreaterThan(0);

        // Validate all articles are within date range
        response.articles.forEach((article) => {
          expect(article.publishDate.getTime()).toBeGreaterThanOrEqual(fromDate.getTime());
          expect(article.publishDate.getTime()).toBeLessThanOrEqual(toDate.getTime());
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'should filter articles by language',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Tesla',
          language: 'en',
          pageSize: 5,
        });

        expect(response.articles.length).toBeGreaterThan(0);

        // Validate language filter
        response.articles.forEach((article) => {
          if (article.language) {
            expect(article.language).toBe('en');
          }
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'should filter by specific sources',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Apple',
          sources: ['www.reuters.com', 'www.bloomberg.com'],
          pageSize: 5,
        });

        expect(response.articles).toBeDefined();
        expect(Array.isArray(response.articles)).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      'should exclude specific sources',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Microsoft',
          excludeSources: ['example.com'],
          pageSize: 5,
        });

        expect(response.articles).toBeDefined();
        response.articles.forEach((article) => {
          expect(article.source).not.toBe('example.com');
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'should include content when requested',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Tesla',
          includeContent: true,
          pageSize: 3,
        });

        expect(response.articles.length).toBeGreaterThan(0);

        // At least some articles should have content
        const articlesWithContent = response.articles.filter((a) => a.content);
        expect(articlesWithContent.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'should include entities when requested',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Apple Inc',
          includeEntities: true,
          pageSize: 5,
        });

        expect(response.articles.length).toBeGreaterThan(0);

        // At least some articles should have companies
        const articlesWithCompanies = response.articles.filter((a) => a.companies && a.companies.length > 0);
        expect(articlesWithCompanies.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  });

  describe('Source Service', () => {
    it(
      'should fetch available sources',
      async () => {
        const sources = await client.sources.getSources();

        expect(Array.isArray(sources)).toBe(true);
        expect(sources.length).toBeGreaterThan(0);

        // Validate source structure
        const source = sources[0];
        expect(source).toHaveProperty('domain');
        expect(source).toHaveProperty('isDefaultSource');
        expect(source).toHaveProperty('isContentAvailable');
      },
      TEST_TIMEOUT,
    );
  });

  describe('Error Handling', () => {
    it(
      'should handle invalid API key',
      async () => {
        const invalidClient = new FinlightApi({
          apiKey: 'invalid_key_12345',
          logger: noopLogger,
        });

        await expect(
          invalidClient.articles.fetchArticles({
            query: 'Tesla',
            pageSize: 5,
          }),
        ).rejects.toThrow();
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle network timeout',
      async () => {
        const timeoutClient = new FinlightApi({
          apiKey: API_KEY!,
          timeout: 1, // 1ms timeout to force timeout
          logger: noopLogger,
        });

        await expect(
          timeoutClient.articles.fetchArticles({
            query: 'Tesla',
            pageSize: 5,
          }),
        ).rejects.toThrow();
      },
      TEST_TIMEOUT,
    );
  });

  describe('Response Validation', () => {
    it(
      'should properly transform article dates',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Microsoft',
          pageSize: 3,
        });

        response.articles.forEach((article) => {
          expect(article.publishDate).toBeInstanceOf(Date);
          expect(article.publishDate.getTime()).not.toBeNaN();
          // Publish date should be in the past
          expect(article.publishDate.getTime()).toBeLessThanOrEqual(Date.now());
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'should properly transform company confidence values',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Apple',
          includeEntities: true,
          pageSize: 5,
        });

        response.articles.forEach((article) => {
          if (article.companies && article.companies.length > 0) {
            article.companies.forEach((company) => {
              if (company.confidence !== undefined) {
                expect(typeof company.confidence).toBe('number');
                expect(company.confidence).toBeGreaterThanOrEqual(0);
                expect(company.confidence).toBeLessThanOrEqual(1);
              }
            });
          }
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'should properly transform article confidence values',
      async () => {
        const response = await client.articles.fetchArticles({
          query: 'Tesla',
          pageSize: 5,
        });

        response.articles.forEach((article) => {
          if (article.confidence !== undefined) {
            expect(typeof article.confidence).toBe('number');
            expect(article.confidence).toBeGreaterThanOrEqual(0);
            expect(article.confidence).toBeLessThanOrEqual(1);
          }
        });
      },
      TEST_TIMEOUT,
    );
  });
});
