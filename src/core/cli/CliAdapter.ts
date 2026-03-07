import type { CliAdapterEvents, CliConfig, CliInstance } from "./types";

/**
 * Unified lifecycle contract implemented by each CLI tool adapter.
 */
export interface CliAdapter {
  /**
   * Starts a CLI process with tool-specific configuration and returns
   * runtime metadata for the launched instance.
   *
   * @param config - Startup configuration for the CLI instance.
   * @returns Promise resolved with created instance metadata.
   */
  start(config: CliConfig): Promise<CliInstance>;

  /**
   * Stops a running CLI process and releases all associated resources.
   *
   * @param instanceId - Unique instance id to stop.
   */
  stop(instanceId: string): Promise<void>;

  /**
   * Sends raw terminal input data to a running CLI process.
   *
   * @param instanceId - Target instance id receiving input.
   * @param data - Terminal input payload.
   */
  writeInput(instanceId: string, data: string): void;

  /**
   * Resizes the terminal session for a running CLI process.
   *
   * @param instanceId - Target instance id.
   * @param cols - Terminal width in columns.
   * @param rows - Terminal height in rows.
   */
  resize(instanceId: string, cols: number, rows: number): void;

  /**
   * Verifies whether the CLI instance is healthy and responsive.
   *
   * @param instanceId - Target instance id.
   * @returns Promise resolved with true if healthy, false otherwise.
   */
  healthCheck(instanceId: string): Promise<boolean>;

  /**
   * Returns the HTTP API port associated with a CLI instance when available.
   *
   * @param instanceId - Target instance id.
   * @returns Port number if available, otherwise undefined.
   */
  getPort(instanceId: string): number | undefined;

  /**
   * Event callback invoked when a CLI instance emits terminal output.
   */
  onData: CliAdapterEvents["onData"];

  /**
   * Event callback invoked when a CLI instance exits.
   */
  onExit: CliAdapterEvents["onExit"];

  /**
   * Event callback invoked when a CLI instance reports an error.
   */
  onError: CliAdapterEvents["onError"];

  /**
   * Event callback invoked when a CLI instance becomes ready.
   */
  onReady: CliAdapterEvents["onReady"];
}
