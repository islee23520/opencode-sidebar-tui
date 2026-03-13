import * as vscode from "vscode";
import { CliToolType } from "../types";
import { CliTuiProvider } from "../providers/OpenCodeTuiProvider";
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
import { InstanceQuickPick } from "../services/InstanceQuickPick";
import { InstanceController } from "../services/InstanceController";
import { PortManager } from "../services/PortManager";
import { ConnectionResolver } from "../services/ConnectionResolver";
import { ConfigMigration } from "../services/ConfigMigration";
import { CliReferenceSender } from "../services/CliReferenceSender";

// Module-level state for batching file sends from context menu
let fileSendAccumulator: vscode.Uri[] = [];
let fileSendTimeout: NodeJS.Timeout | undefined;

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: CliTuiProvider | undefined;
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
  private instanceQuickPick: InstanceQuickPick | undefined;
  private instanceController: InstanceController | undefined;
  private portManager: PortManager | undefined;
  private cliReferenceSender: CliReferenceSender | undefined;
  private isStartingTerminal: boolean = false;
  private lastSendAtMentionTime: number = 0;

  private static readonly TERMINAL_ID = "cli-main";
  private static readonly DEBOUNCE_MS = 500;

  /** Returns the terminal ID for the active instance, falling back to the static default. */
  private getActiveTerminalId(): string {
    try {
      const active = this.instanceStore?.getActive();
      if (active?.runtime.terminalKey) {
        return active.runtime.terminalKey;
      }
      if (active) {
        return active.config.id;
      }
      return ExtensionLifecycle.TERMINAL_ID;
    } catch {
      return ExtensionLifecycle.TERMINAL_ID;
    }
  }

  async activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = OutputChannelService.getInstance();
    logger.info("Initializing OpenCode Sidebar TUI...");

    try {
      await ConfigMigration.migrate(context);

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
      this.portManager = new PortManager(this.instanceStore);
      this.instanceRegistry = new InstanceRegistry(context);
      this.instanceRegistry.hydrate(this.instanceStore);

      // Initialize status bar with instance store for live updates
      this.statusBarManager = new StatusBarManager(this.instanceStore);
      this.statusBarManager.show();
      context.subscriptions.push(this.statusBarManager);
      context.subscriptions.push(this.contextManager);
      context.subscriptions.push(this.instanceDiscoveryService);

      this.instanceQuickPick = new InstanceQuickPick(
        this.instanceStore,
        this.instanceDiscoveryService,
      );

      // Initialize instance controller for spawn/connect/kill
      const connectionResolver = new ConnectionResolver(
        this.instanceStore,
        this.instanceDiscoveryService,
      );
      this.instanceController = new InstanceController(
        this.terminalManager,
        this.instanceStore,
        this.portManager,
        logger.getChannel(),
        connectionResolver,
      );

      // Handle terminal closure for cleanup
      context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
          this.captureManager?.cleanup(terminal);
        }),
      );

      // Initialize TUI provider
      this.tuiProvider = new CliTuiProvider(
        context,
        this.terminalManager,
        this.captureManager,
        this.instanceStore,
      );

      this.cliReferenceSender = new CliReferenceSender(
        this.terminalManager,
        () => this.tuiProvider?.getApiClient(),
        () => this.getActiveTerminalId(),
      );

      // Register webview provider
      const provider = vscode.window.registerWebviewViewProvider(
        CliTuiProvider.viewType,
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
        this.instanceController,
        logger.getChannel(),
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

      // Auto-serve OpenCode instances if enabled
      await this.handleAutoServe();
    } catch (error) {
      logger.error(
        `Failed to activate OpenCode Sidebar TUI: ${error instanceof Error ? error.message : String(error)}`,
      );
      vscode.window.showErrorMessage(
        `Failed to activate OpenCode Sidebar TUI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleAutoServe(): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const autoServe = config.get<boolean>("autoServe", false);

    if (!autoServe) {
      return;
    }

    const logger = OutputChannelService.getInstance();
    logger.info("Auto-serve is enabled, starting OpenCode in background...");

    const serveCommand = config.get<string>("serveCommand", "opencode serve");
    const toolId: CliToolType = "opencode";

    // Create a new instance for serve mode
    const instanceId = `opencode-serve-${Date.now()}`;

    try {
      // Check if there's already a running serve instance
      const existingInstances = this.instanceStore?.getAll() || [];
      const hasRunningServe = existingInstances.some(
        (inst) =>
          inst.config.toolId === toolId &&
          (inst.state === "connected" || inst.state === "spawning"),
      );

      if (hasRunningServe) {
        logger.info(
          "OpenCode serve instance already running, skipping auto-serve",
        );
        return;
      }

      // Create instance record
      this.instanceStore?.upsert({
        config: {
          id: instanceId,
          toolId: toolId,
          label: "OpenCode Serve (Auto)",
          command: serveCommand,
        },
        runtime: {},
        state: "disconnected",
      });

      // Spawn the instance
      const port = await this.instanceController?.spawn(instanceId, {
        command: serveCommand,
        args: [],
      });

      if (port) {
        logger.info(`OpenCode serve started on port ${port}`);
        vscode.window.showInformationMessage(
          `OpenCode serve started on port ${port}`,
        );
      }
    } catch (error) {
      logger.error(
        `Failed to auto-serve OpenCode: ${error instanceof Error ? error.message : String(error)}`,
      );
      vscode.window.showWarningMessage(
        `Failed to auto-start OpenCode serve: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    const openCommand = vscode.commands.registerCommand(
      "opencodeTui.open",
      async () => {
        await vscode.commands.executeCommand(
          "workbench.view.extension.opencodeTuiContainer",
        );
      },
    );

    const focusCommand = vscode.commands.registerCommand(
      "opencodeTui.focus",
      async () => {
        await vscode.commands.executeCommand(
          "workbench.view.extension.opencodeTuiContainer",
        );
        setTimeout(() => {
          this.tuiProvider?.focus();
        }, 100);
      },
    );

    // Start OpenCode command
    const startCommand = vscode.commands.registerCommand(
      "opencodeTui.start",
      () => {
        this.tuiProvider?.startDefaultTool();
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
            this.getActiveTerminalId(),
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

          vscode.window.setStatusBarMessage("$(check) Sent to OpenCode", 3000);
        }
      },
    );

    const sendAtMentionCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAtMention",
      async () => {
        const logger = OutputChannelService.getInstance();

        const now = Date.now();
        if (now - this.lastSendAtMentionTime < ExtensionLifecycle.DEBOUNCE_MS) {
          logger.info("[sendAtMention] Debounced - too soon since last call");
          return;
        }
        this.lastSendAtMentionTime = now;

        if (this.isStartingTerminal) {
          logger.info(
            "[sendAtMention] Terminal is already starting, please wait...",
          );
          vscode.window.setStatusBarMessage(
            "$(sync~spin) Terminal is starting, please wait...",
            3000,
          );
          return;
        }

        const editor = vscode.window.activeTextEditor;

        logger.info(
          `[sendAtMention] Command triggered. Editor: ${editor ? "yes" : "no"}, CliReferenceSender: ${this.cliReferenceSender ? "yes" : "no"}`,
        );

        if (!editor) {
          logger.warn("[sendAtMention] No active editor found");
          vscode.window.showWarningMessage(
            "No active editor. Please open a file first.",
          );
          return;
        }

        if (!this.cliReferenceSender) {
          logger.warn("[sendAtMention] CliReferenceSender not initialized");
          vscode.window.showWarningMessage(
            "Extension not fully initialized. Please wait a moment and try again.",
          );
          return;
        }

        const selection = editor.selection;
        logger.info(
          `[sendAtMention] Selection: empty=${selection.isEmpty}, start=${selection.start.line}, end=${selection.end.line}`,
        );

        const result = await this.cliReferenceSender.sendCurrentContext();
        logger.info(
          `[sendAtMention] Result: success=${result.success}, method=${result.method}, error=${result.error || "none"}`,
        );

        if (result.success) {
          vscode.window.setStatusBarMessage(
            `$(check) Sent file reference (${result.method})`,
            3000,
          );
        } else if (result.error === "No active terminal found") {
          if (this.isStartingTerminal) {
            vscode.window.setStatusBarMessage(
              "$(sync~spin) Terminal is already starting...",
              3000,
            );
            return;
          }

          this.isStartingTerminal = true;
          logger.info(
            "[sendAtMention] No terminal found, starting default tool...",
          );
          await vscode.commands.executeCommand("opencodeTui.open");
          await this.tuiProvider?.startDefaultTool();
          vscode.window.setStatusBarMessage(
            "$(sync~spin) Starting OpenCode, please try again in a moment...",
            5000,
          );

          setTimeout(() => {
            this.isStartingTerminal = false;
          }, 10000);
        } else {
          vscode.window.showWarningMessage(
            `Failed to send file reference: ${result.error || "Unknown error"}`,
          );
        }
      },
    );

    const sendAllOpenFilesCommand = vscode.commands.registerCommand(
      "opencodeTui.sendAllOpenFiles",
      async () => {
        const logger = OutputChannelService.getInstance();

        if (!this.cliReferenceSender) {
          vscode.window.showWarningMessage(
            "CLI reference sender not initialized",
          );
          return;
        }

        const result = await this.cliReferenceSender.sendAllOpenFiles();

        if (result.success) {
          vscode.window.setStatusBarMessage(
            `$(check) Sent all open files (${result.method})`,
            3000,
          );
        } else if (result.error === "No active terminal found") {
          logger.info(
            "[sendAllOpenFiles] No terminal found, starting default tool...",
          );
          await vscode.commands.executeCommand("opencodeTui.open");
          await this.tuiProvider?.startDefaultTool();
          vscode.window.setStatusBarMessage(
            "$(sync~spin) Starting OpenCode, please try again in a moment...",
            5000,
          );
        } else {
          vscode.window.showWarningMessage(
            `Failed to send open files: ${result.error || "Unknown error"}`,
          );
        }
      },
    );

    const sendFileToTerminalCommand = vscode.commands.registerCommand(
      "opencodeTui.sendFileToTerminal",
      async (...args: unknown[]) => {
        if (!this.contextSharingService || !this.cliReferenceSender) {
          vscode.window.showWarningMessage("Extension not initialized");
          return;
        }

        let uris: vscode.Uri[];
        if (args.length > 0 && Array.isArray(args[args.length - 1])) {
          uris = args[args.length - 1] as vscode.Uri[];
        } else if (args.length > 0 && args[0] instanceof vscode.Uri) {
          uris = [args[0]];
        } else {
          return;
        }

        const fileRefs = uris.map((u) =>
          this.contextSharingService!.formatFileRef(u),
        );
        const allRefs = fileRefs.join(" ");

        const outputLogger = OutputChannelService.getInstance();
        outputLogger.info(`[sendFileToTerminal] Sending: ${allRefs}`);

        const result = await this.cliReferenceSender.sendFileReference(
          allRefs,
          {
            autoFocus: true,
          },
        );

        if (result.success) {
          const message =
            fileRefs.length > 1
              ? `Sent ${fileRefs.length} files`
              : `Sent ${fileRefs[0]}`;
          vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
        } else if (result.error === "No active terminal found") {
          outputLogger.info(
            "[sendFileToTerminal] No terminal, starting default tool...",
          );
          await vscode.commands.executeCommand("opencodeTui.open");
          await this.tuiProvider?.startDefaultTool();
          vscode.window.setStatusBarMessage(
            "$(sync~spin) Starting OpenCode, please try again...",
            5000,
          );
        } else {
          vscode.window.showWarningMessage(
            `Failed to send: ${result.error || "Unknown error"}`,
          );
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

    const tmuxAttachCommand = vscode.commands.registerCommand(
      "opencodeTui.tmux.attach",
      async () => {
        await this.tuiProvider?.tmuxAttach();
      },
    );

    const tmuxCreateCommand = vscode.commands.registerCommand(
      "opencodeTui.tmux.create",
      async () => {
        await this.tuiProvider?.tmuxCreate();
      },
    );

    const tmuxDetachCommand = vscode.commands.registerCommand(
      "opencodeTui.tmux.detach",
      async () => {
        await this.tuiProvider?.tmuxDetach();
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

          // Actually open the workspace in a new VS Code window
          if (newRecord.config.workspaceUri) {
            vscode.commands.executeCommand(
              "vscode.openFolder",
              vscode.Uri.parse(newRecord.config.workspaceUri),
              true,
            );
          }
          vscode.window.showInformationMessage(
            `Opened in new window: ${newRecord.config.label}`,
          );
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
          const workspaceUri =
            uri?.toString() ||
            vscode.workspace.workspaceFolders?.[0]?.uri.toString();
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

          // Actually spawn the OpenCode process for this instance
          await this.instanceController?.spawn(newId);
          vscode.window.showInformationMessage(
            `Spawned OpenCode for workspace: ${newRecord.config.label}`,
          );
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

    const selectInstanceCommand = vscode.commands.registerCommand(
      "opencodeTui.selectInstance",
      () => {
        this.instanceQuickPick?.show();
      },
    );

    const createTabCommand = vscode.commands.registerCommand(
      "opencodeTui.createTab",
      async () => {
        const tools: { label: string; id: CliToolType }[] = [
          { label: "OpenCode", id: "opencode" },
          { label: "Claude", id: "claude" },
          { label: "Codex", id: "codex" },
          { label: "Kimi", id: "kimi" },
        ];

        const selected = await vscode.window.showQuickPick(tools, {
          placeHolder: "Select a tool to create a new tab",
        });

        if (selected) {
          await this.tuiProvider?.createTab(selected.id);
        }
      },
    );

    const createOpencodeTabCommand = vscode.commands.registerCommand(
      "opencodeTui.createTab.opencode",
      () => this.tuiProvider?.createTab("opencode"),
    );
    const createClaudeTabCommand = vscode.commands.registerCommand(
      "opencodeTui.createTab.claude",
      () => this.tuiProvider?.createTab("claude"),
    );
    const createCodexTabCommand = vscode.commands.registerCommand(
      "opencodeTui.createTab.codex",
      () => this.tuiProvider?.createTab("codex"),
    );
    const createKimiTabCommand = vscode.commands.registerCommand(
      "opencodeTui.createTab.kimi",
      () => this.tuiProvider?.createTab("kimi"),
    );

    const closeTabCommand = vscode.commands.registerCommand(
      "opencodeTui.closeTab",
      () => {
        const activeTab = this.tuiProvider?.getActiveTab();
        if (activeTab) {
          this.tuiProvider?.closeTab(activeTab.id);
        }
      },
    );

    const nextTabCommand = vscode.commands.registerCommand(
      "opencodeTui.nextTab",
      () => this.tuiProvider?.nextTab(),
    );

    const previousTabCommand = vscode.commands.registerCommand(
      "opencodeTui.previousTab",
      () => this.tuiProvider?.previousTab(),
    );

    context.subscriptions.push(
      openCommand,
      focusCommand,
      startCommand,
      sendToTerminalCommand,
      sendAtMentionCommand,
      sendAllOpenFilesCommand,
      sendFileToTerminalCommand,
      restartCommand,
      tmuxAttachCommand,
      tmuxCreateCommand,
      tmuxDetachCommand,
      pasteCommand,
      openInNewWindowCommand,
      spawnForWorkspaceCommand,
      selectInstanceCommand,
      createTabCommand,
      createOpencodeTabCommand,
      createClaudeTabCommand,
      createCodexTabCommand,
      createKimiTabCommand,
      closeTabCommand,
      nextTabCommand,
      previousTabCommand,
    );
  }

  private async sendPromptToOpenCode(prompt: string): Promise<void> {
    if (!this.tuiProvider || !this.terminalManager) {
      throw new Error("OpenCode provider is not initialized");
    }

    if (!this.terminalManager.getTerminal(this.getActiveTerminalId())) {
      const sentByDiscovery =
        await this.trySendPromptViaDiscoveredInstance(prompt);
      if (sentByDiscovery) {
        return;
      }

      await this.tuiProvider.startDefaultTool();
    }

    const apiClient = this.tuiProvider.getApiClient();
    if (apiClient && this.tuiProvider.isHttpAvailable()) {
      try {
        await Promise.race([
          apiClient.appendPrompt(prompt),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("API timeout")), 2000),
          ),
        ]);
      } catch (error) {
        this.outputChannelService?.warn(
          `Failed to send prompt via HTTP API, falling back to terminal input: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.terminalManager.writeToTerminal(
          this.getActiveTerminalId(),
          `${prompt}\n`,
        );
      }
    } else {
      this.terminalManager.writeToTerminal(
        this.getActiveTerminalId(),
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
      this.getActiveTerminalId(),
      reference + " ",
    );

    const config = vscode.workspace.getConfiguration("opencodeTui");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("opencodeTui.focus");
      setTimeout(() => {
        this.tuiProvider?.focus();
      }, 100);
    }

    vscode.window.setStatusBarMessage(`$(check) Sent ${reference}`, 3000);
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
