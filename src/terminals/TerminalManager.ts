import * as vscode from "vscode";
import * as pty from "node-pty";
import * as os from "os";
import * as path from "path";

export interface Terminal {
  id: string;
  process: pty.IPty;
  onData: vscode.EventEmitter<{ id: string; data: string }>;
  onExit: vscode.EventEmitter<string>;
}

export class TerminalManager {
  private terminals: Map<string, Terminal> = new Map();
  private readonly _onData = new vscode.EventEmitter<{
    id: string;
    data: string;
  }>();
  private readonly _onExit = new vscode.EventEmitter<string>();

  readonly onData = this._onData.event;
  readonly onExit = this._onExit.event;

  createTerminal(id: string, command?: string): Terminal {
    if (this.terminals.has(id)) {
      this.killTerminal(id);
    }

    const { shell, args: shellArgs } = this.getShellConfig();
    const ptyArgs = command ? [...shellArgs, command] : [];

    const onDataEmitter = new vscode.EventEmitter<{
      id: string;
      data: string;
    }>();
    const onExitEmitter = new vscode.EventEmitter<string>();

    const ptyProcess = pty.spawn(shell, ptyArgs, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      handleFlowControl: false,
    });

    ptyProcess.onData((data) => {
      onDataEmitter.fire({ id, data });
      this._onData.fire({ id, data });
    });

    ptyProcess.onExit(() => {
      onExitEmitter.fire(id);
      this._onExit.fire(id);
      this.terminals.delete(id);
    });

    const terminal: Terminal = {
      id,
      process: ptyProcess,
      onData: onDataEmitter,
      onExit: onExitEmitter,
    };

    this.terminals.set(id, terminal);
    return terminal;
  }

  getTerminal(id: string): Terminal | undefined {
    return this.terminals.get(id);
  }

  writeToTerminal(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      const filteredData = data.replace(/[\x03\x1A]/g, "");
      if (filteredData) {
        terminal.process.write(filteredData);
      }
    }
  }

  resizeTerminal(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.process.resize(cols, rows);
    }
  }

  killTerminal(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.process.kill();
      terminal.onData.dispose();
      terminal.onExit.dispose();
      this.terminals.delete(id);
    }
  }

  dispose(): void {
    for (const [id] of this.terminals) {
      this.killTerminal(id);
    }
    this._onData.dispose();
    this._onExit.dispose();
  }

  private getShellConfig(): { shell: string; args: string[] } {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const overrideShell = config.get<string>("shellPath");
    const overrideArgs = config.get<string[]>("shellArgs");

    const shell =
      overrideShell ||
      vscode.env.shell ||
      (os.platform() === "win32"
        ? process.env.COMSPEC || "cmd.exe"
        : process.env.SHELL || "/bin/bash");

    if (overrideArgs && overrideArgs.length > 0) {
      return { shell, args: overrideArgs };
    }

    const shellName = path.basename(shell).toLowerCase();
    if (os.platform() === "win32") {
      if (shellName === "cmd.exe" || shellName === "cmd")
        return { shell, args: ["/c"] };
      if (shellName.includes("powershell") || shellName.includes("pwsh"))
        return { shell, args: ["-Command"] };
    }
    return { shell, args: ["-c"] };
  }
}
