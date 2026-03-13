import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KimiAdapter } from "./KimiAdapter";
import { TerminalManager } from "../terminals/TerminalManager";
import type { CliConfig } from "../core/cli/types";

vi.mock("../terminals/TerminalManager");

describe("KimiAdapter", () => {
  let adapter: KimiAdapter;
  let mockTerminalManager: any;
  let mockTerminal: any;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcess = {
      write: vi.fn(),
      resize: vi.fn(),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      kill: vi.fn(),
    };

    mockTerminal = {
      id: "test-instance",
      process: mockProcess,
      onData: {
        event: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      onExit: {
        dispose: vi.fn(),
      },
    };

    mockTerminalManager = {
      createTerminal: vi.fn().mockReturnValue(mockTerminal),
      getByInstance: vi.fn().mockReturnValue(mockTerminal),
      killByInstance: vi.fn(),
    };

    adapter = new KimiAdapter(mockTerminalManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("start", () => {
    const baseConfig: CliConfig = {
      instanceId: "test-kimi",
      toolId: "kimi",
      command: "kimi",
      workingDir: "/workspace",
    };

    it("should start kimi with default command", async () => {
      const onReadySpy = vi.fn();
      adapter.onReady = onReadySpy;

      const instance = await adapter.start(baseConfig);

      expect(instance.id).toBe("test-kimi");
      expect(instance.toolId).toBe("kimi");
      expect(instance.state).toBe("running");
      expect(instance.port).toBeUndefined();
      expect(onReadySpy).toHaveBeenCalledWith("test-kimi");
    });

    it("should start kimi with custom command", async () => {
      const config: CliConfig = {
        ...baseConfig,
        command: "/usr/local/bin/kimi --verbose",
      };

      await adapter.start(config);

      expect(mockTerminalManager.createTerminal).toHaveBeenCalled();
      const callArgs = mockTerminalManager.createTerminal.mock.calls[0];
      expect(callArgs[1]).toContain("kimi");
    });

    it("should start kimi with arguments", async () => {
      const config: CliConfig = {
        ...baseConfig,
        args: ["--model", "kimi-latest"],
      };

      await adapter.start(config);

      const callArgs = mockTerminalManager.createTerminal.mock.calls[0];
      expect(callArgs[1]).toContain("--model");
      expect(callArgs[1]).toContain("kimi-latest");
    });

    it("should kill existing instance before starting new one", async () => {
      await adapter.start(baseConfig);
      const killSpy = vi.spyOn(adapter, "stop").mockResolvedValue(undefined);

      await adapter.start(baseConfig);

      expect(killSpy).toHaveBeenCalledWith("test-kimi");
    });

    it("should emit onData events", async () => {
      const onDataSpy = vi.fn();
      adapter.onData = onDataSpy;

      await adapter.start(baseConfig);

      const dataCallback = mockTerminal.onData.event.mock.calls[0][0];
      dataCallback({ data: "Hello from Kimi" });

      expect(onDataSpy).toHaveBeenCalledWith("test-kimi", "Hello from Kimi");
    });

    it("should emit onExit events", async () => {
      const onExitSpy = vi.fn();
      adapter.onExit = onExitSpy;

      await adapter.start(baseConfig);

      const exitCallback = mockProcess.onExit.mock.calls[0][0];
      exitCallback({ exitCode: 0 });

      expect(onExitSpy).toHaveBeenCalledWith("test-kimi", 0);
    });

    it("should emit onError when start fails", async () => {
      const onErrorSpy = vi.fn();
      adapter.onError = onErrorSpy;

      mockTerminalManager.createTerminal.mockImplementation(() => {
        throw new Error("Failed to create terminal");
      });

      await expect(adapter.start(baseConfig)).rejects.toThrow(
        "Failed to create terminal",
      );
      expect(onErrorSpy).toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should stop running instance", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);
      await adapter.stop("test-kimi");

      expect(mockTerminalManager.killByInstance).toHaveBeenCalledWith(
        "test-kimi",
      );
    });

    it("should handle stop for non-existent instance", async () => {
      await expect(adapter.stop("non-existent")).resolves.not.toThrow();
    });
  });

  describe("writeInput", () => {
    it("should write input to terminal", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);
      adapter.writeInput("test-kimi", "Hello Kimi\n");

      expect(mockProcess.write).toHaveBeenCalledWith("Hello Kimi\n");
    });

    it("should emit error for non-existent instance", () => {
      const onErrorSpy = vi.fn();
      adapter.onError = onErrorSpy;

      adapter.writeInput("non-existent", "test");

      expect(onErrorSpy).toHaveBeenCalledWith(
        "non-existent",
        expect.objectContaining({
          message: expect.stringContaining("not found"),
        }),
      );
    });
  });

  describe("resize", () => {
    it("should resize terminal", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);
      adapter.resize("test-kimi", 120, 40);

      expect(mockProcess.resize).toHaveBeenCalledWith(120, 40);
    });

    it("should emit error for non-existent instance", () => {
      const onErrorSpy = vi.fn();
      adapter.onError = onErrorSpy;

      adapter.resize("non-existent", 120, 40);

      expect(onErrorSpy).toHaveBeenCalledWith(
        "non-existent",
        expect.objectContaining({
          message: expect.stringContaining("not found"),
        }),
      );
    });
  });

  describe("healthCheck", () => {
    it("should return true for running instance", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);
      const isHealthy = await adapter.healthCheck("test-kimi");

      expect(isHealthy).toBe(true);
    });

    it("should return false for non-existent instance", async () => {
      const isHealthy = await adapter.healthCheck("non-existent");

      expect(isHealthy).toBe(false);
    });
  });

  describe("getPort", () => {
    it("should return undefined as kimi does not use HTTP API", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);
      const port = adapter.getPort("test-kimi");

      expect(port).toBeUndefined();
    });

    it("should return undefined for non-existent instance", () => {
      const port = adapter.getPort("non-existent");

      expect(port).toBeUndefined();
    });
  });

  describe("command building", () => {
    it("should use default command when command is empty", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "",
        workingDir: "/workspace",
      };

      await adapter.start(config);

      const callArgs = mockTerminalManager.createTerminal.mock.calls[0];
      expect(callArgs[1]).toBe("kimi");
    });

    it("should extract kimi from path", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "/usr/local/bin/kimi",
        workingDir: "/workspace",
      };

      await adapter.start(config);

      const callArgs = mockTerminalManager.createTerminal.mock.calls[0];
      expect(callArgs[1]).toBe("/usr/local/bin/kimi");
    });

    it("should escape special characters in arguments", async () => {
      const config: CliConfig = {
        instanceId: "test-kimi",
        toolId: "kimi",
        command: "kimi",
        args: ["--prompt", "Hello 'World'"],
        workingDir: "/workspace",
      };

      await adapter.start(config);

      const callArgs = mockTerminalManager.createTerminal.mock.calls[0];
      expect(callArgs[1]).toContain("--prompt");
      expect(callArgs[1]).toContain("Hello");
      expect(callArgs[1]).toContain("World");
    });
  });
});
