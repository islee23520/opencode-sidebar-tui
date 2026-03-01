import * as vscode from "vscode";
import { PortManager } from "./PortManager";
import {
  InstanceId,
  InstanceRecord,
  InstanceState,
  InstanceStore,
} from "./InstanceStore";
import { ConnectionResolver } from "./ConnectionResolver";
import { TerminalManager } from "../terminals/TerminalManager";

const DEFAULT_COMMAND = "opencode -c";

export interface SpawnOptions {
  command?: string;
  args?: string[];
  preferredPort?: number;
}

export class InstanceController implements vscode.Disposable {
  constructor(
    private readonly terminalManager: TerminalManager,
    private readonly instanceStore: InstanceStore,
    private readonly portManager: PortManager,
    private readonly outputChannel?: vscode.OutputChannel,
    private readonly connectionResolver?: ConnectionResolver,
  ) {}

  /**
   * Spawns a new OpenCode instance by creating a terminal and assigning a port.
   * @param instanceId - Target instance identifier.
   * @param options - Optional spawn overrides.
   */
  public async spawn(
    instanceId: InstanceId,
    options?: SpawnOptions,
  ): Promise<void> {
    const current = this.getOrCreateRecord(instanceId);
    const terminalKey = this.getTerminalKey(instanceId, current);
    const nextConfig = {
      ...current.config,
      command: options?.command ?? current.config.command,
      args: options?.args ?? current.config.args,
      preferredPort: options?.preferredPort ?? current.config.preferredPort,
    };

    this.upsertRecord({
      ...current,
      config: nextConfig,
      runtime: {
        ...current.runtime,
        terminalKey,
      },
      state: "spawning",
      error: undefined,
    });

    try {
      const assignedPort = this.portManager.assignPortToTerminal(
        terminalKey,
        nextConfig.preferredPort,
      );
      const command = this.buildSpawnCommand(
        nextConfig.command,
        nextConfig.args,
      );

      this.terminalManager.createTerminal(
        terminalKey,
        command,
        {
          _EXTENSION_OPENCODE_PORT: String(assignedPort),
          OPENCODE_CALLER: "vscode",
        },
        assignedPort,
      );

      this.upsertRecord({
        ...current,
        config: nextConfig,
        runtime: {
          ...current.runtime,
          terminalKey,
          port: assignedPort,
        },
        state: "connected",
        error: undefined,
      });
    } catch (error) {
      this.handleFailure(current, "spawn", error, {
        config: nextConfig,
        runtime: {
          ...current.runtime,
          terminalKey,
        },
      });
      throw error;
    }
  }

  /**
   * Connects to an already running instance using the given port.
   * @param instanceId - Target instance identifier.
   * @param port - Existing API port for the running instance.
   */
  public async connect(instanceId: InstanceId, port: number): Promise<void> {
    const current = this.getOrCreateRecord(instanceId);
    const terminalKey = this.getTerminalKey(instanceId, current);

    this.upsertRecord({
      ...current,
      runtime: {
        ...current.runtime,
        terminalKey,
      },
      state: "connecting",
      error: undefined,
    });

    try {
      const assignedPort = this.portManager.assignPortToTerminal(
        terminalKey,
        port,
      );

      this.upsertRecord({
        ...current,
        runtime: {
          ...current.runtime,
          terminalKey,
          port: assignedPort,
        },
        state: "connected",
        error: undefined,
      });
    } catch (error) {
      this.handleFailure(current, "connect", error, {
        runtime: {
          ...current.runtime,
          terminalKey,
        },
      });
      throw error;
    }
  }

  /**
   * Disconnects the API/session state while leaving the terminal process running.
   * @param instanceId - Target instance identifier.
   */
  public async disconnect(instanceId: InstanceId): Promise<void> {
    const current = this.getOrCreateRecord(instanceId);

    this.upsertRecord({
      ...current,
      state: "disconnected",
      error: undefined,
    });
  }

