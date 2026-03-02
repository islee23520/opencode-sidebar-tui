import * as vscode from "vscode";
import { OpenCodeTuiProvider } from "../providers/OpenCodeTuiProvider";
import { OpenCodeCodeActionProvider } from "../providers/CodeActionProvider";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { StatusBarManager } from "../services/StatusBarManager";
import { ContextManager } from "../services/ContextManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { InstanceDiscoveryService } from "../services/InstanceDiscoveryService";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { InstanceStore } from "../services/InstanceStore";
import { InstanceRegistry } from "../services/InstanceRegistry";
import { InstancesDashboardProvider } from "../providers/InstancesDashboardProvider";

// Module-level state for batching file sends from context menu
let fileSendAccumulator: vscode.Uri[] = [];
let fileSendTimeout: NodeJS.Timeout | undefined;

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
  private instanceStore: InstanceStore | undefined;
  private instanceRegistry: InstanceRegistry | undefined;
  private instancesDashboardProvider: InstancesDashboardProvider | undefined;

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
      this.contextManager = new ContextManager(this.outputChannelService);
      this.instanceDiscoveryService = new InstanceDiscoveryService();

      // Initialize multi-instance support
      this.instanceStore = new InstanceStore();
      this.instanceRegistry = new InstanceRegistry(context);
      this.instanceRegistry.hydrate(this.instanceStore);

      // Initialize status bar with instance store for live updates
      this.statusBarManager = new StatusBarManager(this.instanceStore);
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
        this.instanceStore,
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

      // Register instances dashboard provider
      this.instancesDashboardProvider = new InstancesDashboardProvider(
        context,
        this.instanceStore,
      );
      const dashboardProvider = vscode.window.registerWebviewViewProvider(
        InstancesDashboardProvider.viewType,
        this.instancesDashboardProvider,
      );
      context.subscriptions.push(dashboardProvider);

      // Register commands
      this.registerCommands(context);

      this.codeActionProvider = new OpenCodeCodeActionProvider(
        this.contextManager,
        (prompt) => this.sendPromptToOpenCode(prompt),
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
        } else {
          this.sendTerminalCwd();
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
      (uri: vscode.Uri | vscode.Uri[]) => {
        if (!uri || !this.contextSharingService) {
          return;
        }

        // Handle array case (if VS Code ever passes it)
        const uris = Array.isArray(uri) ? uri : [uri];

        fileSendAccumulator.push(...uris);

        if (fileSendTimeout) {
          clearTimeout(fileSendTimeout);
        }

        fileSendTimeout = setTimeout(() => {
          if (fileSendAccumulator.length === 0) {
            return;
          }

          const uniqueUris = [
            ...new Map(
              fileSendAccumulator.map((u: vscode.Uri) => [u.fsPath, u]),
            ).values(),
          ];

          const fileRefs = uniqueUris.map((u: vscode.Uri) =>
            this.contextSharingService!.formatFileRef(u),
          );
          const allRefs = fileRefs.join(" ");

          this.terminalManager?.writeToTerminal(
            ExtensionLifecycle.TERMINAL_ID,
            allRefs + " ",
          );

          const config = vscode.workspace.getConfiguration("opencodeTui");
          if (config.get<boolean>("autoFocusOnSend", true)) {
            vscode.commands.executeCommand("opencodeTui.focus");
            setTimeout(() => {
              this.tuiProvider?.focus();
            }, 100);
          }

          const message =
            uniqueUris.length > 1
              ? `Sent ${uniqueUris.length} files`
              : `Sent ${fileRefs[0]}`;
          vscode.window.showInformationMessage(message);

          fileSendAccumulator = [];
        }, 100);
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

    // Open in new window
    const openInNewWindowCommand = vscode.commands.registerCommand(
      "opencode.openInNewWindow",
      async () => {
        if (!this.instanceStore) {
          vscode.window.showErrorMessage("Instance store is not initialized");
          return;
        }

        try {
          const active = this.instanceStore.getActive();
          const newId = `${Date.now()}`;
          const newRecord = {
            config: {
              id: newId,
              workspaceUri: active.config.workspaceUri,
              label: `${active.config.label || "OpenCode"} (New Window)`,
            },
            runtime: {},
            state: "disconnected" as const,
          };

          this.instanceStore.upsert(newRecord);
          vscode.window.showInformationMessage(`Opened in new window: ${newRecord.config.label}`);
        } catch (error) {
          this.outputChannelService?.error(
            `Failed to open in new window: ${error instanceof Error ? error.message : String(error)}`,
          );
          vscode.window.showErrorMessage(
            `Failed to open in new window: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    );

    // Spawn for workspace
    const spawnForWorkspaceCommand = vscode.commands.registerCommand(
      "opencode.spawnForWorkspace",
      async (uri?: vscode.Uri) => {
        if (!this.instanceStore) {
          vscode.window.showErrorMessage("Instance store is not initialized");
          return;
        }

        try {
          const workspaceUri = uri?.toString() || vscode.workspace.workspaceFolders?.[0]?.uri.toString();
          if (!workspaceUri) {
            vscode.window.showWarningMessage("No workspace folder available");
            return;
          }

          const newId = `${Date.now()}`;
          const newRecord = {
            config: {
              id: newId,
              workspaceUri,
              label: `OpenCode (${vscode.workspace.name || "Workspace"})`,
            },
            runtime: {},
            state: "disconnected" as const,
          };

          this.instanceStore.upsert(newRecord);
          vscode.window.showInformationMessage(`Spawned OpenCode for workspace: ${newRecord.config.label}`);
        } catch (error) {
          this.outputChannelService?.error(
            `Failed to spawn for workspace: ${error instanceof Error ? error.message : String(error)}`,
          );
          vscode.window.showErrorMessage(
            `Failed to spawn for workspace: ${error instanceof Error ? error.message : String(error)}`,
          );
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
      openInNewWindowCommand,
      spawnForWorkspaceCommand,
    );
  }

  private async sendPromptToOpenCode(prompt: string): Promise<void> {
    if (!this.tuiProvider || !this.terminalManager) {
      throw new Error("OpenCode provider is not initialized");
    }

    if (!this.terminalManager.getTerminal(ExtensionLifecycle.TERMINAL_ID)) {
      const sentByDiscovery =
        await this.trySendPromptViaDiscoveredInstance(prompt);
      if (sentByDiscovery) {
        return;
      }

      await this.tuiProvider.startOpenCode();
    }

    const apiClient = this.tuiProvider.getApiClient();
    if (apiClient && this.tuiProvider.isHttpAvailable()) {
      try {
        await apiClient.appendPrompt(prompt);
      } catch (error) {
        this.outputChannelService?.warn(
          `Failed to send prompt via HTTP API, falling back to terminal input: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.terminalManager.writeToTerminal(
          ExtensionLifecycle.TERMINAL_ID,
          `${prompt}\n`,
        );
      }
    } else {
      this.terminalManager.writeToTerminal(
        ExtensionLifecycle.TERMINAL_ID,
        `${prompt}\n`,
      );
    }

    const config = vscode.workspace.getConfiguration("opencodeTui");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("opencodeTui.focus");
      setTimeout(() => {
        this.tuiProvider?.focus();
      }, 100);
    }
  }

  private async trySendPromptViaDiscoveredInstance(
    prompt: string,
  ): Promise<boolean> {
    if (!this.instanceDiscoveryService) {
      return false;
    }

    try {
      const discovered =
        await this.instanceDiscoveryService.discoverInstances();
      const primary = discovered[0];
      if (!primary) {
        return false;
      }

      const client = new OpenCodeApiClient(primary.port, 3, 200, 3000);
      await client.appendPrompt(prompt);
      this.outputChannelService?.info(
        `Sent prompt via discovered OpenCode instance on port ${primary.port}`,
      );
      return true;
    } catch (error) {
      this.outputChannelService?.warn(
        `Failed to send prompt via discovered instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private sendTerminalCwd(): void {
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
    const reference =
      workspaceFolders && workspaceFolders.length > 0
        ? `@${vscode.workspace.asRelativePath(cwd, false)}`
        : `@${cwd}`;

    this.terminalManager?.writeToTerminal(
      ExtensionLifecycle.TERMINAL_ID,
      reference + " ",
    );

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

    if (this.instanceRegistry) {
      this.instanceRegistry.dispose();
      this.instanceRegistry = undefined;
    }

    if (this.instancesDashboardProvider) {
      this.instancesDashboardProvider.dispose();
      this.instancesDashboardProvider = undefined;
    }

    if (this.instanceStore) {
      this.instanceStore = undefined;
    }

    this.codeActionProvider = undefined;

    this.captureManager = undefined;
    this.contextSharingService = undefined;

    logger?.info("OpenCode Sidebar TUI deactivated");
  }
}
