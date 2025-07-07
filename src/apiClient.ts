import axios, { AxiosInstance } from 'axios';
import { ApiClientConfig } from './config';

export class ApiClient {
  private client: AxiosInstance;

  constructor(private config: ApiClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: { 'X-API-KEY': config.apiKey },
    });
  }

  async request<T>(method: 'GET' | 'POST', url: string, data?: any): Promise<T> {
    let attempts = 0;
    const maxRetries = this.config.retryCount ?? 3;

    while (attempts < maxRetries) {
      try {
        const response = await this.client.request<T>({
          method,
          url,
          data,
        });
        return response.data;
      } catch (error) {
        attempts++;

        // Exit if max retries are reached or the error is non-retryable
        if (attempts === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }

        // Wait for some time before retrying
        const waitTime = this.calculateBackoff(attempts);
        console.warn(`Retrying (${attempts}/${maxRetries}) after ${waitTime}ms:`, (error as Error).message);
        await this.delay(waitTime);
      }
    }

    throw new Error('Max retries reached');
  }

  private isRetryableError(error: any): boolean {
    return [429, 500, 502, 503, 504].includes(error.response?.status);
  }

  private calculateBackoff(attempt: number): number {
    const baseWait = 500; // Base wait time in milliseconds
    return baseWait * Math.pow(2, attempt - 1); // Exponential backoff (e.g., 500ms, 1000ms, 2000ms)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
