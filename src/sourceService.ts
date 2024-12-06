import { ApiClient } from './apiClient';

export class SourceService {
  constructor(private apiClient: ApiClient) {}

  /**
   * Fetch all sources
   */
  async getSources(): Promise<string[]> {
    return this.apiClient.request<string[]>('GET', '/v1/sources');
  }
}