  /**
   * Kills the instance terminal/process and marks the instance as disconnected.
   * @param instanceId - Target instance identifier.
   */
  public async kill(instanceId: InstanceId): Promise<void> {
    const current = this.getOrCreateRecord(instanceId);
    const terminalKey = this.getTerminalKey(instanceId, current);

    this.upsertRecord({
      ...current,
      state: "stopping",
      error: undefined,
    });

    try {
      this.terminalManager.killTerminal(terminalKey);
      this.portManager.releaseTerminalPorts(terminalKey);

      this.upsertRecord({
        ...current,
        runtime: {
          ...current.runtime,
          pid: undefined,
          terminalKey,
        },
        state: "disconnected",
        error: undefined,
      });
    } catch (error) {
      this.handleFailure(current, "kill", error);
      throw error;
    }
  }

  /**
   * Resolves an instance port.
   *
   * Uses 4-tier resolution via ConnectionResolver when available (stored runtime,
   * health check, process discovery, and optional spawn fallback). Without a
   * resolver, it falls back to the existing store-backed strategy.
   * @param instanceId - Target instance identifier.
   * @returns The resolved port when present.
   */
  public async resolve(instanceId: InstanceId): Promise<number | undefined> {
    const current = this.instanceStore.get(instanceId);
    if (!current) {
      return undefined;
    }

    this.upsertRecord({
      ...current,
      state: "resolving",
      error: undefined,
    });

    if (this.connectionResolver) {
      try {
        const port = await this.connectionResolver.resolve(instanceId);
        const latest = this.instanceStore.get(instanceId) ?? current;

        if (port !== undefined) {
          this.upsertRecord({
            ...latest,
            runtime: {
              ...latest.runtime,
              port,
            },
            state: "connected",
            error: undefined,
          });
          return port;
        }

        this.upsertRecord({
          ...latest,
          state: "error",
          error: "Unable to resolve a healthy port.",
        });
        return undefined;
      } catch (error) {
        const latest = this.instanceStore.get(instanceId) ?? current;
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel?.appendLine(
          `[InstanceController] Failed to resolve '${instanceId}': ${message}`,
        );
        this.upsertRecord({
          ...latest,
          state: "error",
          error: message,
        });
        return undefined;
      }
    }

    const port = current.runtime.port;
    this.upsertRecord({
      ...current,
      state: port !== undefined ? "connected" : "disconnected",
      error: undefined,
    });

    return port;
  }

  /**
   * Gracefully shuts down all tracked instances.
   */
  public dispose(): void {
    for (const record of this.instanceStore.getAll()) {
      const instanceId = record.config.id;
      const terminalKey = this.getTerminalKey(instanceId, record);

      this.terminalManager.killTerminal(terminalKey);
      this.portManager.releaseTerminalPorts(terminalKey);

      this.upsertRecord({
        ...record,
        runtime: {
          ...record.runtime,
          pid: undefined,
        },
        state: "disconnected",
        error: undefined,
      });
    }
  }

  private getOrCreateRecord(instanceId: InstanceId): InstanceRecord {
    const existing = this.instanceStore.get(instanceId);
    if (existing) {
      return existing;
    }

    const created: InstanceRecord = {
      config: {
        id: instanceId,
      },
      runtime: {},
      state: "disconnected",
    };

    this.instanceStore.upsert(created);
    return created;
  }

  private getTerminalKey(
    instanceId: InstanceId,
    record: InstanceRecord,
  ): string {
    return record.runtime.terminalKey ?? `opencode-instance-${instanceId}`;
  }

  private buildSpawnCommand(command?: string, args?: string[]): string {
    const baseCommand = command?.trim() || DEFAULT_COMMAND;
    if (!args || args.length === 0) {
      return baseCommand;
    }

    const serializedArgs = args
      .map((arg) => this.escapeShellArg(arg))
      .join(" ");
    return `${baseCommand} ${serializedArgs}`;
  }

  private escapeShellArg(value: string): string {
    if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
      return value;
    }

    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private handleFailure(
    current: InstanceRecord,
    operation: string,
    error: unknown,
    overrides?: Partial<InstanceRecord>,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.outputChannel?.appendLine(
      `[InstanceController] Failed to ${operation} '${current.config.id}': ${message}`,
    );

    this.upsertRecord({
      ...current,
      ...overrides,
      state: "error",
      error: message,
    });
  }

  private upsertRecord(record: InstanceRecord): void {
    this.instanceStore.upsert(record);
  }
}
