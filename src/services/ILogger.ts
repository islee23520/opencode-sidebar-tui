/**
 * Logger interface for extension-host services.
 * Implementations gate output behind configurable log levels.
 */
export interface ILogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
}
