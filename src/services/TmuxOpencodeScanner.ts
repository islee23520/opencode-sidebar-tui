import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { OutputChannelService } from "./OutputChannelService";

export interface TmuxOpencodeSession {
  sessionName: string;
  windowName: string;
  paneId: string;
  pid: number;
  currentPath: string;
  matchedPath: string;
  matchScore: number;
}

/**
 * Service for scanning and connecting to existing tmux opencode instances.
 * Prioritizes connecting to existing sessions over creating new ones.
 */
export class TmuxOpencodeScanner {
  private readonly logger: OutputChannelService;

  constructor() {
    this.logger = OutputChannelService.getInstance();
  }

  /**
   * Scans for existing tmux sessions with opencode running in the given path.
   * Returns the best matching session or null if none found.
   */
  async scanForOpencodeSessions(
    targetPath: string,
  ): Promise<TmuxOpencodeSession | null> {
    this.logger.info(
      `[TmuxOpencodeScanner] Scanning for opencode sessions in: ${targetPath}`,
    );

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      // Get all tmux sessions
      let sessionsOutput: string;
      try {
        const { stdout } = await execAsync(
          "tmux list-sessions -F '#{session_name}'",
          {
            timeout: 5000,
          },
        );
        sessionsOutput = stdout;
      } catch (error) {
        // No tmux sessions or tmux not running
        this.logger.info("[TmuxOpencodeScanner] No tmux sessions found");
        return null;
      }

      const sessions = sessionsOutput
        .trim()
        .split("\n")
        .filter((s) => s.length > 0);

      this.logger.info(
        `[TmuxOpencodeScanner] Found ${sessions.length} tmux sessions`,
      );

      const candidates: TmuxOpencodeSession[] = [];

      // Check each session for opencode processes
      for (const sessionName of sessions) {
        const session = await this.checkSessionForOpencode(
          sessionName,
          targetPath,
          execAsync,
        );
        if (session) {
          candidates.push(session);
        }
      }

      if (candidates.length === 0) {
        this.logger.info(
          "[TmuxOpencodeScanner] No opencode sessions found in any tmux session",
        );
        return null;
      }

      // Sort by match score (highest first)
      candidates.sort((a, b) => b.matchScore - a.matchScore);

      this.logger.info(
        `[TmuxOpencodeScanner] Best match: ${candidates[0].sessionName} (score: ${candidates[0].matchScore})`,
      );

      return candidates[0];
    } catch (error) {
      this.logger.error(
        `[TmuxOpencodeScanner] Scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Checks a specific tmux session for opencode processes.
   */
  private async checkSessionForOpencode(
    sessionName: string,
    targetPath: string,
    execAsync: any,
  ): Promise<TmuxOpencodeSession | null> {
    try {
      // Get all panes in this session
      const { stdout: panesOutput } = await execAsync(
        `tmux list-panes -t ${sessionName} -F '#{pane_id}:#{pane_pid}:#{pane_current_path}:#{window_name}'`,
        { timeout: 5000 },
      );

      const panes = panesOutput
        .trim()
        .split("\n")
        .filter((p: string) => p.length > 0);

      for (const paneInfo of panes) {
        const [paneId, pidStr, currentPath, windowName] = paneInfo.split(":");
        const pid = parseInt(pidStr, 10);

        if (isNaN(pid)) continue;

        // Check if opencode is running in this pane
        const isOpencode = await this.checkProcessForOpencode(pid, execAsync);

        if (isOpencode) {
          // Calculate path match score
          const matchScore = this.calculatePathMatchScore(
            currentPath,
            targetPath,
          );

          if (matchScore > 0) {
            return {
              sessionName,
              windowName,
              paneId,
              pid,
              currentPath,
              matchedPath: targetPath,
              matchScore,
            };
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Checks if the process tree contains opencode.
   */
  private async checkProcessForOpencode(
    pid: number,
    execAsync: any,
  ): Promise<boolean> {
    try {
      const platform = os.platform();

      if (platform === "darwin" || platform === "linux") {
        // Check the process and its children
        const { stdout } = await execAsync(
          `ps -eo pid,ppid,comm | grep -E "opencode|${pid}"`,
          { timeout: 5000 },
        );

        const processes = stdout.toLowerCase();

        // Check if opencode is in the process tree
        if (processes.includes("opencode")) {
          // Verify it's actually a child of our pid
          const lines = stdout.trim().split("\n");
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const [, ppidStr, comm] = parts;
              if (comm.toLowerCase().includes("opencode")) {
                return true;
              }
            }
          }
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculates how well the current path matches the target path.
   * Returns a score from 0-100.
   */
  private calculatePathMatchScore(
    currentPath: string,
    targetPath: string,
  ): number {
    // Normalize paths
    const normalizedCurrent = path.normalize(currentPath);
    const normalizedTarget = path.normalize(targetPath);

    // Exact match
    if (normalizedCurrent === normalizedTarget) {
      return 100;
    }

    // Target is a subdirectory of current
    if (normalizedTarget.startsWith(normalizedCurrent + path.sep)) {
      const depth =
        normalizedTarget.slice(normalizedCurrent.length).split(path.sep)
          .length - 1;
      return Math.max(90 - depth * 10, 50);
    }

    // Current is a subdirectory of target
    if (normalizedCurrent.startsWith(normalizedTarget + path.sep)) {
      const depth =
        normalizedCurrent.slice(normalizedTarget.length).split(path.sep)
          .length - 1;
      return Math.max(80 - depth * 10, 40);
    }

    // Share common parent
    const currentParts = normalizedCurrent.split(path.sep);
    const targetParts = normalizedTarget.split(path.sep);
    let commonParts = 0;

    for (
      let i = 0;
      i < Math.min(currentParts.length, targetParts.length);
      i++
    ) {
      if (currentParts[i] === targetParts[i]) {
        commonParts++;
      } else {
        break;
      }
    }

    if (commonParts > 0) {
      const totalParts = Math.max(currentParts.length, targetParts.length);
      return Math.floor((commonParts / totalParts) * 40);
    }

    return 0;
  }

  /**
   * Attaches to an existing tmux opencode session.
   * Returns true if successful.
   */
  async attachToSession(session: TmuxOpencodeSession): Promise<boolean> {
    this.logger.info(
      `[TmuxOpencodeScanner] Attaching to session: ${session.sessionName}`,
    );

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      // Switch to the session and pane
      await execAsync(
        `tmux switch-client -t ${session.sessionName}:${session.windowName}.${session.paneId}`,
        { timeout: 5000 },
      );

      this.logger.info(
        `[TmuxOpencodeScanner] Successfully attached to ${session.sessionName}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `[TmuxOpencodeScanner] Failed to attach: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Sends a command to a specific tmux pane.
   */
  async sendKeysToSession(
    session: TmuxOpencodeSession,
    keys: string,
  ): Promise<boolean> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const target = `${session.sessionName}:${session.windowName}.${session.paneId}`;
      const escapedKeys = this.escapeTmuxKeys(keys);

      await execAsync(`tmux send-keys -t ${target} ${escapedKeys}`, {
        timeout: 5000,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `[TmuxOpencodeScanner] Failed to send keys: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Escapes a string for use with tmux send-keys command.
   */
  private escapeTmuxKeys(keys: string): string {
    return keys
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/'/g, "'\"'\"'")
      .replace(/\n/g, "Enter")
      .replace(/\r/g, "");
  }
}
