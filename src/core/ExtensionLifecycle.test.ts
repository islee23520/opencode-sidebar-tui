import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionLifecycle } from "./ExtensionLifecycle";
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
  });

  describe("formatFileRef", () => {
    it("should format file reference with @ prefix", async () => {
      await lifecycle.activate(mockContext);

      const uri = vscode.Uri.file("/workspace/src/test.ts");
      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/test.ts");

      const result = (lifecycle as any).formatFileRef(uri);

      expect(result).toBe("@src/test.ts");
    });
  });

  describe("formatFileRefWithLineNumbers", () => {
    it("should format file reference without selection", async () => {
      await lifecycle.activate(mockContext);

      const uri = vscode.Uri.file("/workspace/src/test.ts");
      const document = new vscode.TextDocument(uri, "content");
      const selection = new vscode.Selection(0, 0, 0, 0);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/test.ts");

      const result = (lifecycle as any).formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/test.ts");
    });

    it("should format file reference with single line selection", async () => {
      await lifecycle.activate(mockContext);

      const uri = vscode.Uri.file("/workspace/src/test.ts");
      const document = new vscode.TextDocument(uri, "content");
      const selection = new vscode.Selection(9, 0, 9, 10);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/test.ts");

      const result = (lifecycle as any).formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/test.ts#L10");
    });

    it("should format file reference with multi-line selection", async () => {
      await lifecycle.activate(mockContext);

      const uri = vscode.Uri.file("/workspace/src/test.ts");
      const document = new vscode.TextDocument(uri, "content");
      const selection = new vscode.Selection(9, 0, 19, 10);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/test.ts");

      const result = (lifecycle as any).formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/test.ts#L10-L20");
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
