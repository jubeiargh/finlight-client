import type { CallOptions } from './articles';
import { withSkipped } from './companies';
import { decodeEntries, decodeSource, envelopeField, toDecodeError } from './decode';
import type { HttpTransport } from './http';
import type { SourceList } from './models';
import { checkOptions } from './params';

export class SourcesService {
  constructor(private readonly http: HttpTransport) {}

  /** The full source catalog, sorted by domain. Costs 1 credit per request, errors included. */
  async list(options?: CallOptions): Promise<SourceList> {
    const opts = checkOptions(options, ['signal'], 'sources.list');
    const res = await this.http.request({
      method: 'GET',
      path: '/v3/sources',
      signal: opts.signal as AbortSignal | undefined,
    });
    try {
      const { items, skipped } = decodeEntries(
        envelopeField(res.body, 'sources'),
        'sources',
        decodeSource,
        this.http.config.log,
      );
      return withSkipped(items, skipped);
    } catch (err) {
      throw toDecodeError(err, res.body);
    }
  }
}
