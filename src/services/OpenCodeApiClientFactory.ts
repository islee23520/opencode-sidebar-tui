import * as vscode from "vscode";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import { InstanceId } from "./InstanceStore";

/**
 * Configuration for OpenCodeApiClient instances
 */
export interface ClientConfig {
  maxRetries?: number;
  baseDelay?: number;
  timeoutMs?: number;
}

/**
 * Factory service for managing multiple OpenCodeApiClient instances.
 *
 * Manages a pool of HTTP clients keyed by instanceId, enabling
 * per-instance communication with OpenCode CLI servers.
 *
 * @implements vscode.Disposable
 */
export class OpenCodeApiClientFactory implements vscode.Disposable {
  private readonly clientPool: Map<InstanceId, OpenCodeApiClient> = new Map();
  private readonly defaultConfig: ClientConfig;

  /**
   * Creates a new OpenCodeApiClientFactory
   * @param defaultConfig - Default configuration for new clients (optional)
   */
  constructor(defaultConfig?: ClientConfig) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Creates or replaces a client for the given instance.
   *
   * If a client already exists for this instanceId, it will be disposed
   * and replaced with a new one.
   *
   * @param instanceId - The instance identifier
   * @param port - The port number for the OpenCode CLI HTTP server
   * @returns The created OpenCodeApiClient
   */
  public createClient(instanceId: InstanceId, port: number): OpenCodeApiClient {
    // Dispose existing client if it exists
    if (this.clientPool.has(instanceId)) {
      this.disposeClient(instanceId);
    }

    // Create new client with default config merged
    const client = new OpenCodeApiClient(
      port,
      this.defaultConfig.maxRetries,
      this.defaultConfig.baseDelay,
      this.defaultConfig.timeoutMs,
    );

    this.clientPool.set(instanceId, client);
    return client;
  }

  /**
   * Retrieves an existing client for the given instance.
   *
   * @param instanceId - The instance identifier
   * @returns The OpenCodeApiClient if it exists, undefined otherwise
   */
  public getClient(instanceId: InstanceId): OpenCodeApiClient | undefined {
    return this.clientPool.get(instanceId);
  }

  /**
   * Checks if a client exists for the given instance.
   *
   * @param instanceId - The instance identifier
   * @returns true if a client exists, false otherwise
   */
  public hasClient(instanceId: InstanceId): boolean {
    return this.clientPool.has(instanceId);
  }

  /**
   * Disposes and removes the client for the given instance.
   *
   * @param instanceId - The instance identifier
   */
  public disposeClient(instanceId: InstanceId): void {
    this.clientPool.delete(instanceId);
  }

  /**
   * Disposes all clients in the pool and clears the pool.
   *
   * This is typically called during extension deactivation or when
   * shutting down all instances.
   */
  public dispose(): void {
    this.clientPool.clear();
  }
}
