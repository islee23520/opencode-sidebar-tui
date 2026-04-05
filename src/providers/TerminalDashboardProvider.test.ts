import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "../test/mocks/vscode";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { TerminalDashboardProvider } from "./TerminalDashboardProvider";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

/**
 * Tests for the TerminalDashboardProvider class.
 */
describe("TerminalDashboardProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-a",
        },
      },
    ];
  });

  /**
   * Flushes the promise queue to ensure all async operations are completed.
   */
  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  /**
   * Creates an instance of TerminalDashboardProvider with mocked dependencies.
   */
  function createProvider(
    discoverSessions = vi.fn().mockResolvedValue([]),
    listPanes = vi.fn().mockResolvedValue([]),
    listWindows = vi.fn().mockResolvedValue([]),
  ) {
    const context = new vscode.ExtensionContext();
    const onPaneChangedEvent = new vscode.EventEmitter<void>();
    const tmuxSessionManager = {
      discoverSessions,
      listPanes,
      listWindows,
      listWindowPaneGeometry: vi.fn().mockResolvedValue([]),
      selectPane: vi.fn().mockResolvedValue(undefined),
      splitPane: vi.fn().mockResolvedValue("%8"),
      createWindow: vi.fn().mockResolvedValue({ windowId: "@1", paneId: "%8" }),
      captureSessionPreview: vi.fn().mockResolvedValue(""),
      onPaneChanged: onPaneChangedEvent.event,
    } as unknown as TmuxSessionManager;

    return {
      discoverSessions,
      tmuxSessionManager,
      provider: new TerminalDashboardProvider(
        context as never,
        tmuxSessionManager,
      ),
    };
  }

  /**
   * Resolves the webview view for the provider and returns the view and message handler.
   */
  function resolveProvider(provider: TerminalDashboardProvider) {
    const view = vscode.WebviewView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const messageHandler = vi.mocked(view.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: unknown) => Promise<void>;

    return { view, messageHandler };
  }

  function showProvider(provider: TerminalDashboardProvider) {
    provider.show();
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as ReturnType<typeof vscode.window.createWebviewPanel>;
    const messageHandler = vi.mocked(panel.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: unknown) => Promise<void>;

    return { panel, messageHandler };
  }

  /**
   * Verifies that only sessions matching the current workspace are posted to the webview.
   */
  it("posts workspace-filtered tmux sessions to the dashboard webview", async () => {
    const { provider } = createProvider(
      vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: true,
        },
        {
          id: "repo-b",
          name: "repo-b",
          workspace: "repo-b",
          isActive: false,
        },
      ]),
    );

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            isActive: true,
            paneCount: 0,
          },
        ],
        nativeShells: [],
        panes: {
          "repo-a": [],
        },
        windows: {
          "repo-a": [],
        },
      }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "opencode",
            label: "OpenCode",
            args: ["-c"],
          }),
          expect.objectContaining({
            name: "claude",
            label: "Claude Code",
          }),
          expect.objectContaining({
            name: "codex",
            label: "Codex",
          }),
        ]),
      }),
    );
  });

  /**
   * Verifies that webview actions trigger the correct VS Code commands and refresh the session list.
   */
  it("routes activate/create/native actions through commands and refreshes", async () => {
    const { provider, discoverSessions } = createProvider(
      vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: false,
        },
      ]),
    );

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "activate", sessionId: "repo-a" });
    await messageHandler({ action: "create" });
    await messageHandler({ action: "switchNativeShell" });
    await flushPromises();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.switchTmuxSession",
      "repo-a",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.createTmuxSession",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.switchNativeShell",
    );
    expect(discoverSessions).toHaveBeenCalledTimes(4);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            isActive: false,
            paneCount: 0,
          },
        ],
        nativeShells: [],
        panes: {
          "repo-a": [],
        },
        windows: {
          "repo-a": [],
        },
      }),
    );
  });

  /**
   * Verifies that the refresh action triggers a session discovery.
   */
  it("refreshes sessions when the refresh action is received", async () => {
    const { provider, discoverSessions } = createProvider();
    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "refresh" });

    expect(discoverSessions).toHaveBeenCalledTimes(2);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("passes the pane window id when switching panes from another window", async () => {
    const { provider, tmuxSessionManager } = createProvider(
      vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: true,
        },
      ]),
    );
    const selectPane = vi.mocked(tmuxSessionManager.selectPane);
    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "switchPane",
      sessionId: "repo-a",
      paneId: "%3",
      windowId: "@2",
    });

    expect(selectPane).toHaveBeenCalledWith("%3", "@2");
  });

  it("uses the active pane cwd when splitting from the dashboard", async () => {
    const discoverSessions = vi.fn().mockResolvedValue([
      {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    ]);
    const listPanes = vi.fn().mockResolvedValue([
      {
        paneId: "%7",
        index: 0,
        title: "shell",
        isActive: true,
        currentPath: "/workspaces/repo-a/packages/app",
      },
    ]);
    const listWindows = vi.fn().mockResolvedValue([]);
    const { provider, tmuxSessionManager } = createProvider(
      discoverSessions,
      listPanes,
      listWindows,
    );
    const splitPane = vi.mocked(tmuxSessionManager.splitPane);
    splitPane.mockResolvedValue("%8");
    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "splitPane",
      sessionId: "repo-a",
      direction: "h",
    });

    expect(splitPane).toHaveBeenCalledWith("%7", "h", {
      workingDirectory: "/workspaces/repo-a/packages/app",
    });
  });

  it("opens the AI tool selector only when the dashboard sends an explicit action", async () => {
    const { provider } = createProvider(
      vi.fn().mockResolvedValue([
        { id: "repo-a", name: "Repo A", workspace: "repo-a", isActive: true },
      ]),
    );
    const showSpy = vi.spyOn(provider, "showAiToolSelector");

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "showAiToolSelector",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });

    expect(showSpy).toHaveBeenCalledWith("repo-a", "Repo A", true);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "showAiToolSelector",
        sessionId: "repo-a",
      }),
    );
  });

  it("does not auto-open the AI tool selector after dashboard create, createWindow, or splitPane actions", async () => {
    const discoverSessions = vi.fn().mockResolvedValue([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
    ]);
    const listPanes = vi.fn().mockResolvedValue([
      {
        paneId: "%7",
        index: 0,
        title: "shell",
        isActive: true,
        currentPath: "/workspaces/repo-a/packages/app",
      },
    ]);
    const { provider, tmuxSessionManager } = createProvider(
      discoverSessions,
      listPanes,
      vi.fn().mockResolvedValue([]),
    );

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "create" });
    await flushPromises();
    await messageHandler({ action: "createWindow", sessionId: "repo-a" });
    await flushPromises();
    await messageHandler({ action: "splitPane", sessionId: "repo-a", direction: "h" });
    await flushPromises();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.createTmuxSession",
    );
    expect(vi.mocked(tmuxSessionManager.createWindow)).toHaveBeenCalledWith(
      "repo-a",
      "/workspaces/repo-a/packages/app",
    );
    expect(vi.mocked(tmuxSessionManager.splitPane)).toHaveBeenCalledWith("%7", "h", {
      workingDirectory: "/workspaces/repo-a/packages/app",
    });
    expect(view.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "showAiToolSelector" }),
    );
  });

  it("opens the dashboard as a webview panel and reveals existing panel", async () => {
    const { provider } = createProvider();

    provider.show();
    provider.show();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "opencodeTui.terminalDashboard",
      "Terminal Manager",
      {
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside,
      },
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );

    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as ReturnType<typeof vscode.window.createWebviewPanel>;

    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Beside, true);
  });

  it("posts workspace-filtered tmux sessions to the panel webview", async () => {
    const { provider } = createProvider(
      vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: true,
        },
        {
          id: "repo-b",
          name: "repo-b",
          workspace: "repo-b",
          isActive: false,
        },
      ]),
    );

    const { panel } = showProvider(provider);
    await flushPromises();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            isActive: true,
            paneCount: 0,
          },
        ],
      }),
    );
  });
});
