import * as vscode from "vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { PortManager } from "../services/PortManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { OutputChannelService } from "../services/OutputChannelService";

export class OpenCodeTuiProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencodeTui";
  private _view?: vscode.WebviewView;
  private terminalId = "opencode-main";
  private isStarted = false;
  private apiClient?: OpenCodeApiClient;
  private readonly portManager: PortManager;
  private readonly contextSharingService: ContextSharingService;
  private readonly logger = OutputChannelService.getInstance();
  private httpAvailable = false;
  private autoContextSent = false;
  private dataListener?: vscode.Disposable;
  private exitListener?: vscode.Disposable;
  private lastKnownCols: number = 0;
  private lastKnownRows: number = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly captureManager: OutputCaptureManager,
  ) {
    this.portManager = new PortManager();
    this.contextSharingService = new ContextSharingService();
  }

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

    const processAlive =
      this.isStarted &&
      this.terminalManager.getTerminal(this.terminalId) !== undefined;

    if (this.isStarted && !processAlive) {
      this.resetState();
    }

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });

    if (processAlive) {
      this.reconnectListeners();
    }

    const config = vscode.workspace.getConfiguration("opencodeTui");
    if (config.get<boolean>("autoStartOnOpen", true)) {
      // Only start if sidebar is currently visible
      if (webviewView.visible) {
        if (!this.isStarted) {
          this.startOpenCode();
        }
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

  /**
   * Reconnect data/exit listeners when the webview is re-created.
   */
  private reconnectListeners(): void {
    this.disposeListeners();

    this.dataListener = this.terminalManager.onData((event) => {
      if (event.id === this.terminalId) {
        this._view?.webview.postMessage({
          type: "terminalOutput",
          data: event.data,
        });
      }
    });

    this.exitListener = this.terminalManager.onExit((id) => {
      if (id === this.terminalId) {
        this.resetState();
        this._view?.webview.postMessage({
          type: "terminalExited",
        });
      }
    });
  }

  public focus(): void {
    if (this._view && this._view.webview) {
      this._view.webview.postMessage({ type: "focusTerminal" });
    }
  }

  public pasteText(text: string): void {
    this._view?.webview.postMessage({
      type: "clipboardContent",
      text: text,
    });
  }

  public getApiClient(): OpenCodeApiClient | undefined {
    return this.apiClient;
  }

  async startOpenCode(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.disposeListeners();

    const config = vscode.workspace.getConfiguration("opencodeTui");
    const enableHttpApi = config.get<boolean>("enableHttpApi", true);
    const httpTimeout = config.get<number>("httpTimeout", 5000);
    const command = config.get<string>("command", "opencode -c");

    let port: number | undefined;

    if (enableHttpApi) {
      try {
        port = this.portManager.assignPortToTerminal(this.terminalId);
        this.logger.info(
          `[OpenCodeTuiProvider] Assigned port ${port} to terminal ${this.terminalId}`,
        );
      } catch (error) {
        this.logger.error(
          `[OpenCodeTuiProvider] Failed to assign port: ${error instanceof Error ? error.message : String(error)}`,
        );
        vscode.window.showWarningMessage(
          "Failed to assign port for OpenCode HTTP API. Running without HTTP features.",
        );
      }
    }

    const terminal = this.terminalManager.createTerminal(
      this.terminalId,
      command,
      port
        ? {
            _EXTENSION_OPENCODE_PORT: port.toString(),
            OPENCODE_CALLER: "vscode",
          }
        : {},
      port,
      this.lastKnownCols || undefined,
      this.lastKnownRows || undefined,
    );

    this.dataListener = this.terminalManager.onData((event) => {
      if (event.id === this.terminalId) {
        this._view?.webview.postMessage({
          type: "terminalOutput",
          data: event.data,
        });
      }
    });

    this.exitListener = this.terminalManager.onExit((id) => {
      if (id === this.terminalId) {
        this.resetState();
        this._view?.webview.postMessage({
          type: "terminalExited",
        });
      }
    });

    this.isStarted = true;

    if (enableHttpApi && port) {
      this.apiClient = new OpenCodeApiClient(port, 10, 200, httpTimeout);
      await this.pollForHttpReadiness();
    } else {
      this.logger.info(
        "[OpenCodeTuiProvider] HTTP API disabled or unavailable, using message passing fallback",
      );
      this.httpAvailable = false;
    }
  }

  private async pollForHttpReadiness(): Promise<void> {
    if (!this.apiClient) {
      return;
    }

    const maxRetries = 10;
    const delayMs = 200;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const isHealthy = await this.apiClient.healthCheck();
        if (isHealthy) {
          this.httpAvailable = true;
          this.logger.info("[OpenCodeTuiProvider] HTTP API is ready");
          await this.sendAutoContext();
          return;
        }
      } catch {
        this.logger.info(
          `[OpenCodeTuiProvider] Health check attempt ${attempt}/${maxRetries} failed`,
        );
      }

      if (attempt < maxRetries) {
        await this.sleep(delayMs);
      }
    }

    this.logger.info(
      "[OpenCodeTuiProvider] HTTP API not available after retries, using message passing fallback",
    );
    this.httpAvailable = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sends auto-context to OpenCode when the terminal starts and HTTP is ready.
   * Respects the autoShareContext configuration setting.
   */
  private async sendAutoContext(): Promise<void> {
    // Only send once per terminal session
    if (this.autoContextSent) {
      return;
    }

    const config = vscode.workspace.getConfiguration("opencodeTui");
    const enableHttpApi = config.get<boolean>("enableHttpApi", true);
    const autoShareContext = config.get<boolean>("autoShareContext", true);

    if (!enableHttpApi) {
      this.logger.info(
        "[OpenCodeTuiProvider] HTTP API disabled, skipping auto-context",
      );
      return;
    }

    if (!autoShareContext) {
      this.logger.info(
        "[OpenCodeTuiProvider] Auto-context sharing disabled by user",
      );
      return;
    }

    if (!this.httpAvailable || !this.apiClient) {
      this.logger.info(
        "[OpenCodeTuiProvider] HTTP not available, skipping auto-context",
      );
      return;
    }

    const context = this.contextSharingService.getCurrentContext();
    if (!context) {
      this.logger.info(
        "[OpenCodeTuiProvider] No active editor, skipping auto-context",
      );
      return;
    }

    const fileRef = this.contextSharingService.formatContext(context);
    this.logger.info(`[OpenCodeTuiProvider] Sending auto-context: ${fileRef}`);

    try {
      await this.apiClient.appendPrompt(fileRef);
      this.autoContextSent = true;
      this.logger.info(
        "[OpenCodeTuiProvider] Auto-context sent successfully via HTTP",
      );
    } catch (error) {
      this.logger.error(
        `[OpenCodeTuiProvider] Failed to send auto-context: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  restart(): void {
    this.disposeListeners();
    this.terminalManager.killTerminal(this.terminalId);
    this.resetState();

    this._view?.webview.postMessage({ type: "clearTerminal" });

    this.startOpenCode();
  }

  private resetState(): void {
    this.isStarted = false;
    this.httpAvailable = false;
    this.apiClient = undefined;
    this.autoContextSent = false;
    this.portManager.releaseTerminalPorts(this.terminalId);
  }

  private disposeListeners(): void {
    if (this.dataListener) {
      this.dataListener.dispose();
      this.dataListener = undefined;
    }
    if (this.exitListener) {
      this.exitListener.dispose();
      this.exitListener = undefined;
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case "terminalInput":
        this.terminalManager.writeToTerminal(this.terminalId, message.data);
        break;
      case "terminalResize":
        this.lastKnownCols = message.cols;
        this.lastKnownRows = message.rows;
        this.terminalManager.resizeTerminal(
          this.terminalId,
          message.cols,
          message.rows,
        );
        break;
      case "ready":
        if (message.cols && message.rows) {
          this.lastKnownCols = message.cols;
          this.lastKnownRows = message.rows;
        }
        if (!this.isStarted) {
          this.startOpenCode();
        } else {
          if (this.lastKnownCols && this.lastKnownRows) {
            this.terminalManager.resizeTerminal(
              this.terminalId,
              this.lastKnownCols,
              this.lastKnownRows,
            );
          }
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

      case "getClipboard":
        this.handleGetClipboard();
        break;
      case "setClipboard":
        this.handleSetClipboard(message.text);
        break;
      case "triggerPaste":
        this.handlePaste();
        break;
    }
  }

  private async handleSetClipboard(text: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
    } catch (error) {
      this.logger.error(
        `[OpenCodeTuiProvider] Failed to write clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handlePaste(): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();
      if (text) {
        this.pasteText(text);
      }
    } catch (error) {
      this.logger.error(
        `[OpenCodeTuiProvider] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleGetClipboard(): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();
      this._view?.webview.postMessage({
        type: "clipboardContent",
        text: text,
      });
    } catch (error) {
      this.logger.error(
        `[OpenCodeTuiProvider] Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      this.logger.error(
        `Fuzzy match failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private handleFilesDropped(files: string[], shiftKey: boolean): void {
    this.logger.info(
      `[PROVIDER] handleFilesDropped - files: ${JSON.stringify(files)} shiftKey: ${shiftKey}`,
    );
    if (shiftKey) {
      const fileRefs = files
        .map((file) => `@${vscode.workspace.asRelativePath(file)}`)
        .join(" ");
      this.logger.info(`[PROVIDER] Writing with @: ${fileRefs}`);
      this.terminalManager.writeToTerminal(this.terminalId, fileRefs + " ");
    } else {
      const filePaths = files
        .map((file) => vscode.workspace.asRelativePath(file))
        .join(" ");
      this.logger.info(`[PROVIDER] Writing without @: ${filePaths}`);
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
    this.disposeListeners();
    if (this.isStarted) {
      this.terminalManager.killTerminal(this.terminalId);
    }
  }
}
