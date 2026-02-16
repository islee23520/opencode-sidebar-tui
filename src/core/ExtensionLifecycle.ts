import * as vscode from "vscode";
import { OpenCodeTuiProvider } from "../providers/OpenCodeTuiProvider";
import { OpenCodeCodeActionProvider } from "../providers/CodeActionProvider";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { StatusBarManager } from "../services/StatusBarManager";
import { ContextManager } from "../services/ContextManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { InstanceDiscoveryService } from "../services/InstanceDiscoveryService";

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: OpenCodeTuiProvider | undefined;
  private captureManager: OutputCaptureManager | undefined;
  private contextSharingService: ContextSharingService | undefined;
  private statusBarManager: StatusBarManager | undefined;
  private outputChannelService: OutputChannelService | undefined;
  private contextManager: ContextManager | undefined;
  private instanceDiscoveryService: InstanceDiscoveryService | undefined;
  private codeActionProvider: OpenCodeCodeActionProvider | undefined;

  private static readonly DEFAULT_HTTP_PORT = 16384;
  private static readonly TERMINAL_ID = "opencode-main";

  async activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = OutputChannelService.getInstance();
    logger.info("Initializing OpenCode Sidebar TUI...");

    try {
      // Initialize terminal manager
      this.terminalManager = new TerminalManager();

      // Initialize services
      this.captureManager = new OutputCaptureManager();
      this.contextSharingService = new ContextSharingService();
      this.outputChannelService = logger;
      this.statusBarManager = new StatusBarManager();
      this.contextManager = new ContextManager(this.outputChannelService);
      this.instanceDiscoveryService = new InstanceDiscoveryService();

      this.statusBarManager.show();
      context.subscriptions.push(this.statusBarManager);
      context.subscriptions.push(this.contextManager);
      context.subscriptions.push(this.instanceDiscoveryService);

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

      const codeActionApiClient =
        this.tuiProvider.getApiClient() ??
        new OpenCodeApiClient(ExtensionLifecycle.DEFAULT_HTTP_PORT);
      this.codeActionProvider = new OpenCodeCodeActionProvider(
        this.contextManager,
        codeActionApiClient,
      );

      const codeActionRegistration =
        vscode.languages.registerCodeActionsProvider(
          "*",
          this.codeActionProvider,
          {
            providedCodeActionKinds:
              OpenCodeCodeActionProvider.providedCodeActionKinds,
          },
        );
      const explainAndFixCommand = this.codeActionProvider.registerCommand();
      context.subscriptions.push(codeActionRegistration, explainAndFixCommand);

      logger.info("OpenCode Sidebar TUI activated successfully");
    } catch (error) {
      logger.error(
        `Failed to activate OpenCode Sidebar TUI: ${error instanceof Error ? error.message : String(error)}`,
      );
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
            ExtensionLifecycle.TERMINAL_ID,
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
          this.terminalManager?.writeToTerminal(
            ExtensionLifecycle.TERMINAL_ID,
            fileRef + " ",
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

          vscode.window.showInformationMessage(`Sent ${fileRef}`);
        }
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
            ExtensionLifecycle.TERMINAL_ID,
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
          this.terminalManager?.writeToTerminal(
            ExtensionLifecycle.TERMINAL_ID,
            fileRef + " ",
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
          this.outputChannelService?.error(
            `[OpenCodeTui] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
          );
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
      pasteCommand,
    );
  }

  async deactivate(): Promise<void> {
    this.outputChannelService?.info("Deactivating OpenCode Sidebar TUI...");

    if (this.tuiProvider) {
      this.tuiProvider.dispose();
      this.tuiProvider = undefined;
    }

    if (this.terminalManager) {
      this.terminalManager.dispose();
      this.terminalManager = undefined;
    }

    if (this.statusBarManager) {
      this.statusBarManager.dispose();
      this.statusBarManager = undefined;
    }

    const logger = this.outputChannelService;

    if (this.outputChannelService) {
      this.outputChannelService.dispose();
      this.outputChannelService = undefined;
      OutputChannelService.resetInstance();
    }

    if (this.contextManager) {
      this.contextManager.dispose();
      this.contextManager = undefined;
    }

    if (this.instanceDiscoveryService) {
      this.instanceDiscoveryService.dispose();
      this.instanceDiscoveryService = undefined;
    }

    this.codeActionProvider = undefined;

    this.captureManager = undefined;
    this.contextSharingService = undefined;

    logger?.info("OpenCode Sidebar TUI deactivated");
  }
}
