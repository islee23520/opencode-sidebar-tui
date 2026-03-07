import type { CliAdapter } from "../core/cli/CliAdapter";
import type { CliConfig, CliInstance } from "../core/cli/types";
import { TerminalManager } from "../terminals/TerminalManager";

type DisposableLike = { dispose(): void };

const DEFAULT_CLAUDE_COMMAND = "claude";

export class ClaudeAdapter implements CliAdapter {
  private readonly instances = new Map<string, CliInstance>();
  private readonly subscriptions = new Map<string, DisposableLike[]>();
  private readonly terminalManager: TerminalManager;

  onData: (instanceId: string, data: string) => void = () => {};
  onExit: (instanceId: string, code: number) => void = () => {};
  onError: (instanceId: string, error: Error) => void = () => {};
  onReady: (instanceId: string) => void = () => {};

  constructor(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager;
  }

  async start(config: CliConfig): Promise<CliInstance> {
    try {
      const command = this.buildStartCommand(config.command, config.args);

      const terminal = this.terminalManager.createTerminal(
        config.instanceId,
        command,
        config.env,
        undefined,
        config.cols,
        config.rows,
        config.instanceId,
      );

      const instance: CliInstance = {
        id: config.instanceId,
        toolId: config.toolId,
        process: terminal.process,
        state: "running",
        port: undefined,
      };

      this.instances.set(config.instanceId, instance);

      const dataSubscription = terminal.onData.event(({ data }) => {
        this.onData(config.instanceId, data);
      });

      const exitSubscription = terminal.process.onExit((event) => {
        const current = this.instances.get(config.instanceId);
        if (current) {
          this.instances.set(config.instanceId, { ...current, state: "idle" });
        }

        this.cleanupSubscriptions(config.instanceId);
        this.instances.delete(config.instanceId);
        this.onExit(config.instanceId, event.exitCode ?? 0);
      });

      this.subscriptions.set(config.instanceId, [
        dataSubscription,
        exitSubscription,
      ]);

      this.onReady(config.instanceId);
      return instance;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.onError(config.instanceId, normalizedError);
      throw normalizedError;
    }
  }

  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.cleanupSubscriptions(instanceId);
      return;
    }

    this.instances.set(instanceId, { ...instance, state: "stopping" });

    try {
      this.terminalManager.killByInstance(instanceId);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.onError(instanceId, normalizedError);
      throw normalizedError;
    } finally {
      this.cleanupSubscriptions(instanceId);
      this.instances.delete(instanceId);
    }
  }

  writeInput(instanceId: string, data: string): void {
    const terminal = this.terminalManager.getByInstance(instanceId);
    if (!terminal) {
      this.onError(
        instanceId,
        new Error(`Claude instance not found: ${instanceId}`),
      );
      return;
    }

    terminal.process.write(data);
  }

  resize(instanceId: string, cols: number, rows: number): void {
    const terminal = this.terminalManager.getByInstance(instanceId);
    if (!terminal) {
      this.onError(
        instanceId,
        new Error(`Claude instance not found: ${instanceId}`),
      );
      return;
    }

    terminal.process.resize(cols, rows);
  }

  async healthCheck(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    const terminal = this.terminalManager.getByInstance(instanceId);

    if (!instance || !terminal) {
      return false;
    }

    return instance.state === "running" || instance.state === "starting";
  }

  getPort(_instanceId: string): number | undefined {
    return undefined;
  }

  private buildStartCommand(command: string, args?: string[]): string {
    const extractedCommand = this.extractClaudeCommand(command);
    if (!args || args.length === 0) {
      return extractedCommand;
    }

    const serializedArgs = args
      .map((arg) => this.escapeShellArg(arg))
      .join(" ");
    return `${extractedCommand} ${serializedArgs}`;
  }

  private extractClaudeCommand(command: string): string {
    const trimmed = command.trim();
    if (!trimmed) {
      return DEFAULT_CLAUDE_COMMAND;
    }

    const segments = trimmed.split(/\s+/);
    const claudeIndex = segments.findIndex((segment) =>
      /(^|[\\/])claude$/.test(segment),
    );

    if (claudeIndex === -1) {
      return trimmed;
    }

    return segments.slice(claudeIndex).join(" ");
  }

  private escapeShellArg(value: string): string {
    if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
      return value;
    }

    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private cleanupSubscriptions(instanceId: string): void {
    const subscriptions = this.subscriptions.get(instanceId);
    if (!subscriptions) {
      return;
    }

    for (const subscription of subscriptions) {
      try {
        subscription.dispose();
      } catch (error) {
        void error;
      }
    }

    this.subscriptions.delete(instanceId);
  }
}
