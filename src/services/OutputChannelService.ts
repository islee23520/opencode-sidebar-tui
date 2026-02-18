import * as vscode from "vscode";

/**
 * Service for managing the VS Code: Output Channel for logging.
 * Follows the singleton pattern to ensure all parts of the extension
 * log to the same channel.
 */
export class OutputChannelService {
  private static instance: OutputChannelService | undefined;
  private channel: vscode.LogOutputChannel;

  private static readonly LOG_LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  } as const;

  /**
   * Private constructor to enforce singleton pattern.
   * Creates a LogOutputChannel named 'OpenCode TUI'.
   */
  private constructor() {
    this.channel = vscode.window.createOutputChannel("OpenCode Sidebar TUI", {
      log: true,
    });
  }

  /**
   * Gets the singleton instance of OutputChannelService.
   * @returns The OutputChannelService instance.
   */
  public static getInstance(): OutputChannelService {
    if (!OutputChannelService.instance) {
      OutputChannelService.instance = new OutputChannelService();
    }
    return OutputChannelService.instance;
  }

  public static resetInstance(): void {
    OutputChannelService.instance = undefined;
  }

  private getConfiguredLogLevel(): keyof typeof OutputChannelService.LOG_LEVEL_ORDER {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const value = config.get<string>("logLevel", "info");

    if (
      value === "debug" ||
      value === "info" ||
      value === "warn" ||
      value === "error"
    ) {
      return value;
    }

    return "info";
  }

  private shouldLog(
    level: keyof typeof OutputChannelService.LOG_LEVEL_ORDER,
  ): boolean {
    const configured = this.getConfiguredLogLevel();
    return (
      OutputChannelService.LOG_LEVEL_ORDER[level] >=
      OutputChannelService.LOG_LEVEL_ORDER[configured]
    );
  }

  /**
   * Logs a debug message.
   * @param message - The message to log.
   */
  public debug(message: string): void {
    if (this.shouldLog("debug")) {
      this.channel.debug(message);
    }
  }

  /**
   * Logs an info message.
   * @param message - The message to log.
   */
  public info(message: string): void {
    if (this.shouldLog("info")) {
      this.channel.info(message);
    }
  }

  /**
   * Logs a warning message.
   * @param message - The message to log.
   */
  public warn(message: string): void {
    if (this.shouldLog("warn")) {
      this.channel.warn(message);
    }
  }

  /**
   * Logs an error message or an Error object.
   * @param message - The error message or Error object to log.
   */
  public error(message: string | Error): void {
    if (this.shouldLog("error")) {
      this.channel.error(message);
    }
  }

  /**
   * Disposes of the output channel and resets the singleton instance.
   */
  public dispose(): void {
    this.channel.dispose();
    OutputChannelService.instance = undefined;
  }
}
