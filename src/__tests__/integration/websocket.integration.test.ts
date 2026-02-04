/**
 * WebSocket Integration Tests
 *
 * These tests require a valid API key in the FINLIGHT_API_KEY environment variable.
 * Run with: FINLIGHT_API_KEY=your_key npm test
 */

import { FinlightApi } from '../../index';
import { Article } from '../../types';

const API_KEY = process.env.FINLIGHT_API_KEY;
const TEST_TIMEOUT = 120000; // 2 minutes for integration tests

describe('WebSocket Integration Tests', () => {
  if (!API_KEY) {
    it.skip('Skipping integration tests - FINLIGHT_API_KEY not set', () => {
      console.warn('⚠️  Set FINLIGHT_API_KEY environment variable to run integration tests');
    });
    return;
  }

  let client: FinlightApi;

  afterEach(() => {
    // Always cleanup after each test, even if it fails
    if (client && client.websocket) {
      client.websocket.stop();
    }
  });

  describe('Connection and Basic Operations', () => {
    it(
      'should successfully connect to WebSocket',
      async () => {
        client = new FinlightApi({
          apiKey: API_KEY!,
          logLevel: 'info',
        });

        let connected = false;
        const articles: Article[] = [];

        void client.websocket.connect(
          {
            query: 'Tesla',
            tickers: ['TSLA'],
          },
          (article) => {
            connected = true;
            articles.push(article);
          },
        );

        // Wait for connection and first message
        await new Promise((resolve) => setTimeout(resolve, 5000));

        expect(connected).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      'should receive ping/pong messages',
      async () => {
        const mockDebug = jest.fn();

        client = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: mockDebug,
            info: console.info,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'debug',
        });

        void client.websocket.connect(
          {
            query: 'Apple',
            tickers: ['AAPL'],
          },
          () => {},
        );

        // Wait for at least one ping/pong cycle (ping interval is 25s by default)
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // Check if PONG was received
        const pongCalls = mockDebug.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('PONG received')),
        );

        expect(pongCalls.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it.skip(
      'should receive at least one article via sendArticle event',
      async () => {
        client = new FinlightApi({
          apiKey: API_KEY!,
          logLevel: 'info',
        });

        const articles: Article[] = [];

        void client.websocket.connect({}, (article) => {
          articles.push(article);
        });

        // Wait up to 60 seconds for at least one article
        const maxWait = 60000;
        const checkInterval = 1000;
        let waited = 0;

        while (articles.length === 0 && waited < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          waited += checkInterval;
        }

        expect(articles.length).toBeGreaterThan(0);

        // Validate article structure
        const article = articles[0];
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('link');
        expect(article).toHaveProperty('publishDate');
        expect(article.publishDate).toBeInstanceOf(Date);
      },
      TEST_TIMEOUT,
    );
  });

  describe('Connection Rotation', () => {
    it(
      'should successfully rotate connection proactively',
      async () => {
        const mockInfo = jest.fn();

        client = new FinlightApi(
          {
            apiKey: API_KEY!,
            logger: {
              debug: console.debug,
              info: mockInfo,
              warn: console.warn,
              error: console.error,
            },
            logLevel: 'info',
          },
          {
            connectionLifetime: 10, // 10 seconds for testing
            pingInterval: 5, // 5 seconds
          },
        );

        void client.websocket.connect(
          {
            query: 'Apple',
            tickers: ['AAPL'],
          },
          () => {},
        );

        // Wait for rotation (10s) + some buffer
        await new Promise((resolve) => setTimeout(resolve, 15000));

        // Check for proactive rotation
        const rotationCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('Proactive rotation')),
        );

        // Check for reconnection attempt
        const reconnectCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('Attempting to connect')),
        );

        expect(rotationCalls.length).toBeGreaterThan(0);
        expect(reconnectCalls.length).toBeGreaterThan(1); // Initial + after rotation
      },
      TEST_TIMEOUT,
    );
  });

  describe('Reconnection Handling', () => {
    it(
      'should automatically reconnect when connection dies',
      async () => {
        const mockInfo = jest.fn();

        client = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: console.debug,
            info: mockInfo,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'info',
        });

        void client.websocket.connect(
          {
            query: 'Tesla',
            tickers: ['TSLA'],
          },
          () => {},
        );

        // Wait for initial connection
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Check initial connection
        let connectedCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('✅ Connected.')),
        );
        expect(connectedCalls.length).toBe(1);

        // Access the private webSocket to forcefully close it (simulating network failure)
        // @ts-expect-error - accessing private property for testing
        const ws = client.websocket.webSocket;
        if (ws) {
          ws.close();
        }

        // Wait for reconnection
        await new Promise((resolve) => setTimeout(resolve, 10000));

        // Check reconnection happened
        connectedCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('✅ Connected.')),
        );
        expect(connectedCalls.length).toBeGreaterThan(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle manual disconnect and reconnect',
      async () => {
        client = new FinlightApi({
          apiKey: API_KEY!,
          logLevel: 'info',
        });

        let firstConnection = false;

        // First connection
        void client.websocket.connect(
          {
            query: 'Tesla',
            tickers: ['TSLA'],
          },
          () => {
            firstConnection = true;
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));
        expect(firstConnection).toBe(true);

        // Disconnect
        client.websocket.stop();
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Reconnect with new client
        client = new FinlightApi({
          apiKey: API_KEY!,
          logLevel: 'info',
        });

        let secondConnection = false;

        void client.websocket.connect(
          {
            query: 'Apple',
            tickers: ['AAPL'],
          },
          () => {
            secondConnection = true;
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));
        expect(secondConnection).toBe(true);
      },
      TEST_TIMEOUT,
    );
  });

  describe('Error Handling', () => {
    it(
      'should handle invalid API key gracefully',
      async () => {
        const mockError = jest.fn();

        client = new FinlightApi({
          apiKey: 'invalid_key',
          logger: {
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: mockError,
          },
          logLevel: 'error',
        });

        void client.websocket.connect(
          {
            query: 'Tesla',
            tickers: ['TSLA'],
          },
          () => {},
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Should have logged errors
        expect(mockError.mock.calls.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  });
});

describe('RawWebSocket Integration Tests', () => {
  if (!API_KEY) {
    it.skip('Skipping integration tests - FINLIGHT_API_KEY not set', () => {
      console.warn('⚠️  Set FINLIGHT_API_KEY environment variable to run integration tests');
    });
    return;
  }

  let client: FinlightApi;

  afterEach(() => {
    // Always cleanup after each test, even if it fails
    if (client && client.rawWebsocket) {
      client.rawWebsocket.stop();
    }
  });

  describe('Basic Connection', () => {
    it(
      'should successfully connect to Raw WebSocket endpoint',
      async () => {
        const mockInfo = jest.fn();

        client = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: console.debug,
            info: mockInfo,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'info',
        });

        void client.rawWebsocket.connect({}, () => {});

        // Wait for connection
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Check for successful connection with [Raw] prefix
        const connectedCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('[Raw] Connected.')),
        );

        expect(connectedCalls.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'should receive ping/pong messages with [Raw] prefix',
      async () => {
        const mockDebug = jest.fn();

        client = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: mockDebug,
            info: console.info,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'debug',
        });

        void client.rawWebsocket.connect({}, () => {});

        // Wait for at least one ping/pong cycle
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // Check if PONG was received with [Raw] prefix
        const pongCalls = mockDebug.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('[Raw] PONG received')),
        );

        expect(pongCalls.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  });

  describe('Connection Management', () => {
    it(
      'should handle manual disconnect gracefully',
      async () => {
        const mockInfo = jest.fn();

        client = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: console.debug,
            info: mockInfo,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'info',
        });

        let messageCount = 0;

        void client.rawWebsocket.connect({}, () => {
          messageCount++;
        });

        // Wait for connection
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Verify connection was established
        const connectedCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('[Raw] Connected.')),
        );
        expect(connectedCalls.length).toBeGreaterThan(0);

        // Disconnect
        client.rawWebsocket.stop();

        // Wait a moment
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify connection was closed
        const closedCalls = mockInfo.mock.calls.filter((call) =>
          call.some((arg) => String(arg).includes('[Raw] Connection closed')),
        );
        expect(closedCalls.length).toBeGreaterThan(0);

        // Should not receive new messages after disconnect
        const messagesBeforeStop = messageCount;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        expect(messageCount).toBe(messagesBeforeStop);
      },
      TEST_TIMEOUT,
    );

    it(
      'should verify base class shared functionality',
      async () => {
        const mockInfoRegular = jest.fn();
        const mockInfoRaw = jest.fn();

        const regularClient = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: console.debug,
            info: mockInfoRegular,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'info',
        });

        const rawClient = new FinlightApi({
          apiKey: API_KEY!,
          logger: {
            debug: console.debug,
            info: mockInfoRaw,
            warn: console.warn,
            error: console.error,
          },
          logLevel: 'info',
        });

        // Start both connections
        void regularClient.websocket.connect({ query: 'Tesla', tickers: ['TSLA'] }, () => {});
        void rawClient.rawWebsocket.connect({}, () => {});

        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Verify both connected (checking for the connection messages)
        const regularConnected = mockInfoRegular.mock.calls.some((call) =>
          call.some((arg) => String(arg).includes('Connected.') && !String(arg).includes('[Raw]')),
        );
        const rawConnected = mockInfoRaw.mock.calls.some((call) =>
          call.some((arg) => String(arg).includes('[Raw] Connected.')),
        );

        expect(regularConnected).toBe(true);
        expect(rawConnected).toBe(true);

        // Cleanup
        regularClient.websocket.stop();
        rawClient.rawWebsocket.stop();
      },
      TEST_TIMEOUT,
    );
  });
});
