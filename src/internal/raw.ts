/**
 * Raw JSON access (R-MODELS-3). The original JSON tree is kept next to the decoded
 * object in a WeakMap, so no property on a wire-shaped object can collide with a
 * future wire key.
 */
const RAW = new WeakMap<object, unknown>();

export function attachRaw<T extends object>(target: T, raw: unknown): T {
  RAW.set(target, raw);
  return target;
}

/**
 * Returns the JSON tree exactly as the server sent it, for an `Article`, `StreamEvent`,
 * `WebhookEvent`, `WrongPayloadVersion`, `FinlightApiError`, `Company`, `EventTag`,
 * `CompanyRecord` or `Source` produced by this SDK. Unknown keys are reachable here.
 * Returns `undefined` for objects the SDK did not decode.
 */
export function rawJson(value: object): unknown {
  return RAW.get(value);
}
