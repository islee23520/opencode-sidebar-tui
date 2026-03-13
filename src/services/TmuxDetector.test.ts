import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TmuxDetector } from "./TmuxDetector";
import { OutputChannelService } from "./OutputChannelService";

vi.mock("../OutputChannelService");
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

describe("TmuxDetector", () => {
  let detector: TmuxDetector;
  let mockExec: any;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TmuxDetector();
    mockExec = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("detectTmuxSession", () => {
    it("should return not in tmux when TMUX env var is not set", async () => {
      delete process.env.TMUX;

      const result = await detector.detectTmuxSession();

      expect(result.isInTmux).toBe(false);
      expect(result.sessionName).toBeNull();
      expect(result.panePid).toBeNull();
      expect(result.runningCli).toBeNull();
    });

    it("should detect tmux session when TMUX env var is set", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
      process.env.TMUX_PANE = "%0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "my-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.isInTmux).toBe(true);
      expect(result.sessionName).toBe("my-session");
      expect(result.panePid).toBe(12345);
    });

    it("should detect opencode CLI in tmux pane", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "opencode-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, {
              stdout: "12345 12344 opencode\n12346 12345 node\n",
            });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBe("opencode");
    });

    it("should detect claude CLI in tmux pane", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "claude-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, { stdout: "12345 12344 claude\n" });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBe("claude");
    });

    it("should detect codex CLI in tmux pane", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "codex-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, { stdout: "12345 12344 codex\n" });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBe("codex");
    });

    it("should detect kimi CLI in tmux pane", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "kimi-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, { stdout: "12345 12344 kimi\n" });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBe("kimi");
    });

    it("should return null CLI when no AI CLI is detected", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "bash-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, { stdout: "" });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBeNull();
    });

    it("should handle errors gracefully", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          callback?.(new Error("tmux command failed"), {
            stdout: "",
            stderr: "error",
          });
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.isInTmux).toBe(false);
      expect(result.sessionName).toBeNull();
    });
  });

  describe("sendKeysToTmux", () => {
    it("should send keys successfully to tmux", async () => {
      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          expect(cmd).toContain("tmux send-keys");
          callback?.(null, { stdout: "", stderr: "" });
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.sendKeysToTmux("@file.ts");

      expect(result).toBe(true);
    });

    it("should escape special characters in keys", async () => {
      const { exec } = await import("child_process");
      let receivedCmd = "";

      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          receivedCmd = cmd;
          callback?.(null, { stdout: "", stderr: "" });
          return { stdout: "", stderr: "" } as any;
        },
      );

      await detector.sendKeysToTmux("@file.ts#L10-L20");

      expect(receivedCmd).toContain("tmux send-keys");
    });

    it("should return false when tmux send-keys fails", async () => {
      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          callback?.(new Error("tmux not found"), {
            stdout: "",
            stderr: "error",
          });
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.sendKeysToTmux("test");

      expect(result).toBe(false);
    });
  });

  describe("CLI Detection Priority", () => {
    it("should prioritize opencode when multiple CLIs are detected", async () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0";

      const { exec } = await import("child_process");
      vi.mocked(exec).mockImplementation(
        (cmd: string, _opts: any, callback?: any) => {
          if (cmd.includes("session_name")) {
            callback?.(null, { stdout: "mixed-session\n" });
          } else if (cmd.includes("pane_pid")) {
            callback?.(null, { stdout: "12345\n" });
          } else if (cmd.includes("ps -eo")) {
            callback?.(null, {
              stdout:
                "12345 12344 claude\n12346 12345 opencode\n12347 12345 codex\n",
            });
          }
          return { stdout: "", stderr: "" } as any;
        },
      );

      const result = await detector.detectTmuxSession();

      expect(result.runningCli).toBe("opencode");
    });
  });
});
