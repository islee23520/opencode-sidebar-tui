import * as vscode from "vscode";
import { OpenCodeTuiProvider } from "../providers/OpenCodeTuiProvider";
import { TerminalManager } from "../terminals/TerminalManager";

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: OpenCodeTuiProvider | undefined;

  async activate(context: vscode.ExtensionContext): Promise<void> {
    console.log("Initializing OpenCode Sidebar TUI...");

    try {
      // Initialize terminal manager
      this.terminalManager = new TerminalManager();

      // Initialize TUI provider
      this.tuiProvider = new OpenCodeTuiProvider(context, this.terminalManager);

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

    // Send current file reference (@filename)
    const sendAtMentionCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAtMention",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const fileRef = this.formatFileRefWithLineNumbers(editor);
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

    // Send all open file references
    const sendAllOpenFilesCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAllOpenFiles",
      () => {
        const openFiles = vscode.window.visibleTextEditors
          .map((editor) => this.formatFileRef(editor.document.uri))
          .join(" ");

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
        if (uri) {
          const fileRef = this.formatFileRef(uri);
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

    context.subscriptions.push(
      startCommand,
      sendToTerminalCommand,
      sendAtMentionCommand,
      sendAllOpenFilesCommand,
      sendFileToTerminalCommand,
    );
  }

  private formatFileRef(uri: vscode.Uri): string {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return `@${relativePath}`;
  }

  private formatFileRefWithLineNumbers(editor: vscode.TextEditor): string {
    const relativePath = vscode.workspace.asRelativePath(
      editor.document.uri,
      false,
    );
    let reference = `@${relativePath}`;

    const selection = editor.selection;
    if (!selection.isEmpty) {
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      if (startLine === endLine) {
        reference += `#L${startLine}`;
      } else {
        reference += `#L${startLine}-L${endLine}`;
      }
    }

    return reference;
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

    console.log("OpenCode Sidebar TUI deactivated");
  }
}
