import { FinlightClient } from 'finlight-client';

/** Shared setup for the examples: the key and optional URL overrides come from the environment. */
export function createClient(): FinlightClient {
  const apiKey = process.env.FINLIGHT_API_KEY;
  if (!apiKey) throw new Error('Set FINLIGHT_API_KEY');
  return new FinlightClient({
    apiKey,
    ...(process.env.FINLIGHT_BASE_URL ? { baseUrl: process.env.FINLIGHT_BASE_URL } : {}),
    ...(process.env.FINLIGHT_WSS_URL ? { wssUrl: process.env.FINLIGHT_WSS_URL } : {}),
  });
}
