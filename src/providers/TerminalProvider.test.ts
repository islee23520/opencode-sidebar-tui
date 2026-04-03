import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "os";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { InstanceStore } from "../services/InstanceStore";
import { OutputChannelService } from "../services/OutputChannelService";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { PortManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "./TerminalProvider";
import { DEFAULT_AI_TOOLS } from "../types";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);
await vi.importActual<typeof nodePtyTypes>("../test/mocks/node-pty");

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("TerminalProvider", () => {
  let terminalManager: TerminalManager;
  let captureManager: OutputCaptureManager;
  let provider: TerminalProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    terminalManager = new TerminalManager();
    captureManager = new OutputCaptureManager();
    vscode.workspace.workspaceFolders = undefined;
  });

  afterEach(() => {
    provider?.dispose();
    terminalManager.dispose();
    OutputChannelService.resetInstance();
  });

  function mockConfiguration(options?: {
    autoStartOnOpen?: boolean;
    enableHttpApi?: boolean;
    command?: string;
    defaultAiTool?: string;
    aiTools?: readonly unknown[];
    nativeShellDefault?: string;
    tmuxSessionDefault?: string;
  }): void {
    const {
      autoStartOnOpen = false,
      enableHttpApi = false,
      command = "opencode -c",
      defaultAiTool = "opencode",
      aiTools = DEFAULT_AI_TOOLS,
      nativeShellDefault = "",
      tmuxSessionDefault = "",
    } = options ?? {};

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "autoStartOnOpen") {
          return autoStartOnOpen;
        }
        if (key === "enableHttpApi") {
          return enableHttpApi;
        }
        if (key === "command") {
          return command;
        }
        if (key === "defaultAiTool") {
          return defaultAiTool;
        }
        if (key === "aiTools") {
          return aiTools;
        }
        if (key === "httpTimeout") {
          return 5000;
        }
        if (key === "logLevel") {
          return "error";
        }
        if (key === "nativeShellDefault") {
          return nativeShellDefault;
        }
        if (key === "tmuxSessionDefault") {
          return tmuxSessionDefault;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
  }

  function createProvider(options?: {
    instanceStore?: InstanceStore;
    tmuxSessionManager?: TmuxSessionManager;
  }): TerminalProvider {
    const context = new vscode.ExtensionContext();
    const portManager = new PortManager();
    return new TerminalProvider(
      context as any,
      terminalManager,
      captureManager,
      portManager,
      options?.instanceStore,
      options?.tmuxSessionManager,
    );
  }

  function resolveProvider(target: TerminalProvider) {
    const view = vscode.WebviewView() as any;
    target.resolveWebviewView(view, {} as any, {} as any);
    const messageHandler = vi.mocked(view.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: any) => void;

    return { view, messageHandler };
  }

  async function flushAsyncStartup(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("routes switchSession messages through tmux session switching", () => {
    mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-b-instance",
        workspaceUri: "file:///workspaces/workspace-b",
      },
      runtime: { terminalKey: "workspace-b-instance", tmuxSessionId: "tmux-b" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const { messageHandler } = resolveProvider(provider);
    const switchSpy = vi
      .spyOn(provider, "switchToTmuxSession")
      .mockResolvedValue(undefined);

    messageHandler({ type: "switchSession", sessionId: "tmux-b" });

    expect(switchSpy).toHaveBeenCalledWith("tmux-b");
  });

  it("routes kill/create/native session messages to provider handlers", () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const killSpy = vi
      .spyOn(provider, "killTmuxSession")
      .mockResolvedValue(undefined);
    const createSpy = vi
      .spyOn(provider, "createTmuxSession")
      .mockResolvedValue(undefined);
    const nativeSpy = vi
      .spyOn(provider, "switchToNativeShell")
      .mockResolvedValue(undefined);

    messageHandler({ type: "killSession", sessionId: "tmux-k" });
    messageHandler({ type: "createTmuxSession" });
    messageHandler({ type: "switchNativeShell" });

    expect(killSpy).toHaveBeenCalledWith("tmux-k");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(nativeSpy).toHaveBeenCalledTimes(1);
  });

  it("routes launchAiTool messages through the provider launch path", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();

    messageHandler({
      type: "launchAiTool",
      sessionId: "tmux-a",
      tool: "codex",
      savePreference: true,
    });
    await Promise.resolve();

    expect(launchSpy).toHaveBeenCalledWith("tmux-a", "codex", true);
  });

  it("starts the default terminal path without sidebar tree interaction", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "opencode -c",
      {},
      undefined,
      120,
      40,
      "opencode-main",
      expect.any(String),
    );
  });

  it("starts codex when configured as the default AI tool", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "codex",
    });
    provider = createProvider();
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "codex",
      {},
      undefined,
      120,
      40,
      "opencode-main",
      expect.any(String),
    );
  });

  it("launches the selected tmux AI tool and stores it on the mapped instance", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-codex",
        workspaceUri: "file:///workspaces/repo-codex",
      },
      runtime: { terminalKey: "workspace-codex", tmuxSessionId: "tmux-codex" },
      state: "connected",
    });
    const listPanes = vi
      .fn()
      .mockResolvedValue([{ paneId: "%1", isActive: true }]);
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    resolveProvider(provider);

    await provider.launchAiTool("tmux-codex", "codex", true);

    expect(sendTextToPane).toHaveBeenCalledWith("%1", "codex");
    expect(instanceStore.get("workspace-codex")?.config.selectedAiTool).toBe(
      "codex",
    );
  });

  it("formats editor references through the active tool operator", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "codex",
    });
    provider = createProvider();
    resolveProvider(provider);

    const editor = {
      document: {
        uri: { fsPath: "/workspaces/repo-a/src/example.ts", path: "" },
      },
      selection: {
        isEmpty: false,
        start: { line: 4 },
        end: { line: 6 },
      },
    } as any;
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValueOnce(
      "src/example.ts",
    );

    await provider.startOpenCode();

    expect(provider.formatEditorReference(editor)).toBe(
      "@src/example.ts#L5-L7",
    );
  });

  it("ensures and reuses a matching tmux workspace session on startup", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-a",
        workspaceUri: "file:///workspaces/repo-a",
      },
      runtime: { terminalKey: "workspace-a" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-a-tmux",
        name: "repo-a-tmux",
        workspace: "repo-a",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 100, rows: 35 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledWith("repo-a", "/workspaces/repo-a");
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "workspace-a",
      "tmux attach-session -t repo-a-tmux \\; set-option -u status off",
      {},
      undefined,
      100,
      35,
      "workspace-a",
      "/workspaces/repo-a",
    );

    expect(instanceStore.get("workspace-a")?.runtime.tmuxSessionId).toBe(
      "repo-a-tmux",
    );
  });

  it("creates a workspace tmux session when none exists", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-b",
        workspaceUri: "file:///workspaces/repo-b",
      },
      runtime: { terminalKey: "workspace-b" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "created",
      session: {
        id: "repo-b-tmux",
        name: "repo-b-tmux",
        workspace: "repo-b",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(ensureSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "workspace-b",
      "tmux attach-session -t repo-b-tmux \\; set-option -u status off",
      {},
      undefined,
      120,
      40,
      "workspace-b",
      "/workspaces/repo-b",
    );
    expect(instanceStore.get("workspace-b")?.runtime.tmuxSessionId).toBe(
      "repo-b-tmux",
    );
  });

  it("re-attaches to another workspace tmux session instead of creating a native shell fallback", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      nativeShellDefault: "shell",
    });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-fallback",
        workspaceUri: "file:///workspaces/repo-fallback",
      },
      runtime: {
        terminalKey: "workspace-fallback",
        tmuxSessionId: "repo-fallback-1",
      },
      state: "connected",
    });
    const setMouseOn = vi.fn().mockResolvedValue(undefined);
    const killSession = vi.fn().mockResolvedValue(undefined);
    const findSessionForWorkspace = vi.fn().mockResolvedValue({
      id: "repo-fallback-2",
      name: "repo-fallback-2",
      workspace: "repo-fallback",
      isActive: true,
    });
    const tmuxSessionManager = {
      setMouseOn,
      killSession,
      findSessionForWorkspace,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToTmuxSession("repo-fallback-1");
    await flushAsyncStartup();
    await provider.killTmuxSession("repo-fallback-1");
    await flushAsyncStartup();

    expect(killSession).toHaveBeenCalledWith("repo-fallback-1");
    expect(findSessionForWorkspace).toHaveBeenCalledWith(
      "/workspaces/repo-fallback",
    );
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(
      "tmux attach-session -t repo-fallback-2 \\; set-option -u status off",
    );
    expect(instanceStore.get("workspace-fallback")?.runtime.tmuxSessionId).toBe(
      "repo-fallback-2",
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("does not duplicate startup orchestration on repeated ready messages", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-c",
        workspaceUri: "file:///workspaces/repo-c",
      },
      runtime: { terminalKey: "workspace-c" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-c",
        name: "repo-c",
        workspace: "repo-c",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 110, rows: 34 });
    await flushAsyncStartup();
    messageHandler({ type: "ready", cols: 110, rows: 34 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(createTerminalSpy).toHaveBeenCalledTimes(1);
  });

  it("attaches to existing tmux session when no workspace is open", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "home",
        name: "home",
        workspace: "home",
        isActive: true,
      },
    });
    const discoverSessions = vi.fn().mockResolvedValue([
      {
        id: "shared-session",
        name: "shared-session",
        workspace: "shared",
        isActive: true,
      },
    ]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 96, rows: 28 });
    await flushAsyncStartup();

    expect(ensureSession).not.toHaveBeenCalled();
    expect(discoverSessions).toHaveBeenCalledTimes(1);
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "tmux attach-session -t shared-session \\; set-option -u status off",
      {},
      undefined,
      96,
      28,
      "opencode-main",
      os.homedir(),
    );
  });

  it("forces attach to the selected tmux session when switching tabs", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-z-instance",
        workspaceUri: "file:///workspaces/repo-z",
      },
      runtime: { terminalKey: "workspace-z-instance", tmuxSessionId: "old-z" },
      state: "connected",
    });

    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-z",
        name: "repo-z",
        workspace: "repo-z",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToTmuxSession("target-z");
    await flushAsyncStartup();

    expect(ensureSession).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall?.[1]).toBe(
      "tmux attach-session -t target-z \\; set-option -u status off",
    );
    expect(lastCall?.[6]).toBe("workspace-z-instance");
  });

  it("switches to native shell without showing a dialog", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn();
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it("does not re-attach to tmux when switching to native shell in a workspace", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn();
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: "/workspace/myproject" } },
    ] as any;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it("switches to native shell with default zsh (no AI tool command)", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
  });

  it("always proceeds with native shell switch regardless of any prior dialog state", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("switches to native shell without a dialog even when defaultAiTool is set", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "opencode",
    });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
  });

  it("switches to native shell without showing a QuickPick or persisting any choice", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("creates a new tmux session and attaches the terminal immediately", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
      {
        id: "repo-a-2",
        name: "repo-a-2",
        workspace: "repo-a",
        isActive: false,
      },
    ]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-a",
          toString: () => "file:///workspaces/repo-a",
        },
      },
    ] as any;

    const result = await provider.createTmuxSession();
    await flushAsyncStartup();

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(
      "repo-a-3",
      "/workspaces/repo-a",
    );
    expect(result).toBe("repo-a-3");
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("creates a new tmux session and launches opencode when user picks opencode", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const ensureSession = vi.fn().mockResolvedValue({
      action: "created",
      session: {
        id: "repo-b",
        name: "repo-b",
        workspace: "repo-b",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-b",
          toString: () => "file:///workspaces/repo-b",
        },
      },
    ] as any;

    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: "$(terminal) OpenCode",
      description: "Launch OpenCode in the terminal",
    } as any);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      undefined,
    );

    await provider.createTmuxSession();
    await flushAsyncStartup();

    expect(createSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("always creates the tmux session without showing a dialog", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-b",
          toString: () => "file:///workspaces/repo-b",
        },
      },
    ] as any;

    const result = await provider.createTmuxSession();

    expect(result).toBe("repo-b");
    expect(createSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("switches active instances without respawning when a terminal already exists", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: { id: "session-a" },
      runtime: { terminalKey: "session-a" },
      state: "connected",
    });
    instanceStore.upsert({
      config: { id: "session-b" },
      runtime: { terminalKey: "session-b" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();
    const resizeSpy = vi.spyOn(terminalManager, "resizeTerminal");
    terminalManager.createTerminal(
      "session-b",
      "opencode -c",
      {},
      undefined,
      undefined,
      undefined,
      "session-b",
    );

    const { view } = resolveProvider(provider);
    (provider as any).lastKnownCols = 90;
    (provider as any).lastKnownRows = 30;

    instanceStore.setActive("session-b");
    await Promise.resolve();

    expect((provider as any).activeInstanceId).toBe("session-b");
    expect(startSpy).not.toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clearTerminal",
    });
    expect(resizeSpy).toHaveBeenCalledWith("session-b", 90, 30);
  });

  it("switches active instances and spawns a new terminal when it does not exist", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: { id: "session-a" },
      runtime: { terminalKey: "session-a" },
      state: "connected",
    });
    instanceStore.upsert({
      config: { id: "session-c" },
      runtime: { terminalKey: "session-c" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    const { view } = resolveProvider(provider);

    instanceStore.setActive("session-c");
    await Promise.resolve();

    expect((provider as any).activeInstanceId).toBe("session-c");
    expect(startSpy).toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clearTerminal",
    });
  });
});
