import * as vscode from "vscode";
import * as os from "os";
import { OutputChannelService } from "./OutputChannelService";

export type DetectedCli = "opencode" | "claude" | "codex" | "kimi" | null;

export interface TmuxSessionInfo {
  isInTmux: boolean;
  sessionName: string | null;
  panePid: number | null;
  runningCli: DetectedCli;
}

/**
 * Service for detecting tmux sessions and CLI tools running inside them.
 * Used to properly send file references when the terminal is running tmux
 * with an AI CLI attached.
 */
export class TmuxDetector {
  private readonly logger: OutputChannelService;

  constructor() {
    this.logger = OutputChannelService.getInstance();
  }

  /**
   * Detects if the current process is running inside a tmux session
   * and what CLI tool is running in the current pane.
   */
  async detectTmuxSession(): Promise<TmuxSessionInfo> {
    const tmuxEnv = process.env.TMUX;

    if (!tmuxEnv) {
      return {
        isInTmux: false,
        sessionName: null,
        panePid: null,
        runningCli: null,
      };
    }

    return {
      isInTmux: true,
      sessionName: null,
      panePid: null,
      runningCli: null,
    };
  }

  /**
   * Detects which AI CLI is running in the given process tree.
   * Searches for opencode, claude, codex, or kimi processes.
   */
  private async detectRunningCli(
    parentPid: number | null,
  ): Promise<DetectedCli> {
    if (!parentPid) {
      return null;
    }

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const platform = os.platform();
      let processList: string;

      if (platform === "darwin" || platform === "linux") {
        // Use ps to get process tree
        try {
          const { stdout } = await execAsync(
            `ps -eo pid,ppid,comm | grep -E "(opencode|claude|codex|kimi)"`,
            { timeout: 5000 },
          );
          processList = stdout;
        } catch {
          // grep returns exit code 1 if no matches, which is not an error for us
          processList = "";
        }
      } else if (platform === "win32") {
        // Windows detection using wmic or tasklist
        try {
          const { stdout } = await execAsync(
            `wmic process where "ParentProcessId=${parentPid}" get Name`,
            { timeout: 5000 },
          );
          processList = stdout.toLowerCase();
        } catch {
          return null;
        }
      } else {
        return null;
      }

      // Check for each CLI in priority order
      const processes = processList.toLowerCase();

      if (processes.includes("opencode")) {
        return "opencode";
      }
      if (processes.includes("claude")) {
        return "claude";
      }
      if (processes.includes("codex")) {
        return "codex";
      }
      if (processes.includes("kimi")) {
        return "kimi";
      }

      // Check recursively in the process tree
      return await this.detectCliInProcessTree(parentPid);
    } catch (error) {
      this.logger.warn(
        `[TmuxDetector] CLI detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Recursively searches for CLI processes in the process tree.
   */
  private async detectCliInProcessTree(pid: number): Promise<DetectedCli> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const platform = os.platform();

      if (platform !== "darwin" && platform !== "linux") {
        return null;
      }

      // Get child processes
      let childPids: number[] = [];
      try {
        const { stdout } = await execAsync(
          `ps -eo pid,ppid | awk '$2 == ${pid} {print $1}'`,
          { timeout: 5000 },
        );
        childPids = stdout
          .trim()
          .split("\n")
          .filter((p) => p)
          .map((p) => parseInt(p.trim(), 10))
          .filter((p) => !isNaN(p));
      } catch {
        return null;
      }

      // Check each child process
      for (const childPid of childPids) {
        try {
          const { stdout } = await execAsync(`ps -p ${childPid} -o comm=`, {
            timeout: 5000,
          });
          const comm = stdout.trim().toLowerCase();

          // Remove path if present
          const processName = comm.split(/[/\\]/).pop() || comm;

          if (processName.includes("opencode")) {
            return "opencode";
          }
          if (processName.includes("claude")) {
            return "claude";
          }
          if (processName.includes("codex")) {
            return "codex";
          }
          if (processName.includes("kimi")) {
            return "kimi";
          }

          // Recursively check grandchildren
          const grandchildResult = await this.detectCliInProcessTree(childPid);
          if (grandchildResult) {
            return grandchildResult;
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Sends a keystroke sequence to tmux using send-keys.
   * This bypasses the normal shell input and sends directly to the pane.
   */
  async sendKeysToTmux(keys: string): Promise<boolean> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      // Escape special characters for tmux send-keys
      // Reference: https://man7.org/linux/man-pages/man1/tmux.1.html
      const escapedKeys = this.escapeTmuxKeys(keys);

      await execAsync(`tmux send-keys ${escapedKeys}`, { timeout: 5000 });
      return true;
    } catch (error) {
      this.logger.error(
        `[TmuxDetector] Failed to send keys: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Escapes a string for use with tmux send-keys command.
   */
  private escapeTmuxKeys(keys: string): string {
    // Replace special keys with tmux literals
    return keys
      .replace(/\\/g, "\\\\") // Escape backslashes first
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/'/g, "'\"'\"'") // Escape single quotes
      .replace(/\n/g, "Enter") // Convert newlines to Enter key
      .replace(/\r/g, ""); // Remove carriage returns
  }
}
