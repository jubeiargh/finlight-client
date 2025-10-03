# Integration Tests

Integration tests for Finlight API and WebSocket services.

## Setup

Set your API key:

```bash
export FINLIGHT_API_KEY=your_key
```

## Running Tests

```bash
# All integration tests
FINLIGHT_API_KEY=your_key npm run test:integration

# API only
FINLIGHT_API_KEY=your_key npm run test:integration -- api.integration

# WebSocket only
FINLIGHT_API_KEY=your_key npm run test:integration -- websocket.integration
```
