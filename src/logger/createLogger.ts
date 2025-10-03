import { Logger, LogLevel } from './types';
import { noopLogger } from './noopLogger';

/**
 * Level ordering for filtering
 */
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Normalizes any logger-like object to our Logger interface
 * Supports console, winston, pino, and other popular loggers
 *
 * @param loggerLike - Any object with logging methods
 * @returns Normalized logger
 */
function normalizeLogger(loggerLike: unknown): Logger {
  if (!loggerLike || typeof loggerLike !== 'object') {
    return noopLogger;
  }

  const obj = loggerLike as Record<string, unknown>;

  // Extract methods and bind them to preserve context
  const logger: Logger = {};

  if (typeof obj.debug === 'function') {
    logger.debug = obj.debug.bind(loggerLike);
  }
  if (typeof obj.info === 'function') {
    logger.info = obj.info.bind(loggerLike);
  }
  if (typeof obj.warn === 'function') {
    logger.warn = obj.warn.bind(loggerLike);
  }
  if (typeof obj.error === 'function') {
    logger.error = obj.error.bind(loggerLike);
  }

  // Fallback: if only 'log' method exists, use it for all levels
  if (!logger.debug && !logger.info && !logger.warn && !logger.error && typeof obj.log === 'function') {
    const logFn = obj.log.bind(loggerLike);
    logger.debug = logFn;
    logger.info = logFn;
    logger.warn = logFn;
    logger.error = logFn;
  }

  return Object.keys(logger).length > 0 ? logger : noopLogger;
}

/**
 * Creates a filtered logger that respects the minimum log level
 * Accepts console, winston, pino, or any compatible logger
 *
 * @param userLogger - Logger implementation (can be console, winston, pino, etc.)
 * @param minLevel - Minimum log level to output (default: 'info')
 * @returns Filtered logger instance
 *
 * @example
 * // Use console directly
 * const logger = createLogger(console, 'debug');
 *
 * // Use winston
 * const logger = createLogger(winstonLogger, 'info');
 *
 * // Use custom logger
 * const logger = createLogger({ info: console.log }, 'info');
 */
export function createLogger(userLogger: unknown = noopLogger, minLevel: LogLevel = 'info'): Logger {
  const normalized = normalizeLogger(userLogger);
  const minLevelValue = LOG_LEVEL_ORDER[minLevel];

  return {
    debug: (...args: unknown[]) => {
      if (LOG_LEVEL_ORDER.debug >= minLevelValue) {
        normalized.debug?.(...args);
      }
    },
    info: (...args: unknown[]) => {
      if (LOG_LEVEL_ORDER.info >= minLevelValue) {
        normalized.info?.(...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (LOG_LEVEL_ORDER.warn >= minLevelValue) {
        normalized.warn?.(...args);
      }
    },
    error: (...args: unknown[]) => {
      if (LOG_LEVEL_ORDER.error >= minLevelValue) {
        normalized.error?.(...args);
      }
    },
  };
}
