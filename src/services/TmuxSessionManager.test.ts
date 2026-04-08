import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { TmuxSessionManager, TmuxUnavailableError } from "./TmuxSessionManager";
import { DEFAULT_AI_TOOLS } from "../types";
import type { ILogger } from "./ILogger";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

type MockExecStep = {
  stdout?: string;
  stderr?: string;
  error?: (Error & { code?: number | string }) | null;
};

describe("TmuxSessionManager", () => {
  let manager: TmuxSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TmuxSessionManager();
  });

  function mockExecSequence(steps: MockExecStep[]): void {
    let callIndex = 0;

    vi.mocked(execFile).mockImplementation(((...args: any[]) => {
      const callback = args[args.length - 1] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const step = steps[callIndex++] ?? { stdout: "", stderr: "" };

      callback(step.error ?? null, step.stdout ?? "", step.stderr ?? "");
      return {} as any;
    }) as any);
  }

  function createLogger(): ILogger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it("parses discovered tmux sessions into sidebar entries", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t1\t/workspaces/repo-a",
          "repo-b\t0\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    const sessions = await manager.discoverSessions();

    expect(sessions).toEqual([
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
    ]);
  });

  it("reports available when tmux version command succeeds", async () => {
    mockExecSequence([
      {
        stdout: "tmux 3.4",
      },
    ]);

    await expect(manager.isAvailable()).resolves.toBe(true);
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(["-V"]);
  });

  it("reports unavailable when tmux binary is missing", async () => {
    const missingTmuxError = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    await expect(manager.isAvailable()).resolves.toBe(false);
  });

  it("executes supported raw tmux commands with the expected target args", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await expect(
      manager.executeRawCommand("workspace-a", "rename-session", ["repo-next"]),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "select-layout", ["tiled"]),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "respawn-pane"),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "move-pane", ["-s", "%1"]),
    ).resolves.toBe("");

    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "rename-session",
      "-t",
      "workspace-a",
      "repo-next",
    ]);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "select-layout",
      "-t",
      "workspace-a",
      "tiled",
    ]);
    expect(vi.mocked(execFile).mock.calls[2]?.[1]).toEqual([
      "respawn-pane",
      "-t",
      "workspace-a",
      "-k",
    ]);
    expect(vi.mocked(execFile).mock.calls[3]?.[1]).toEqual([
      "move-pane",
      "-t",
      "workspace-a",
      "-s",
      "%1",
    ]);
  });

  it("rejects unsupported raw tmux commands", async () => {
    await expect(
      manager.executeRawCommand("workspace-a", "kill-server"),
    ).rejects.toThrow("Unsupported tmux subcommand: kill-server");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("requires prompt-backed args for rename and layout raw tmux commands", async () => {
    await expect(
      manager.executeRawCommand("workspace-a", "rename-window"),
    ).rejects.toThrow("rename-window requires an argument");
    await expect(
      manager.executeRawCommand("workspace-a", "select-layout", [""]),
    ).rejects.toThrow("select-layout requires an argument");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reuses an existing tmux session without non-interactive attach", async () => {
    mockExecSequence([
      {
        stdout: "repo-a\t0\t/workspaces/repo-a",
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers exact workspace path match over creating a new session", async () => {
    mockExecSequence([
      {
        stdout: ["legacy-repo-a\t0\t/workspaces/repo-a"].join("\n"),
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "legacy-repo-a",
        name: "legacy-repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers the active session when multiple tmux sessions share a workspace", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a-2\t0\t/workspaces/repo-a",
          "repo-a-dev\t1\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    const session = await manager.findSessionForWorkspace("/workspaces/repo-a");

    expect(session).toEqual({
      id: "repo-a-dev",
      name: "repo-a-dev",
      workspace: "repo-a",
      isActive: true,
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers the requested session name when multiple sessions share a workspace", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a-main\t1\t/workspaces/repo-a",
          "repo-a-debug\t0\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    await expect(
      manager.findSessionForWorkspace("/workspaces/repo-a", "repo-a-debug"),
    ).resolves.toEqual({
      id: "repo-a-debug",
      name: "repo-a-debug",
      workspace: "repo-a",
      isActive: false,
    });
  });

  it("keeps workspace matching case-sensitive on linux platforms", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    try {
      mockExecSequence([
        {
          stdout: "Repo-A\t0\t/Workspaces/Repo-A",
        },
      ]);

      await expect(
        manager.findSessionForWorkspace("/workspaces/repo-a", "Repo-A"),
      ).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("avoids wrong-session attachment on name collision by preferring workspace path", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t0\t/workspaces/repo-a-archive",
          "repo-a-current\t0\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "repo-a-current",
        name: "repo-a-current",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("creates a collision-safe session when stale metadata prevents workspace match", async () => {
    mockExecSequence([
      {
        stdout: ["repo-a\t0\t", "repo-a-2\t0\t/workspaces/old"].join("\n"),
      },
      {
        stdout: "",
      },
      {
        stdout: "",
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "created",
      session: {
        id: "repo-a-3",
        name: "repo-a-3",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-a-3",
      "-c",
      "/workspaces/repo-a",
    ]);
  });

  it("creates a detached session when no tmux sessions are available", async () => {
    const noServerError = Object.assign(new Error("no server running"), {
      code: 1,
    });

    mockExecSequence([
      {
        error: noServerError,
        stderr: "no server running on /tmp/tmux-1000/default",
      },
      {
        stdout: "",
      },
      {
        stdout: "",
      },
    ]);

    const result = await manager.ensureSession("repo-c", "/workspaces/repo-c");

    expect(result).toEqual({
      action: "created",
      session: {
        id: "repo-c",
        name: "repo-c",
        workspace: "repo-c",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-c",
      "-c",
      "/workspaces/repo-c",
    ]);
  });

  it("kills an existing tmux session", async () => {
    mockExecSequence([
      {
        stdout: "",
      },
    ]);

    await expect(manager.killSession("repo-k")).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "kill-session",
      "-t",
      "repo-k",
    ]);
  });

  it("notifies external pane change listeners and dispose stops future notifications", () => {
    const listener = vi.fn();
    manager.onExternalPaneChange(listener);

    manager.notifyExternalChange("repo-a");
    manager.dispose();
    manager.notifyExternalChange("repo-b");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("repo-a");
  });

  it("attaches to an existing tmux session", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.attachSession("repo-a")).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "attach-session",
      "-t",
      "repo-a",
    ]);
  });

  it("throws TmuxUnavailableError for attachSession when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(manager.attachSession("repo-a")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("creates a tmux session and enables mouse support", async () => {
    mockExecSequence([{ stdout: "" }, { stdout: "" }]);

    await expect(
      manager.createSession("repo-a", "/workspaces/repo-a"),
    ).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-a",
      "-c",
      "/workspaces/repo-a",
    ]);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "set-option",
      "-t",
      "repo-a",
      "mouse",
      "on",
    ]);
  });

  it("throws TmuxUnavailableError for createSession when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(
      manager.createSession("repo-a", "/workspaces/repo-a"),
    ).rejects.toBeInstanceOf(TmuxUnavailableError);
  });

  it("returns tmux buffer contents and falls back to empty string on failure", async () => {
    mockExecSequence([{ stdout: "copied text" }, { error: new Error("boom") }]);

    await expect(manager.showBuffer()).resolves.toBe("copied text");
    await expect(manager.showBuffer()).resolves.toBe("");
  });

  it("sets mouse mode for a session", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.setMouseOn("repo-a")).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "set-option",
      "-t",
      "repo-a",
      "mouse",
      "on",
    ]);
  });

  it("throws TmuxUnavailableError for setMouseOn when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(manager.setMouseOn("repo-a")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("warns when registering session hooks fails", async () => {
    const logger = createLogger();
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: new Error("hook failure") }]);

    await expect(
      manager.registerSessionHooks("repo-a", 42),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to register session hooks for "repo-a": hook failure',
      ),
    );
  });

  it("warns when unregistering session hooks fails", async () => {
    const logger = createLogger();
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: new Error("hook cleanup failure") }]);

    await expect(
      manager.unregisterSessionHooks("repo-a"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to unregister session hooks for "repo-a": hook cleanup failure',
      ),
    );
  });

  it("warns when registering session hooks fails because tmux is unavailable", async () => {
    const logger = createLogger();
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: err }]);

    await expect(
      manager.registerSessionHooks("repo-a", 42),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to register session hooks for "repo-a": tmux is not installed',
      ),
    );
  });

  it("registers and unregisters all session hooks when commands succeed", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await manager.registerSessionHooks("repo-a", 99);
    await manager.unregisterSessionHooks("repo-a");

    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "set-hook",
      "-g",
      "-t",
      "repo-a",
      "after-split-window",
      'run-shell "kill -USR2 99 2>/dev/null || true"',
    ]);
    expect(vi.mocked(execFile).mock.calls[5]?.[1]).toEqual([
      "set-hook",
      "-u",
      "-g",
      "-t",
      "repo-a",
      "after-select-window",
    ]);
  });

  describe("pane management", () => {
    it("splits pane horizontally and returns new pane ID", async () => {
      mockExecSequence([{ stdout: "%5" }]);
      const result = await manager.splitPane("%0", "h");
      expect(result).toBe("%5");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-h",
        "-P",
        "-F",
        "#{pane_id}",
      ]);
    });

    it("splits pane vertically with command", async () => {
      mockExecSequence([{ stdout: "%6" }]);
      const result = await manager.splitPane("%0", "v", { command: "htop" });
      expect(result).toBe("%6");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-v",
        "-P",
        "-F",
        "#{pane_id}",
        "htop",
      ]);
    });

    it("splits pane with working directory", async () => {
      mockExecSequence([{ stdout: "%7" }]);
      const result = await manager.splitPane("%0", "h", {
        workingDirectory: "/some/path",
      });
      expect(result).toBe("%7");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-h",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        "/some/path",
      ]);
    });

    it("kills a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.killPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "kill-pane",
        "-t",
        "%0",
      ]);
    });

    it("selects a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.selectPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "select-pane",
        "-t",
        "%0",
      ]);
    });

    it("selects the target window before selecting a pane in another window", async () => {
      mockExecSequence([{ stdout: "" }, { stdout: "" }]);
      await manager.selectPane("%3", "@2");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "select-window",
        "-t",
        "@2",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "select-pane",
        "-t",
        "%3",
      ]);
    });

    it("resizes a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.resizePane("%0", "L", 5);
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "resize-pane",
        "-t",
        "%0",
        "-L",
        "5",
      ]);
    });

    it("zooms a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.zoomPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "resize-pane",
        "-Z",
        "-t",
        "%0",
      ]);
    });

    it("swaps two panes", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.swapPanes("%0", "%1");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "swap-pane",
        "-s",
        "%0",
        "-t",
        "%1",
      ]);
    });

    it("creates a new window in a session", async () => {
      mockExecSequence([{ stdout: "@1:%3" }]);
      await expect(manager.createWindow("test-session")).resolves.toEqual({
        windowId: "@1",
        paneId: "%3",
      });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "new-window",
        "-t",
        "test-session",
        "-P",
        "-F",
        "#{window_id}:#{pane_id}",
      ]);
    });

    it("creates a new window with a working directory", async () => {
      mockExecSequence([{ stdout: "@2:%9" }]);

      await expect(
        manager.createWindow("test-session", "/workspaces/repo-a"),
      ).resolves.toEqual({ windowId: "@2", paneId: "%9" });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "new-window",
        "-t",
        "test-session",
        "-P",
        "-F",
        "#{window_id}:#{pane_id}",
        "-c",
        "/workspaces/repo-a",
      ]);
    });

    it("throws when createWindow output does not include both IDs", async () => {
      mockExecSequence([{ stdout: "@1" }]);

      await expect(manager.createWindow("test-session")).rejects.toThrow(
        "Failed to get window/pane ID from new-window output",
      );
    });

    it("throws TmuxUnavailableError for createWindow when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.createWindow("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("kills a window", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.killWindow("@0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "kill-window",
        "-t",
        "@0",
      ]);
    });

    it("rethrows non-tmux killWindow failures", async () => {
      mockExecSequence([{ error: new Error("permission denied") }]);

      await expect(manager.killWindow("@0")).rejects.toThrow(
        "permission denied",
      );
    });

    it("moves between windows and selects a specific window", async () => {
      mockExecSequence([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

      await manager.nextWindow("test-session");
      await manager.prevWindow("test-session");
      await manager.selectWindow("@4");

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "next-window",
        "-t",
        "test-session",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "previous-window",
        "-t",
        "test-session",
      ]);
      expect(vi.mocked(execFile).mock.calls[2]?.[1]).toEqual([
        "select-window",
        "-t",
        "@4",
      ]);
    });

    it("throws TmuxUnavailableError for killWindow when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.killWindow("@0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for splitPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.splitPane("%0", "h")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for killPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.killPane("%0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for selectPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.selectPane("%0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for resizePane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.resizePane("%0", "L", 5)).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for swapPanes when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.swapPanes("%0", "%1")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists panes for a session", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tbash\t1\tbash\t48210\t@0\t/workspaces/repo-a\n%1\t1\tvim\t0\tvim\t48211\t@0\t/workspaces/repo-a/packages/app",
        },
      ]);
      const panes = await manager.listPanes("test-session");
      expect(panes).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "bash",
          isActive: true,
          currentCommand: "bash",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
        },
        {
          paneId: "%1",
          index: 1,
          title: "vim",
          isActive: false,
          currentCommand: "vim",
          windowId: "@0",
          currentPath: "/workspaces/repo-a/packages/app",
        },
      ]);
    });

    it("omits optional pane fields when tmux output does not include them", async () => {
      mockExecSequence([
        {
          stdout: "%9\t0\tshell\t1",
        },
      ]);

      await expect(manager.listPanes("test-session")).resolves.toEqual([
        {
          paneId: "%9",
          index: 0,
          title: "shell",
          isActive: true,
        },
      ]);
    });

    it("lists panes for only the active window when requested", async () => {
      mockExecSequence([
        {
          stdout: "@1\t1\tmain\t1",
        },
        {
          stdout: "%0\t0\tbash\t1\tbash\t48210\t@1\t/workspaces/repo-a",
        },
      ]);
      await manager.listPanes("test-session", { activeWindowOnly: true });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "list-windows",
        "-t",
        "test-session",
        "-F",
        "#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session:@1",
        "-F",
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}",
      ]);
    });

    it("returns no panes when active-window filtering finds no active window", async () => {
      mockExecSequence([
        {
          stdout: ["@1\t0\tmain\t0", "@2\t1\tlogs\t0"].join("\n"),
        },
      ]);

      await expect(
        manager.listPanes("test-session", { activeWindowOnly: true }),
      ).resolves.toEqual([]);
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when session has no panes (no server error)", async () => {
      const err = Object.assign(new Error("no server running"), {
        code: 1,
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);
      const panes = await manager.listPanes("test-session");
      expect(panes).toEqual([]);
    });

    it("throws TmuxUnavailableError for listPanes when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.listPanes("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists pane DTOs for a session", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tbash\t0\tbash\t48210\t@0\t/workspaces/repo-a\n%2\t1\thtop\t1\thtop\t48212\t@0\t/workspaces/repo-a/tools",
        },
      ]);
      const dtos = await manager.listPaneDtos("test-session");
      expect(dtos).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "bash",
          isActive: false,
          currentCommand: "bash",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
        },
        {
          paneId: "%2",
          index: 1,
          title: "htop",
          isActive: true,
          currentCommand: "htop",
          windowId: "@0",
          currentPath: "/workspaces/repo-a/tools",
        },
      ]);
    });

    it("parses pane pid from window geometry responses", async () => {
      mockExecSequence([
        {
          stdout:
            "%7\t0\tshell\t1\tnode\t4242\t@3\t/workspaces/repo-a\t0\t0\t120\t30",
        },
      ]);

      const panes = await manager.listWindowPaneGeometry("test-session", "@3");

      expect(panes).toEqual([
        {
          paneId: "%7",
          index: 0,
          title: "shell",
          isActive: true,
          currentCommand: "node",
          panePid: 4242,
          windowId: "@3",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 120,
          paneHeight: 30,
        },
      ]);
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session:@3",
        "-F",
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}",
      ]);
    });

    it("omits empty optional geometry fields from pane DTOs", async () => {
      mockExecSequence([
        {
          stdout: "%8\t0\tshell\t0\t\t\t\t\t10\t20\t30\t40",
        },
        { stdout: "" },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@4"),
      ).resolves.toEqual([
        {
          paneId: "%8",
          index: 0,
          title: "shell",
          isActive: false,
          paneLeft: 10,
          paneTop: 20,
          paneWidth: 30,
          paneHeight: 40,
        },
      ]);
    });

    it("resolves node-based pane tools from descendant process commands", async () => {
      mockExecSequence([
        {
          stdout: [
            "%0\t0\tOC | ULTRAWORK MODE ENABLED!\t1\tnode\t42783\t@0\t/workspaces/repo-a\t0\t0\t100\t20",
            "%1\t1\t⠇ opencode-sidebar-tui\t0\tnode\t13140\t@0\t/workspaces/repo-a\t100\t0\t100\t20",
          ].join("\n"),
        },
        {
          stdout: [
            "42783 41338 -zsh",
            "31251 42783 node /Users/ilseoblee/.bun/bin/opencode -c",
            "13140 41338 -zsh",
            "19171 13140 node /opt/homebrew/bin/omx --madmax --high",
            '19476 19171 codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="high"',
          ].join("\n"),
        },
      ]);

      const panes = await manager.listWindowPaneGeometry(
        "test-session",
        "@0",
        DEFAULT_AI_TOOLS,
      );

      expect(panes).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "OC | ULTRAWORK MODE ENABLED!",
          isActive: true,
          currentCommand: "node",
          panePid: 42783,
          resolvedTool: "opencode",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
        {
          paneId: "%1",
          index: 1,
          title: "⠇ opencode-sidebar-tui",
          isActive: false,
          currentCommand: "node",
          panePid: 13140,
          resolvedTool: "codex",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 100,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[0]).toBe("ps");
    });

    it("keeps pane geometry results when process-tree lookup fails", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tshell\t1\tbash\t4242\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
        },
        { error: new Error("ps failed") },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0"),
      ).resolves.toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "shell",
          isActive: true,
          currentCommand: "bash",
          panePid: 4242,
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 80,
          paneHeight: 24,
        },
      ]);
    });

    it("returns empty geometry when listWindowPaneGeometry hits a no-session error", async () => {
      const err = Object.assign(new Error("no sessions"), {
        stderr: "no sessions",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0"),
      ).resolves.toEqual([]);
    });

    it("lists windows for a session", async () => {
      mockExecSequence([
        {
          stdout: "@0\t0\tmain\t1\n@1\t1\tlogs\t0",
        },
      ]);
      const windows = await manager.listWindows("test-session");
      expect(windows).toEqual([
        { windowId: "@0", index: 0, name: "main", isActive: true },
        { windowId: "@1", index: 1, name: "logs", isActive: false },
      ]);
    });

    it("returns empty array when list-windows fails with no server error", async () => {
      const err = Object.assign(new Error("no server running"), {
        code: 1,
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);
      const windows = await manager.listWindows("test-session");
      expect(windows).toEqual([]);
    });

    it("throws TmuxUnavailableError for listWindows when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.listWindows("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists visible pane geometry for a session", async () => {
      mockExecSequence([
        {
          stdout: ["%0\t0\t0\t100\t20", "%1\t100\t0\t100\t20"].join("\n"),
        },
      ]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).resolves.toEqual([
        {
          paneId: "%0",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
        {
          paneId: "%1",
          paneLeft: 100,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
      ]);
    });

    it("returns empty visible pane geometry on no-session errors", async () => {
      const err = Object.assign(new Error("failed to connect to server"), {
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).resolves.toEqual([]);
    });

    it("throws TmuxUnavailableError for listVisiblePaneGeometry when tmux is missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).rejects.toBeInstanceOf(TmuxUnavailableError);
    });

    it("sends text to a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.sendTextToPane("%0", "ls");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "send-keys",
        "-t",
        "%0",
        "ls",
        "C-m",
      ]);
    });

    it("sends literal text to a pane without submitting", async () => {
      mockExecSequence([{ stdout: "" }]);

      await manager.sendTextToPane("%3", "npm test", { submit: false });

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "send-keys",
        "-t",
        "%3",
        "-l",
        "npm test",
      ]);
    });

    it("rethrows non-tmux sendTextToPane failures", async () => {
      const logger = createLogger();
      manager = new TmuxSessionManager(logger);
      mockExecSequence([{ error: new Error("send failed") }]);

      await expect(manager.sendTextToPane("%0", "ls")).rejects.toThrow(
        "send failed",
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DIAG:sendTextToPane] FAILED paneId="%0" error=send failed',
        ),
      );
    });

    it("throws TmuxUnavailableError for sendTextToPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.sendTextToPane("%0", "ls")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("captures pane content and session preview", async () => {
      mockExecSequence([
        { stdout: "pane output" },
        { stdout: "%3\n" },
        { stdout: "preview output" },
      ]);

      await expect(manager.capturePane("%0")).resolves.toBe("pane output");
      await expect(manager.captureSessionPreview("test-session")).resolves.toBe(
        "preview output",
      );
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session",
        "-f",
        "#{pane_active}",
        "-F",
        "#{pane_id}",
      ]);
    });

    it("returns empty capture results when no active session pane is found or capture fails", async () => {
      mockExecSequence([
        { stdout: "\n" },
        { error: new Error("capture failed") },
      ]);

      await expect(manager.captureSessionPreview("test-session")).resolves.toBe(
        "",
      );
      await expect(manager.capturePane("%0")).resolves.toBe("");
    });
  });

  it("surfaces a dedicated error when tmux is missing", async () => {
    const missingTmuxError = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    await expect(manager.discoverSessions()).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("builds an empty no-sessions snapshot when tmux has no server", async () => {
    const noServerError = Object.assign(new Error("no server running"), {
      code: 1,
    });

    mockExecSequence([
      {
        error: noServerError,
        stderr: "failed to connect to server",
      },
    ]);

    const snapshot = await manager.createTreeSnapshot();

    expect(snapshot).toEqual({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-sessions",
    });
  });

  it("builds an empty no-tmux snapshot when tmux is unavailable", async () => {
    const missingTmuxError = Object.assign(new Error("tmux: not found"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    const snapshot = await manager.createTreeSnapshot();

    expect(snapshot).toEqual({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-tmux",
    });
  });

  it("uses the discovered active session when creating a populated tree snapshot", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t0\t/workspaces/repo-a",
          "repo-b\t1\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    await expect(manager.createTreeSnapshot()).resolves.toEqual({
      type: "treeSnapshot",
      sessions: [
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: true },
      ],
      activeSessionId: "repo-b",
      emptyState: undefined,
    });
  });

  it("prefers the explicit active session ID when building a tree snapshot", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t1\t/workspaces/repo-a",
          "repo-b\t0\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    await expect(manager.createTreeSnapshot("repo-b")).resolves.toEqual({
      type: "treeSnapshot",
      sessions: [
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: false },
      ],
      activeSessionId: "repo-b",
      emptyState: undefined,
    });
  });
});
