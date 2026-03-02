import * as vscode from "vscode";
import { InstanceId, InstanceState, InstanceStore } from "./InstanceStore";
import { OpenCodeApiClientFactory } from "./OpenCodeApiClientFactory";

const FAILURE_THRESHOLD = 3;

/**
 * Polls per-instance OpenCode health and applies state transitions.
 */
export class HealthPoller implements vscode.Disposable {
  private readonly intervals = new Map<InstanceId, NodeJS.Timeout>();
  private readonly failureCounts = new Map<InstanceId, number>();
  private readonly skippedStates: readonly InstanceState[] = [
    "stopping",
    "spawning",
  ];

  constructor(
    private readonly instanceStore: InstanceStore,
    private readonly clientFactory: OpenCodeApiClientFactory,
    private readonly intervalMs: number = 10_000,
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  /**
   * Starts health polling for a specific instance.
   *
   * Polling is skipped when the instance is unknown, already being polled,
   * or currently in a non-checkable lifecycle state.
   *
   * @param instanceId - Target instance identifier.
   */
  public start(instanceId: InstanceId): void {
    if (this.intervals.has(instanceId)) {
      return;
    }

    const instance = this.instanceStore.get(instanceId);
    if (!instance || this.skippedStates.includes(instance.state)) {
      return;
    }

    const intervalId = setInterval(() => {
      void this.checkHealth(instanceId);
    }, this.intervalMs);

    this.intervals.set(instanceId, intervalId);
  }

  /**
   * Stops health polling for a specific instance.
   * @param instanceId - Target instance identifier.
   */
  public stop(instanceId: InstanceId): void {
    const intervalId = this.intervals.get(instanceId);
    if (!intervalId) {
      return;
    }

    clearInterval(intervalId);
    this.intervals.delete(instanceId);
    this.failureCounts.delete(instanceId);
  }

  /**
   * Stops health polling for all instances.
   */
  public stopAll(): void {
    for (const intervalId of this.intervals.values()) {
      clearInterval(intervalId);
    }

    this.intervals.clear();
    this.failureCounts.clear();
  }

  /**
   * Releases all resources owned by the poller.
   */
  public dispose(): void {
    this.stopAll();
  }

  private async checkHealth(instanceId: InstanceId): Promise<void> {
    const instance = this.instanceStore.get(instanceId);
    if (!instance?.runtime.port) {
      return;
    }

    try {
      const client = this.clientFactory.createClient(
        instanceId,
        instance.runtime.port,
      );
      const healthy = await client.healthCheck();

      if (healthy) {
        this.handleSuccess(instanceId);
        return;
      }

      this.handleFailure(instanceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel?.appendLine(
        `[HealthPoller] Health check failed for '${instanceId}': ${message}`,
      );
      this.handleFailure(instanceId);
    }
  }

  private handleFailure(instanceId: InstanceId): void {
    const instance = this.instanceStore.get(instanceId);
    if (!instance) {
      return;
    }

    const nextFailureCount = (this.failureCounts.get(instanceId) ?? 0) + 1;
    this.failureCounts.set(instanceId, nextFailureCount);

    if (
      nextFailureCount >= FAILURE_THRESHOLD &&
      instance.state === "connected"
    ) {
      this.instanceStore.upsert({
        ...instance,
        state: "error",
        error: "Health check failed 3 consecutive times",
        health: {
          ...instance.health,
          ok: false,
        },
      });
      return;
    }

    this.instanceStore.upsert({
      ...instance,
      health: {
        ...instance.health,
        ok: false,
      },
    });
  }

  private handleSuccess(instanceId: InstanceId): void {
    const instance = this.instanceStore.get(instanceId);
    if (!instance) {
      return;
    }

    this.failureCounts.delete(instanceId);

    this.instanceStore.upsert({
      ...instance,
      state: instance.state === "error" ? "connected" : instance.state,
      error: instance.state === "error" ? undefined : instance.error,
      health: {
        ...instance.health,
        ok: true,
      },
    });
  }
}
