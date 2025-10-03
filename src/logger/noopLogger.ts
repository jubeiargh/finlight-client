import { Logger } from './types';

/**
 * No-op logger that silently discards all log messages
 * Used as the default logger to avoid polluting console
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
