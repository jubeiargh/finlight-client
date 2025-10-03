import { ApiClient } from '../client/apiClient';
import { Source } from '../types';

/**
 * Service for managing and querying available news sources.
 */
export class SourceService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Retrieves all available news sources with their configuration.
   *
   * Returns metadata for each source including domain, content availability,
   * and whether it's included in the default source set.
   *
   * @returns Promise resolving to an array of all available news sources
   *
   * @throws {Error} If the API request fails
   *
   * @example
   * ```typescript
   * const sources = await sourceService.getSources();
   * const defaults = sources.filter(s => s.isDefaultSource);
   * ```
   */
  async getSources(): Promise<Source[]> {
    return this.apiClient.request<Source[]>('GET', '/v2/sources');
  }
}
