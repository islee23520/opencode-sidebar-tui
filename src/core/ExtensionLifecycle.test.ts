import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionLifecycle } from "./ExtensionLifecycle";
import { OutputChannelService } from "../services/OutputChannelService";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("ExtensionLifecycle", () => {
  let lifecycle: ExtensionLifecycle;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    lifecycle = new ExtensionLifecycle();
    mockContext = new vscode.ExtensionContext();
  });

  describe("activate", () => {
    it("should initialize terminal manager", async () => {
      await lifecycle.activate(mockContext);

      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });

    it("should register webview provider", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        "opencodeTui",
        expect.any(Object),
        expect.objectContaining({
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );
    });

    it("should register commands", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        "opencodeTui.start",
        expect.any(Function),
      );
    });

    it("should initialize wave services in order and show status bar", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        "OpenCode Sidebar TUI",
        { log: true },
      );
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);

      const outputChannelCall = vi.mocked(vscode.window.createOutputChannel)
        .mock.invocationCallOrder[0];
      const statusBarCall = vi.mocked(vscode.window.createStatusBarItem).mock
        .invocationCallOrder[0];

      expect(outputChannelCall).toBeLessThan(statusBarCall);

      const statusBar = vi.mocked(vscode.window.createStatusBarItem).mock
        .results[0].value;
      expect(statusBar.show).toHaveBeenCalledTimes(1);
    });

    it("should initialize ContextManager with OutputChannelService", async () => {
      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.info).toHaveBeenCalledWith(
        expect.stringContaining("ContextManager initialized"),
      );
    });

    it("should register code actions provider for all languages", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.languages.registerCodeActionsProvider).toHaveBeenCalledWith(
        "*",
        expect.any(Object),
        expect.objectContaining({
          providedCodeActionKinds: expect.any(Array),
        }),
      );
    });

    it("should handle activation errors", async () => {
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(
        () => {
          throw new Error("Registration failed");
        },
      );

      await lifecycle.activate(mockContext);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to activate"),
      );
    });
  });

  describe("deactivate", () => {
    it("should dispose providers", async () => {
      await lifecycle.activate(mockContext);
      await lifecycle.deactivate();

      expect(mockContext.subscriptions).toBeDefined();
    });

    it("should dispose wave services", async () => {
      await lifecycle.activate(mockContext);
      await lifecycle.deactivate();

      const statusBar = vi.mocked(vscode.window.createStatusBarItem).mock
        .results[0].value;
      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;

      expect(statusBar.dispose).toHaveBeenCalled();
      expect(outputChannel.dispose).toHaveBeenCalled();
    });
  });

  describe("commands", () => {
    beforeEach(async () => {
      await lifecycle.activate(mockContext);
    });

    it("should register start command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const startCall = calls.find((call) => call[0] === "opencodeTui.start");

      expect(startCall).toBeDefined();
    });

    it("should register sendToTerminal command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const sendCall = calls.find(
        (call) => call[0] === "opencodeTui.sendToTerminal",
      );

      expect(sendCall).toBeDefined();
    });

    it("should register sendAtMention command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const mentionCall = calls.find(
        (call) => call[0] === "opencodeTui.sendAtMention",
      );

      expect(mentionCall).toBeDefined();
    });

    it("should register sendAllOpenFiles command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const allFilesCall = calls.find(
        (call) => call[0] === "opencodeTui.sendAllOpenFiles",
      );

      expect(allFilesCall).toBeDefined();
    });

    it("should register sendFileToTerminal command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const fileCall = calls.find(
        (call) => call[0] === "opencodeTui.sendFileToTerminal",
      );

      expect(fileCall).toBeDefined();
    });
  });
});
