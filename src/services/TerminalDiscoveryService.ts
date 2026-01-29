import * as vscode from "vscode";

export interface TerminalInfo {
  name: string;
  pid: number;
  cwd: string;
}

export class TerminalDiscoveryService {
  private _onDidChangeTerminals = new vscode.EventEmitter<void>();
  public readonly onDidChangeTerminals = this._onDidChangeTerminals.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this._onDidChangeTerminals.fire()),
      vscode.window.onDidCloseTerminal(() => this._onDidChangeTerminals.fire()),
      vscode.window.onDidChangeTerminalState(() =>
        this._onDidChangeTerminals.fire(),
      ),
    );
  }

  public async getTerminals(): Promise<TerminalInfo[]> {
    const terminals = vscode.window.terminals;
    const terminalData = await Promise.all(
      terminals.map(async (terminal) => {
        if (
          terminal.name === "OpenCode TUI" ||
          terminal.name === "opencode-main"
        ) {
          return null;
        }

        const pid = await terminal.processId;
        if (!pid) {
          return null;
        }

        const cwd = terminal.shellIntegration?.cwd?.fsPath || "";

        return {
          originalName: terminal.name,
          pid,
          cwd,
        };
      }),
    );

    const validTerminals = terminalData.filter(
      (t): t is NonNullable<typeof t> => t !== null,
    );

    const nameCounts = new Map<string, number>();
    for (const term of validTerminals) {
      nameCounts.set(
        term.originalName,
        (nameCounts.get(term.originalName) || 0) + 1,
      );
    }

    return validTerminals.map((term) => {
      let displayName = term.originalName;
      if ((nameCounts.get(term.originalName) || 0) > 1 && term.cwd) {
        displayName = `${term.originalName} [${term.cwd}]`;
      }

      return {
        name: displayName,
        pid: term.pid,
        cwd: term.cwd,
      };
    });
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this._onDidChangeTerminals.dispose();
  }
}
