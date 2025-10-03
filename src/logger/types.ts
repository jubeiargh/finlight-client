/**
 * Log level enumeration
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface that library users can implement
 * All methods are optional to allow partial implementations
 */
export interface Logger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}
