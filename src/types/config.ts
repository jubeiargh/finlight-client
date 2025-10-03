export interface ApiClientConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
  retryCount?: number;
  wssUrl: string;
}

export const defaultApiConfig: ApiClientConfig = {
  baseUrl: 'https://api.finlight.me',
  timeout: 5000,
  retryCount: 3,
  apiKey: '',
  wssUrl: 'wss://wss.finlight.me',
};
