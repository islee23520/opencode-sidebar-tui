import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliReferenceSender } from "./CliReferenceSender";
import { TmuxDetector } from "./TmuxDetector";
import { TerminalManager } from "../terminals/TerminalManager";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import * as vscode from "vscode";

vi.mock("./TmuxDetector");
vi.mock("../terminals/TerminalManager");
vi.mock("./OpenCodeApiClient");
vi.mock("vscode");

describe("CliReferenceSender", () => {
  let sender: CliReferenceSender;
  let mockTerminalManager: any;
  let mockGetApiClient: any;
  let mockTmuxDetector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTerminalManager = {
      getTerminal: vi.fn(),
      writeToTerminal: vi.fn(),
    };

    mockGetApiClient = vi.fn().mockReturnValue(undefined);

    vi.mocked(TmuxDetector).mockImplementation(() => ({
      detectTmuxSession: vi.fn().mockResolvedValue({
        isInTmux: false,
        sessionName: null,
        panePid: null,
        runningCli: null,
      }),
      sendKeysToTmux: vi.fn().mockResolvedValue(true),
    }));

    mockTmuxDetector = new TmuxDetector();

    sender = new CliReferenceSender(
      mockTerminalManager as any,
      mockGetApiClient,
      () => "test-terminal-id",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendFileReference", () => {
    it("should send via terminal when not in tmux", async () => {
      const result = await sender.sendFileReference("@test.ts#L10");

      expect(result.success).toBe(true);
      expect(result.method).toBe("terminal");
      expect(mockTerminalManager.writeToTerminal).toHaveBeenCalledWith(
        "test-terminal-id",
        "@test.ts#L10 ",
      );
    });

    it("should use tmux send-keys when in tmux with opencode", async () => {
      vi.mocked(TmuxDetector).mockImplementation(() => ({
        detectTmuxSession: vi.fn().mockResolvedValue({
          isInTmux: true,
          sessionName: "opencode-session",
          panePid: 12345,
          runningCli: "opencode",
        }),
        sendKeysToTmux: vi.fn().mockResolvedValue(true),
      }));

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("tmux");
      expect(result.cliDetected).toBe("opencode");
    });

    it("should use tmux send-keys when in tmux with claude", async () => {
      vi.mocked(TmuxDetector).mockImplementation(() => ({
        detectTmuxSession: vi.fn().mockResolvedValue({
          isInTmux: true,
          sessionName: "claude-session",
          panePid: 12345,
          runningCli: "claude",
        }),
        sendKeysToTmux: vi.fn().mockResolvedValue(true),
      }));

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("tmux");
      expect(result.cliDetected).toBe("claude");
    });

    it("should use tmux send-keys when in tmux with codex", async () => {
      vi.mocked(TmuxDetector).mockImplementation(() => ({
        detectTmuxSession: vi.fn().mockResolvedValue({
          isInTmux: true,
          sessionName: "codex-session",
          panePid: 12345,
          runningCli: "codex",
        }),
        sendKeysToTmux: vi.fn().mockResolvedValue(true),
      }));

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("tmux");
      expect(result.cliDetected).toBe("codex");
    });

    it("should use tmux send-keys when in tmux with kimi", async () => {
      vi.mocked(TmuxDetector).mockImplementation(() => ({
        detectTmuxSession: vi.fn().mockResolvedValue({
          isInTmux: true,
          sessionName: "kimi-session",
          panePid: 12345,
          runningCli: "kimi",
        }),
        sendKeysToTmux: vi.fn().mockResolvedValue(true),
      }));

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("tmux");
      expect(result.cliDetected).toBe("kimi");
    });

    it("should fallback to terminal when tmux send-keys fails", async () => {
      vi.mocked(TmuxDetector).mockImplementation(() => ({
        detectTmuxSession: vi.fn().mockResolvedValue({
          isInTmux: true,
          sessionName: "opencode-session",
          panePid: 12345,
          runningCli: "opencode",
        }),
        sendKeysToTmux: vi.fn().mockResolvedValue(false),
      }));

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("terminal");
    });

    it("should use HTTP API when available for opencode", async () => {
      const mockApiClient = {
        appendPrompt: vi.fn().mockResolvedValue(undefined),
      };
      mockGetApiClient.mockReturnValue(mockApiClient);

      sender = new CliReferenceSender(
        mockTerminalManager as any,
        mockGetApiClient,
        () => "test-terminal-id",
      );

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("http");
      expect(mockApiClient.appendPrompt).toHaveBeenCalledWith("@file.ts");
    });

    it("should return error when no terminal available", async () => {
      mockTerminalManager.getTerminal.mockReturnValue(undefined);
      mockGetApiClient.mockReturnValue(undefined);

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(false);
      expect(result.method).toBe("none");
      expect(result.error).toBe("No active terminal found");
    });

    it("should include trailing space in file reference", async () => {
      await sender.sendFileReference("@file.ts#L10-L20");

      expect(mockTerminalManager.writeToTerminal).toHaveBeenCalledWith(
        "test-terminal-id",
        "@file.ts#L10-L20 ",
      );
    });
  });

  describe("autoFocus option", () => {
    it("should focus sidebar when autoFocus is true", async () => {
      const executeCommandSpy = vi.fn();
      (vscode.commands.executeCommand as any) = executeCommandSpy;

      await sender.sendFileReference("@file.ts", { autoFocus: true });

      expect(executeCommandSpy).toHaveBeenCalledWith("opencodeTui.focus");
    });

    it("should not focus sidebar when autoFocus is false", async () => {
      const executeCommandSpy = vi.fn();
      (vscode.commands.executeCommand as any) = executeCommandSpy;

      await sender.sendFileReference("@file.ts", { autoFocus: false });

      expect(executeCommandSpy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle terminal write errors", async () => {
      mockTerminalManager.writeToTerminal.mockImplementation(() => {
        throw new Error("Terminal write failed");
      });

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Terminal write failed");
    });

    it("should handle HTTP API errors with fallback", async () => {
      const mockApiClient = {
        appendPrompt: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      mockGetApiClient.mockReturnValue(mockApiClient);

      const result = await sender.sendFileReference("@file.ts");

      expect(result.success).toBe(true);
      expect(result.method).toBe("terminal");
      expect(mockTerminalManager.writeToTerminal).toHaveBeenCalled();
    });
  });
});
