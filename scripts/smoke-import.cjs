// CommonJS consumers: require('finlight-client') resolves through the exports map.
const assert = require('assert');
const sdk = require('finlight-client');
assert.strictEqual(typeof sdk.FinlightClient, 'function');
assert.strictEqual(typeof sdk.Webhooks.constructEvent, 'function');
assert.strictEqual(sdk.PAYLOAD_VERSION, 3);
const client = new sdk.FinlightClient({ apiKey: 'k' });
assert.ok(client.articles && client.companies && client.sources);
console.log(`cjs ok (${sdk.VERSION})`);
