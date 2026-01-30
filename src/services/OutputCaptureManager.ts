import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export interface CaptureResult {
  success: boolean;
  error?: string;
  filePath?: string;
}

export class OutputCaptureManager {
  private captures: Map<vscode.Terminal, string> = new Map();

  /**
   * Starts capturing output from the terminal to a temporary file.
   * @param terminal The VS Code terminal to capture from.
   * @returns CaptureResult indicating success or failure.
   */
  public startCapture(terminal: vscode.Terminal): CaptureResult {
    if (os.platform() === "win32") {
      return {
        success: false,
        error: "Output capture is not supported on Windows.",
      };
    }

    // Check if script command is available
    try {
      // Use 'which' on Unix systems to check for script command
      const { execSync } = require("child_process");
      execSync("which script", { stdio: "ignore" });
    } catch {
      return {
        success: false,
        error:
          "The 'script' command is not available. Please install util-linux or bsdutils package.",
      };
    }

    const tempDir = os.tmpdir();
    const filename = `opencode-capture-${process.pid}-${Date.now()}.log`;
    const filePath = path.join(tempDir, filename);

    try {
      // Send command to terminal to start recording
      // script -q <file> starts a new shell and logs to <file>
      terminal.sendText(`script -q "${filePath}"`);
      this.captures.set(terminal, filePath);

      return { success: true, filePath };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start capture: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Stops the capture by exiting the nested shell.
   * @param terminal The VS Code terminal to stop capturing.
   */
  public stopCapture(terminal: vscode.Terminal): void {
    if (!this.captures.has(terminal)) {
      return;
    }

    // 'exit' terminates the shell started by 'script'
    terminal.sendText("exit");
  }

  /**
   * Reads the captured content and strips ANSI codes.
   * @param terminal The terminal to read capture from.
   * @returns The captured text.
   */
  public readCapture(terminal: vscode.Terminal): string {
    const filePath = this.captures.get(terminal);
    if (!filePath || !fs.existsSync(filePath)) {
      return "";
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return this.stripAnsi(content);
    } catch (error) {
      console.error("Failed to read capture file:", error);
      return "";
    }
  }

  /**
   * Cleans up the temporary file associated with the terminal.
   * @param terminal The terminal to clean up.
   */
  public cleanup(terminal: vscode.Terminal): void {
    const filePath = this.captures.get(terminal);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error("Failed to delete capture file:", error);
      }
    }
    this.captures.delete(terminal);
  }

  private stripAnsi(str: string): string {
    // Regex to strip ANSI escape codes (colors and other control sequences)
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
  }
}
