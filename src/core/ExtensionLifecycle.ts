import * as vscode from "vscode";
import { OpenCodeTuiProvider } from "../providers/OpenCodeTuiProvider";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalDiscoveryService } from "../services/TerminalDiscoveryService";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { ContextSharingService } from "../services/ContextSharingService";

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: OpenCodeTuiProvider | undefined;
  private discoveryService: TerminalDiscoveryService | undefined;
  private captureManager: OutputCaptureManager | undefined;
  private contextSharingService: ContextSharingService | undefined;

  async activate(context: vscode.ExtensionContext): Promise<void> {
    console.log("Initializing OpenCode Sidebar TUI...");

    try {
      // Initialize terminal manager
      this.terminalManager = new TerminalManager();

      // Initialize services
      this.discoveryService = new TerminalDiscoveryService();
      this.captureManager = new OutputCaptureManager();
      this.contextSharingService = new ContextSharingService();

      // Handle terminal closure for cleanup
      context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
          this.captureManager?.cleanup(terminal);
        }),
      );

      // Initialize TUI provider
      this.tuiProvider = new OpenCodeTuiProvider(
        context,
        this.terminalManager,
        this.discoveryService,
        this.captureManager,
      );

      // Register webview provider
      const provider = vscode.window.registerWebviewViewProvider(
        OpenCodeTuiProvider.viewType,
        this.tuiProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      );
      context.subscriptions.push(provider);

      // Register commands
      this.registerCommands(context);

      console.log("OpenCode Sidebar TUI activated successfully");
    } catch (error) {
      console.error("Failed to activate OpenCode Sidebar TUI:", error);
      vscode.window.showErrorMessage(
        `Failed to activate OpenCode Sidebar TUI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    // Start OpenCode command
    const startCommand = vscode.commands.registerCommand(
      "opencodeTui.start",
      () => {
        this.tuiProvider?.startOpenCode();
      },
    );

    // Send selected text to terminal
    const sendToTerminalCommand = vscode.commands.registerCommand(
      "opencodeTui.sendToTerminal",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
          const selectedText = editor.document.getText(editor.selection);
          this.terminalManager?.writeToTerminal(
            "opencode-main",
            selectedText + "\n",
          );

          // Auto-focus sidebar if enabled
          const config = vscode.workspace.getConfiguration("opencodeTui");
          if (config.get<boolean>("autoFocusOnSend", true)) {
            vscode.commands.executeCommand("opencodeTui.focus");
            // Also focus the terminal inside the webview
            setTimeout(() => {
              this.tuiProvider?.focus();
            }, 100);
          }

          vscode.window.showInformationMessage("Sent to OpenCode");
        }
      },
    );

    // Send current file reference (@filename) or terminal CWD
    const sendAtMentionCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAtMention",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && this.contextSharingService) {
          const fileRef =
            this.contextSharingService.formatFileRefWithLineNumbers(editor);
          this.terminalManager?.writeToTerminal("opencode-main", fileRef + " ");

          // Auto-focus sidebar if enabled
          const config = vscode.workspace.getConfiguration("opencodeTui");
          if (config.get<boolean>("autoFocusOnSend", true)) {
            vscode.commands.executeCommand("opencodeTui.focus");
            // Also focus the terminal inside the webview
            setTimeout(() => {
              this.tuiProvider?.focus();
            }, 100);
          }

          vscode.window.showInformationMessage(`Sent ${fileRef}`);
        } else {
          // If no editor is active but terminal is focused, send terminal CWD
          this.sendTerminalCwd();
        }
      },
    );

    // Send terminal's current working directory
    const sendTerminalCwdCommand = vscode.commands.registerCommand(
      "opencodeTui.sendTerminalCwd",
      () => {
        this.sendTerminalCwd();
      },
    );

    // Send all open file references
    const sendAllOpenFilesCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAllOpenFiles",
      () => {
        const fileRefs: string[] = [];

        // Get all opened tabs across all editor groups (not just visible ones)
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
              const uri = tab.input.uri;
              // Skip untitled/unsaved documents
              if (
                !uri.scheme.startsWith("untitled") &&
                this.contextSharingService
              ) {
                fileRefs.push(this.contextSharingService.formatFileRef(uri));
              }
            }
          }
        }

        const openFiles = fileRefs.join(" ");

        if (openFiles) {
          this.terminalManager?.writeToTerminal(
            "opencode-main",
            openFiles + " ",
          );

          // Auto-focus sidebar if enabled
          const config = vscode.workspace.getConfiguration("opencodeTui");
          if (config.get<boolean>("autoFocusOnSend", true)) {
            vscode.commands.executeCommand("opencodeTui.focus");
            // Also focus the terminal inside the webview
            setTimeout(() => {
              this.tuiProvider?.focus();
            }, 100);
          }

          vscode.window.showInformationMessage("Sent all open files");
        }
      },
    );

    // Send file/folder from explorer context menu
    const sendFileToTerminalCommand = vscode.commands.registerCommand(
      "opencodeTui.sendFileToTerminal",
      (uri: vscode.Uri) => {
        if (uri && this.contextSharingService) {
          const fileRef = this.contextSharingService.formatFileRef(uri);
          this.terminalManager?.writeToTerminal("opencode-main", fileRef + " ");

          // Auto-focus sidebar if enabled
          const config = vscode.workspace.getConfiguration("opencodeTui");
          if (config.get<boolean>("autoFocusOnSend", true)) {
            vscode.commands.executeCommand("opencodeTui.focus");
            // Also focus the terminal inside the webview
            setTimeout(() => {
              this.tuiProvider?.focus();
            }, 100);
          }

          vscode.window.showInformationMessage(`Sent ${fileRef}`);
        }
      },
    );

    // Restart OpenCode command
    const restartCommand = vscode.commands.registerCommand(
      "opencodeTui.restart",
      () => {
        this.tuiProvider?.restart();
        vscode.window.showInformationMessage("OpenCode restarted");
      },
    );

    const pasteCommand = vscode.commands.registerCommand(
      "opencodeTui.paste",
      async () => {
        try {
          const text = await vscode.env.clipboard.readText();
          if (text && this.tuiProvider) {
            this.tuiProvider.pasteText(text);
          }
        } catch (error) {
          console.error("[OpenCodeTui] Failed to paste:", error);
          vscode.window.showErrorMessage("Failed to paste from clipboard");
        }
      },
    );

    context.subscriptions.push(
      startCommand,
      sendToTerminalCommand,
      sendAtMentionCommand,
      sendAllOpenFilesCommand,
      sendFileToTerminalCommand,
      restartCommand,
      sendTerminalCwdCommand,
      pasteCommand,
    );
  }

  private async sendTerminalCwd(): Promise<void> {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) {
      vscode.window.showWarningMessage("No active terminal");
      return;
    }

    const cwd = activeTerminal.shellIntegration?.cwd?.fsPath;
    if (!cwd) {
      vscode.window.showWarningMessage(
        "Could not determine terminal working directory. Make sure shell integration is enabled.",
      );
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    let reference: string;

    if (workspaceFolders && workspaceFolders.length > 0) {
      const relativePath = vscode.workspace.asRelativePath(cwd, false);
      reference = `@${relativePath}`;
    } else {
      reference = `@${cwd}`;
    }

    this.terminalManager?.writeToTerminal("opencode-main", reference + " ");

    const config = vscode.workspace.getConfiguration("opencodeTui");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("opencodeTui.focus");
      setTimeout(() => {
        this.tuiProvider?.focus();
      }, 100);
    }

    vscode.window.showInformationMessage(`Sent ${reference}`);
  }

  async deactivate(): Promise<void> {
    console.log("Deactivating OpenCode Sidebar TUI...");

    if (this.tuiProvider) {
      this.tuiProvider.dispose();
      this.tuiProvider = undefined;
    }

    if (this.terminalManager) {
      this.terminalManager.dispose();
      this.terminalManager = undefined;
    }

    if (this.discoveryService) {
      this.discoveryService.dispose();
      this.discoveryService = undefined;
    }

    this.captureManager = undefined;
    this.contextSharingService = undefined;

    console.log("OpenCode Sidebar TUI deactivated");
  }
}
