import { debuglog } from 'node:util';

/**
 * Minimal logger interface. `console`, pino, winston and most other loggers fit it.
 * Every method is optional.
 */
export interface Logger {
  debug?: (message: string, ...meta: unknown[]) => void;
  info?: (message: string, ...meta: unknown[]) => void;
  warn?: (message: string, ...meta: unknown[]) => void;
  error?: (message: string, ...meta: unknown[]) => void;
}

/** Internal logger with every level present. */
export interface InternalLogger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const LOGGER_NAME = 'finlight';

/**
 * Without a configured logger the SDK uses Node's `util.debuglog('finlight')`:
 * silent unless the process runs with `NODE_DEBUG=finlight`.
 */
function defaultLogger(): InternalLogger {
  const log = debuglog(LOGGER_NAME);
  return {
    debug: (m, ...meta) => log(`DEBUG ${m}`, ...meta),
    info: (m, ...meta) => log(`INFO ${m}`, ...meta),
    warn: (m, ...meta) => log(`WARN ${m}`, ...meta),
    error: (m, ...meta) => log(`ERROR ${m}`, ...meta),
  };
}

export function createLogger(logger: Logger | undefined): InternalLogger {
  if (!logger) return defaultLogger();
  const call =
    (level: keyof Logger) =>
    (message: string, ...meta: unknown[]): void => {
      const fn = logger[level];
      if (typeof fn !== 'function') return;
      try {
        fn.call(logger, `[${LOGGER_NAME}] ${message}`, ...meta);
      } catch {
        // A failing user logger must never break the SDK.
      }
    };
  return { debug: call('debug'), info: call('info'), warn: call('warn'), error: call('error') };
}
