import { ApiClient } from './apiClient';
import { Source } from './types';

export class SourceService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Fetch all sources
   */
  async getSources(): Promise<Source[]> {
    return this.apiClient.request<Source[]>('GET', '/v2/sources');
  }
}
