import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { StatusBarManager } from "./StatusBarManager";

vi.mock("vscode");

describe("StatusBarManager", () => {
  let statusBarManager: StatusBarManager;
  let mockStatusBarItem: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStatusBarItem = {
      text: "",
      tooltip: "",
      command: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };

    (vscode.window.createStatusBarItem as any).mockReturnValue(
      mockStatusBarItem,
    );

    (vscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === "showStatusBar") return true;
        return defaultValue;
      }),
    });

    statusBarManager = new StatusBarManager();
  });

  it("should create a status bar item with correct properties", () => {
    expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    expect(mockStatusBarItem.text).toBe("$(terminal) OpenCode");
    expect(mockStatusBarItem.tooltip).toBe("Open OpenCode TUI");
    expect(mockStatusBarItem.command).toBe("opencodeTui.focus");
  });

  it("should show status bar item if configured to show", () => {
    statusBarManager.show();
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it("should hide status bar item when hide() is called", () => {
    statusBarManager.hide();
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
  });

  it("should respect showStatusBar configuration", () => {
    (vscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === "showStatusBar") return false;
        return true;
      }),
    });

    statusBarManager.show();
    expect(mockStatusBarItem.show).not.toHaveBeenCalled();
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
  });

  it("should dispose correctly", () => {
    statusBarManager.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });
});
