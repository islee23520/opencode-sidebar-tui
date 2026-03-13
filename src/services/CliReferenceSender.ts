import * as vscode from "vscode";
import * as path from "path";
import { TmuxDetector, DetectedCli } from "./TmuxDetector";
import { TerminalManager } from "../terminals/TerminalManager";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import { OutputChannelService } from "./OutputChannelService";
import { ContextSharingService } from "./ContextSharingService";

export interface ReferenceSendResult {
  success: boolean;
  method: "http" | "tmux" | "terminal" | "none";
  cliDetected: DetectedCli;
  error?: string;
}

export interface TmuxSession {
  name: string;
  path: string;
  cli: DetectedCli;
}

export class CliReferenceSender {
  private readonly tmuxDetector: TmuxDetector;
  private readonly logger: OutputChannelService;
  private readonly contextSharingService: ContextSharingService;

  constructor(
    private readonly terminalManager: TerminalManager,
    private readonly getApiClient: () => OpenCodeApiClient | undefined,
    private readonly getActiveTerminalId: () => string,
  ) {
    this.tmuxDetector = new TmuxDetector();
    this.logger = OutputChannelService.getInstance();
    this.contextSharingService = new ContextSharingService();
  }

  async sendFileReference(
    fileRef: string,
    options: { autoFocus?: boolean } = {},
  ): Promise<ReferenceSendResult> {
    const { autoFocus = true } = options;

    console.log(`[CLI-REF-SENDER] sendFileReference called: "${fileRef}"`);
    this.logger.info(`[sendFileReference] START - fileRef: "${fileRef}"`);

    try {
      this.logger.info(`[sendFileReference] Step 1: Detecting tmux session...`);
      console.log(`[CLI-REF-SENDER] Step 1: Detecting tmux...`);

      const tmuxInfo = await this.tmuxDetector.detectTmuxSession();
      console.log(
        `[CLI-REF-SENDER] Step 2: Tmux detected=${tmuxInfo.isInTmux}`,
      );
      this.logger.info(
        `[sendFileReference] Step 2: Tmux info - isInTmux: ${tmuxInfo.isInTmux}, runningCli: ${tmuxInfo.runningCli}`,
      );

      if (tmuxInfo.isInTmux && tmuxInfo.runningCli) {
        this.logger.info(`[sendFileReference] Step 3: Sending via tmux CLI...`);
        return await this.sendToTmuxCli(
          fileRef,
          tmuxInfo.runningCli,
          autoFocus,
        );
      }

      this.logger.info(
        `[sendFileReference] Step 3: Not in tmux, using standard terminal...`,
      );
      return await this.sendToStandardTerminal(fileRef, autoFocus);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CLI-REF-SENDER] ERROR: ${errorMsg}`);
      this.logger.error(`[sendFileReference] ERROR: ${errorMsg}`);
      return {
        success: false,
        method: "none",
        cliDetected: null,
        error: errorMsg,
      };
    }
  }

  private async sendToTmuxCli(
    fileRef: string,
    cli: DetectedCli,
    autoFocus: boolean,
  ): Promise<ReferenceSendResult> {
    const success = await this.tmuxDetector.sendKeysToTmux(fileRef + " ");

    if (success) {
      if (autoFocus) await this.focusSidebar();
      return { success: true, method: "tmux", cliDetected: cli };
    }

    return await this.sendToStandardTerminal(fileRef, autoFocus);
  }

  private async sendToStandardTerminal(
    fileRef: string,
    autoFocus: boolean,
  ): Promise<ReferenceSendResult> {
    this.logger.info(`[sendToStandardTerminal] Step 1: Getting terminal ID...`);
    const terminalId = this.getActiveTerminalId();
    this.logger.info(
      `[sendToStandardTerminal] Step 2: Terminal ID = "${terminalId}"`,
    );

    this.logger.info(
      `[sendToStandardTerminal] Step 3: Getting terminal from manager...`,
    );
    const terminal = this.terminalManager.getTerminal(terminalId);
    this.logger.info(
      `[sendToStandardTerminal] Step 4: Terminal found = ${terminal ? "YES" : "NO"}`,
    );

    if (!terminal) {
      this.logger.error(
        `[sendToStandardTerminal] Step 5: ERROR - No terminal found with ID "${terminalId}"`,
      );
      return {
        success: false,
        method: "none",
        cliDetected: null,
        error: "No active terminal found",
      };
    }

    try {
      this.logger.info(
        `[sendToStandardTerminal] Step 5: Writing to terminal: "${fileRef} "`,
      );
      this.terminalManager.writeToTerminal(terminalId, fileRef + " ");
      this.logger.info(`[sendToStandardTerminal] Step 6: Write successful`);

      if (autoFocus) {
        this.logger.info(
          `[sendToStandardTerminal] Step 7: Focusing sidebar...`,
        );
        await this.focusSidebar();
      }

      this.logger.info(`[sendToStandardTerminal] Step 8: SUCCESS`);
      return { success: true, method: "terminal", cliDetected: null };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[sendToStandardTerminal] Step 5: ERROR - ${errorMsg}`);
      return {
        success: false,
        method: "none",
        cliDetected: null,
        error: errorMsg,
      };
    }
  }

  async scanForOpencodeInTmux(): Promise<TmuxSession | null> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) return null;

      const { stdout } = await execAsync(
        "tmux list-sessions -F '#{session_name}|#{pane_current_path}' 2>/dev/null || echo ''",
        { timeout: 3000 },
      );

      const sessions = stdout
        .trim()
        .split("\n")
        .filter((s) => s)
        .map((line) => {
          const [name, sessionPath] = line.split("|");
          return { name, path: sessionPath };
        });

      for (const session of sessions) {
        const cli = await this.checkSessionForAiCli(session.name, execAsync);
        if (cli && this.isPathRelated(session.path, workspacePath)) {
          return { name: session.name, path: session.path, cli };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async checkSessionForAiCli(
    sessionName: string,
    execAsync: any,
  ): Promise<DetectedCli> {
    try {
      const { stdout } = await execAsync(
        `tmux list-panes -t ${sessionName} -F '#{pane_pid}'`,
        { timeout: 2000 },
      );

      const pids = stdout
        .trim()
        .split("\n")
        .filter((p: string) => p);

      for (const pid of pids) {
        try {
          const { stdout: psOutput } = await execAsync(
            `ps -p ${pid} -o comm= 2>/dev/null || ps -p $(ps -o ppid= -p ${pid} 2>/dev/null | head -1) -o comm= 2>/dev/null || echo ''`,
            { timeout: 2000 },
          );

          const comm = psOutput.trim().toLowerCase();
          if (comm.includes("opencode")) return "opencode";
          if (comm.includes("claude")) return "claude";
          if (comm.includes("codex")) return "codex";
          if (comm.includes("kimi")) return "kimi";
        } catch {}
      }

      return null;
    } catch {
      return null;
    }
  }

  private isPathRelated(sessionPath: string, workspacePath: string): boolean {
    const normalizedSession = path.normalize(sessionPath);
    const normalizedWorkspace = path.normalize(workspacePath);

    return (
      normalizedSession === normalizedWorkspace ||
      normalizedSession.startsWith(normalizedWorkspace + path.sep) ||
      normalizedWorkspace.startsWith(normalizedSession + path.sep)
    );
  }

  async sendCurrentContext(): Promise<ReferenceSendResult> {
    this.logger.info("[sendCurrentContext] START");
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.logger.warn("[sendCurrentContext] No active editor");
      return {
        success: false,
        method: "none",
        cliDetected: null,
        error: "No active editor",
      };
    }

    this.logger.info("[sendCurrentContext] Formatting file reference...");
    const fileRef =
      this.contextSharingService.formatFileRefWithLineNumbers(editor);
    this.logger.info(`[sendCurrentContext] File ref: "${fileRef}"`);

    this.logger.info("[sendCurrentContext] Calling sendFileReference...");
    const result = await this.sendFileReference(fileRef);
    this.logger.info(
      `[sendCurrentContext] Result: success=${result.success}, error=${result.error || "none"}`,
    );
    return result;
  }

  async sendAllOpenFiles(): Promise<ReferenceSendResult> {
    const fileRefs: string[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (!uri.scheme.startsWith("untitled")) {
            fileRefs.push(this.contextSharingService.formatFileRef(uri));
          }
        }
      }
    }

    if (fileRefs.length === 0) {
      return {
        success: false,
        method: "none",
        cliDetected: null,
        error: "No open files to send",
      };
    }

    return await this.sendFileReference(fileRefs.join(" "));
  }

  private async focusSidebar(): Promise<void> {
    try {
      await vscode.commands.executeCommand(
        "workbench.view.extension.opencodeTuiContainer",
      );
    } catch (error) {
      this.logger.warn(
        `[CliReferenceSender] Failed to focus sidebar: ${error}`,
      );
    }
  }
}
