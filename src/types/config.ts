import { LogLevel } from '../logger';

export interface ApiClientConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
  retryCount?: number;
  wssUrl: string;
  /**
   * Logger instance - can be console, winston, pino, or any object with logging methods
   * @example logger: console
   * @example logger: winstonLogger
   * @example logger: { info: console.log, error: console.error }
   */
  logger?: unknown;
  logLevel?: LogLevel;
}

export const defaultApiConfig: ApiClientConfig = {
  baseUrl: 'https://api.finlight.me',
  timeout: 5000,
  retryCount: 3,
  apiKey: '',
  wssUrl: 'wss://wss.finlight.me',
};
