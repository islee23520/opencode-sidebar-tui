import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";

describe("OutputChannelService", () => {
  let service: OutputChannelService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "info";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
    OutputChannelService.resetInstance();
    service = OutputChannelService.getInstance();
  });

  it("should be a singleton", () => {
    const instance1 = OutputChannelService.getInstance();
    const instance2 = OutputChannelService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should create an output channel with the correct name", () => {
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
      "OpenCode Sidebar TUI",
      { log: true },
    );
  });

  it("should filter debug logs when log level is info", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.debug("debug message");
    expect(mockChannel.debug).not.toHaveBeenCalled();
  });

  it("should call info on the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.info("info message");
    expect(mockChannel.info).toHaveBeenCalledWith("info message");
  });

  it("should call warn on the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.warn("warn message");
    expect(mockChannel.warn).toHaveBeenCalledWith("warn message");
  });

  it("should call error on the output channel with string", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.error("error message");
    expect(mockChannel.error).toHaveBeenCalledWith("error message");
  });

  it("should call error on the output channel with Error object", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    const error = new Error("test error");
    service.error(error);
    expect(mockChannel.error).toHaveBeenCalledWith(error);
  });

  it("should respect configuration changes for log level", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "debug";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;

    service.debug("debug enabled");
    expect(mockChannel.debug).toHaveBeenCalledWith("debug enabled");
  });

  it("should dispose the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.dispose();
    expect(mockChannel.dispose).toHaveBeenCalled();
  });
});
