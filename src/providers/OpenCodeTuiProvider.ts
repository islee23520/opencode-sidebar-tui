import * as vscode from "vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalDiscoveryService } from "../services/TerminalDiscoveryService";
import { OutputCaptureManager } from "../services/OutputCaptureManager";

export class OpenCodeTuiProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencodeTui";
  private _view?: vscode.WebviewView;
  private terminalId = "opencode-main";
  private isStarted = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly discoveryService: TerminalDiscoveryService,
    private readonly captureManager: OutputCaptureManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });

    const config = vscode.workspace.getConfiguration("opencodeTui");
    if (config.get<boolean>("autoStartOnOpen", true)) {
      // Only start if sidebar is currently visible
      if (webviewView.visible) {
        this.startOpenCode();
      } else {
        // Wait until sidebar becomes visible
        const visibilityListener = webviewView.onDidChangeVisibility(() => {
          if (webviewView.visible) {
            // Notify webview that it's now visible so it can refit the terminal
            this._view?.webview.postMessage({ type: "webviewVisible" });
            if (!this.isStarted) {
              this.startOpenCode();
              visibilityListener.dispose(); // Only trigger once
            }
          }
        });

        // Clean up listener when view is disposed
        webviewView.onDidDispose(() => visibilityListener.dispose());
      }
    }
  }

  public focus(): void {
    if (this._view && this._view.webview) {
      this._view.webview.postMessage({ type: "focusTerminal" });
    }
  }

  startOpenCode(): void {
    if (this.isStarted) {
      return;
    }

    const config = vscode.workspace.getConfiguration("opencodeTui");
    const command = config.get<string>("command", "opencode -c");

    this.terminalManager.createTerminal(this.terminalId, command);

    this.terminalManager.onData((event) => {
      if (event.id === this.terminalId) {
        this._view?.webview.postMessage({
          type: "terminalOutput",
          data: event.data,
        });
      }
    });

    this.terminalManager.onExit((id) => {
      if (id === this.terminalId) {
        this.isStarted = false;
        this._view?.webview.postMessage({
          type: "terminalExited",
        });
      }
    });

    this.isStarted = true;
  }

  restart(): void {
    this.terminalManager.killTerminal(this.terminalId);
    this.isStarted = false;
    this.startOpenCode();
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case "terminalInput":
        this.terminalManager.writeToTerminal(this.terminalId, message.data);
        break;
      case "terminalResize":
        this.terminalManager.resizeTerminal(
          this.terminalId,
          message.cols,
          message.rows,
        );
        break;
      case "ready":
        if (!this.isStarted) {
          this.startOpenCode();
        }
        // Send platform info to webview for Windows-specific handling
        this._view?.webview.postMessage({
          type: "platformInfo",
          platform: process.platform,
        });
        break;
      case "filesDropped":
        this.handleFilesDropped(message.files, message.shiftKey);
        break;
      case "openUrl":
        vscode.env.openExternal(vscode.Uri.parse(message.url));
        break;
      case "openFile":
        this.handleOpenFile(
          message.path,
          message.line,
          message.endLine,
          message.column,
        );
        break;
      case "listTerminals":
        this.handleListTerminals();
        break;
      case "terminalAction":
        this.handleTerminalAction(
          message.action,
          message.terminalName,
          message.command,
        );
        break;
    }
  }

  private async handleListTerminals(): Promise<void> {
    const terminals = await this.discoveryService.getTerminals();
    this._view?.webview.postMessage({
      type: "terminalList",
      terminals: terminals,
    });
  }

  private async handleTerminalAction(
    action: "focus" | "sendCommand" | "capture",
    terminalName: string,
    command?: string,
  ): Promise<void> {
    const terminals = vscode.window.terminals;

    let targetTerminal: vscode.Terminal | undefined = terminals.find(
      (t) => t.name === terminalName,
    );

    if (!targetTerminal) {
      const terminalInfos = await this.discoveryService.getTerminals();
      const info = terminalInfos.find((t) => t.name === terminalName);
      if (info) {
        for (const t of terminals) {
          const pid = await t.processId;
          if (pid === info.pid) {
            targetTerminal = t;
            break;
          }
        }
      }
    }

    if (!targetTerminal) {
      console.warn(`Terminal not found: ${terminalName}`);
      return;
    }

    switch (action) {
      case "focus":
        targetTerminal.show();
        break;
      case "sendCommand":
        if (command) {
          await this.sendCommandToTerminal(targetTerminal, command);
        }
        break;
      case "capture":
        try {
          this.captureManager.startCapture(targetTerminal);
          vscode.window.showInformationMessage(
            `Started capturing terminal: ${terminalName}`,
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to start capture: ${e}`);
        }
        break;
    }
  }

  private async sendCommandToTerminal(
    terminal: vscode.Terminal,
    command: string,
  ): Promise<void> {
    const configKey = "opencodeTui.allowTerminalCommands";
    const allowed = this.context.globalState.get<boolean>(configKey);

    if (allowed) {
      terminal.sendText(command);
      return;
    }

    const result = await vscode.window.showInformationMessage(
      "Allow OpenCode to send commands to external terminals?",
      "Yes",
      "Yes, don't ask again",
      "No",
    );

    if (result === "Yes") {
      terminal.sendText(command);
    } else if (result === "Yes, don't ask again") {
      await this.context.globalState.update(configKey, true);
      terminal.sendText(command);
    }
  }

  private async handleOpenFile(
    path: string,
    line?: number,
    endLine?: number,
    column?: number,
  ): Promise<void> {
    // Security: Validate path to prevent path traversal attacks
    if (path.includes("..") || path.includes("\0") || path.includes("~")) {
      vscode.window.showErrorMessage(
        "Invalid file path: Path traversal detected",
      );
      return;
    }

    try {
      const normalizedPath = path.replace(/\\/g, "/");

      let uri: vscode.Uri;

      if (vscode.Uri.parse(path).scheme === "file") {
        uri = vscode.Uri.file(path);
      } else if (normalizedPath.startsWith("/")) {
        uri = vscode.Uri.file(normalizedPath);
      } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          uri = vscode.Uri.joinPath(workspaceFolders[0].uri, normalizedPath);
        } else {
          uri = vscode.Uri.file(normalizedPath);
        }
      }

      try {
        const selection = this.createSelection(line, endLine, column);

        await vscode.window.showTextDocument(uri, {
          selection,
          preview: true,
        });
      } catch (openError) {
        const matchedUri = await this.fuzzyMatchFile(normalizedPath);
        if (matchedUri) {
          const selection = this.createSelection(line, endLine, column);

          await vscode.window.showTextDocument(matchedUri, {
            selection,
            preview: true,
          });
        } else {
          vscode.window.showErrorMessage(`Failed to open file: ${path}`);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${path}`);
    }
  }

  private createSelection(
    line?: number,
    endLine?: number,
    column?: number,
  ): vscode.Range | undefined {
    if (!line) return undefined;

    const MAX_COLUMN = 9999;
    return new vscode.Range(
      Math.max(0, line - 1),
      Math.max(0, (column || 1) - 1),
      Math.max(0, (endLine || line) - 1),
      endLine ? MAX_COLUMN : Math.max(0, (column || 1) - 1),
    );
  }

  private async fuzzyMatchFile(path: string): Promise<vscode.Uri | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      const pathParts = path.split("/").filter((part) => part.length > 0);
      const filename = pathParts[pathParts.length - 1];

      const pattern = `**/${filename}*`;
      const files = await vscode.workspace.findFiles(pattern, null, 100);

      files.sort((a, b) => {
        const aPath = a.fsPath.toLowerCase();
        const bPath = b.fsPath.toLowerCase();
        const lowerPath = path.toLowerCase();

        if (aPath.endsWith(lowerPath)) return -1;
        if (bPath.endsWith(lowerPath)) return 1;

        const aDirParts = a.fsPath.split("/");
        const bDirParts = b.fsPath.split("/");

        for (let i = 0; i < pathParts.length - 1; i++) {
          const expectedPart = pathParts[i].toLowerCase();
          if (aDirParts[i] && aDirParts[i].toLowerCase() === expectedPart) {
            return -1;
          }
          if (bDirParts[i] && bDirParts[i].toLowerCase() === expectedPart) {
            return 1;
          }
        }

        return 0;
      });

      return files[0] || null;
    } catch (error) {
      console.error("Fuzzy match failed:", error);
      return null;
    }
  }

  private handleFilesDropped(files: string[], shiftKey: boolean): void {
    console.log(
      "[PROVIDER] handleFilesDropped - files:",
      files,
      "shiftKey:",
      shiftKey,
    );
    if (shiftKey) {
      const fileRefs = files
        .map((file) => `@${vscode.workspace.asRelativePath(file)}`)
        .join(" ");
      console.log("[PROVIDER] Writing with @:", fileRefs);
      this.terminalManager.writeToTerminal(this.terminalId, fileRefs + " ");
    } else {
      const filePaths = files
        .map((file) => vscode.workspace.asRelativePath(file))
        .join(" ");
      console.log("[PROVIDER] Writing without @:", filePaths);
      this.terminalManager.writeToTerminal(this.terminalId, filePaths + " ");
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode TUI</title>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
      background-color: #1e1e1e;
    }
    #terminal-container {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  dispose(): void {
    if (this.isStarted) {
      this.terminalManager.killTerminal(this.terminalId);
    }
  }
}
