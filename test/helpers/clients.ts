import { FinlightClient } from '../../src/client';
import type { FinlightClientConfig } from '../../src/config';
import { resolveConfig } from '../../src/config';
import { HttpTransport } from '../../src/http';
import { InstantClock } from './fake-clock';
import { KIT_API_KEY } from './kit';

export function restClient(
  baseUrl: string,
  overrides: Partial<FinlightClientConfig> = {},
): { client: FinlightClient; clock: InstantClock } {
  const clock = new InstantClock();
  const client = new FinlightClient({ apiKey: KIT_API_KEY, baseUrl, clock, ...overrides });
  return { client, clock };
}

export function transport(
  baseUrl: string,
  apiKey = KIT_API_KEY,
  overrides: Partial<FinlightClientConfig> = {},
): { http: HttpTransport; clock: InstantClock } {
  const clock = new InstantClock();
  const { config } = resolveConfig({ apiKey, baseUrl, clock, ...overrides });
  return { http: new HttpTransport(apiKey, config), clock };
}

/** Decoded query parameters as [name, value] pairs, sorted. */
export function queryPairs(query: string | undefined): Array<[string, string]> {
  return [...new URLSearchParams(query ?? '').entries()].sort(([a], [b]) => a.localeCompare(b));
}
