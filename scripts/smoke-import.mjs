// ES module consumers: named imports from the CommonJS build work through Node's CJS interop.
import assert from 'node:assert';
import { FinlightClient, Webhooks, WrongPayloadVersion, PAYLOAD_VERSION, VERSION } from 'finlight-client';
import sdk from 'finlight-client';
assert.strictEqual(typeof FinlightClient, 'function');
assert.strictEqual(typeof Webhooks.verifySignature, 'function');
assert.strictEqual(typeof WrongPayloadVersion, 'function');
assert.strictEqual(PAYLOAD_VERSION, 3);
assert.strictEqual(sdk.FinlightClient, FinlightClient);
console.log(`esm ok (${VERSION})`);
