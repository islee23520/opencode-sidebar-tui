import type { IDisposable } from "node-pty";
import type { CliAdapter, CliConfig, CliInstance } from "../core/cli";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { portManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";

interface InstanceListeners {
  data: { dispose(): void };
  exit: IDisposable;
  exited: boolean;
}

export class OpenCodeAdapter implements CliAdapter {
  private instances = new Map<string, CliInstance>();
  private apiClients = new Map<string, OpenCodeApiClient>();
  private listeners = new Map<string, InstanceListeners>();
  private terminalManager: TerminalManager;

  onData: (instanceId: string, data: string) => void = () => {};
  onExit: (instanceId: string, code: number) => void = () => {};
  onError: (instanceId: string, error: Error) => void = () => {};
  onReady: (instanceId: string) => void = () => {};

  constructor(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager;
  }

  async start(config: CliConfig): Promise<CliInstance> {
    if (this.instances.has(config.instanceId)) {
      await this.stop(config.instanceId);
    }

    const port = portManager.allocate("opencode");

    try {
      const terminal = this.terminalManager.createTerminal(
        config.instanceId,
        this.buildCommand(config.command, config.args),
        {
          ...config.env,
          _EXTENSION_OPENCODE_PORT: String(port),
          OPENCODE_CALLER: "vscode",
        },
        port,
        config.cols,
        config.rows,
        config.instanceId,
      );

      const instance: CliInstance = {
        id: config.instanceId,
        toolId: config.toolId,
        process: terminal.process,
        state: "running",
        port,
      };

      const apiClient = new OpenCodeApiClient(port);
      const dataListener = terminal.onData.event((event) => {
        this.onData(config.instanceId, event.data);
      });
      const exitListener = terminal.process.onExit((event) => {
        this.handleExit(config.instanceId, event.exitCode ?? 0);
      });

      this.instances.set(config.instanceId, instance);
      this.apiClients.set(config.instanceId, apiClient);
      this.listeners.set(config.instanceId, {
        data: dataListener,
        exit: exitListener,
        exited: false,
      });

      this.onReady(config.instanceId);
      return instance;
    } catch (error) {
      portManager.release("opencode", port);
      const startError =
        error instanceof Error ? error : new Error(String(error));
      this.onError(config.instanceId, startError);
      throw startError;
    }
  }

  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return;
    }

    instance.state = "stopping";

    try {
      this.terminalManager.killByInstance(instanceId);
      this.handleExit(instanceId, 0);
    } catch (error) {
      const stopError =
        error instanceof Error ? error : new Error(String(error));
      this.onError(instanceId, stopError);
      throw stopError;
    }
  }

  writeInput(instanceId: string, data: string): void {
    const terminal = this.terminalManager.getByInstance(instanceId);
    if (!terminal) {
      this.onError(
        instanceId,
        new Error(`Cannot write input to unknown instance: ${instanceId}`),
      );
      return;
    }

    this.terminalManager.writeToTerminal(terminal.id, data);
  }

  resize(instanceId: string, cols: number, rows: number): void {
    const terminal = this.terminalManager.getByInstance(instanceId);
    if (!terminal) {
      this.onError(
        instanceId,
        new Error(`Cannot resize unknown instance: ${instanceId}`),
      );
      return;
    }

    this.terminalManager.resizeTerminal(terminal.id, cols, rows);
  }

  async healthCheck(instanceId: string): Promise<boolean> {
    const client = this.apiClients.get(instanceId);
    if (!client) {
      return false;
    }

    try {
      return await client.healthCheck();
    } catch (error) {
      const healthError =
        error instanceof Error ? error : new Error(String(error));
      this.onError(instanceId, healthError);
      return false;
    }
  }

  getPort(instanceId: string): number | undefined {
    return this.instances.get(instanceId)?.port;
  }

  private handleExit(instanceId: string, code: number): void {
    const listeners = this.listeners.get(instanceId);
    if (listeners?.exited) {
      return;
    }

    if (listeners) {
      listeners.exited = true;
      listeners.data.dispose();
      listeners.exit.dispose();
      this.listeners.delete(instanceId);
    }

    const instance = this.instances.get(instanceId);
    if (instance?.port !== undefined) {
      portManager.release("opencode", instance.port);
    }

    this.instances.delete(instanceId);
    this.apiClients.delete(instanceId);
    this.onExit(instanceId, code);
  }

  private buildCommand(command: string, args?: string[]): string {
    if (!args || args.length === 0) {
      return command;
    }

    return `${command} ${args.join(" ")}`;
  }
}
