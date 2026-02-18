import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextManager } from "./ContextManager";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

describe("ContextManager", () => {
  let onDidChangeActiveTextEditorListener:
    | ((editor: vscodeTypes.TextEditor | undefined) => void)
    | undefined;
  let onDidChangeTextEditorSelectionListener:
    | ((event: { textEditor: vscodeTypes.TextEditor }) => void)
    | undefined;
  let onDidChangeTextDocumentListener:
    | ((event: { document: vscodeTypes.TextDocument }) => void)
    | undefined;
  let onDidChangeDiagnosticsListener:
    | ((event: { uris: any[] }) => void)
    | undefined;

  const createOutputChannelServiceMock = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  const createEditor = (filePath: string) => {
    const uri = vscode.Uri.file(filePath);
    const document = new vscode.TextDocument(uri, "const value = 1;");
    const selection = new vscode.Selection(0, 0, 0, 0);
    return new vscode.TextEditor(document, selection);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "contextDebounceMs") {
          return 500;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    vi.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(
      (listener: any) => {
        onDidChangeActiveTextEditorListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(
      (listener: any) => {
        onDidChangeTextEditorSelectionListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockImplementation(
      (listener: any) => {
        onDidChangeTextDocumentListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.languages.onDidChangeDiagnostics).mockImplementation(
      (listener: any) => {
        onDidChangeDiagnosticsListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid context changes into a single update", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/context.ts");
    vscode.window.activeTextEditor = editor;

    onDidChangeActiveTextEditorListener?.(editor);
    onDidChangeTextEditorSelectionListener?.({ textEditor: editor });
    onDidChangeTextDocumentListener?.({ document: editor.document });

    vi.advanceTimersByTime(499);
    expect(outputChannel.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    vi.advanceTimersByTime(1);
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();
  });

  it("tracks diagnostics for affected files", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    const trackedUri = vscode.Uri.file("/workspace/src/tracked.ts");
    const untrackedUri = vscode.Uri.file("/workspace/src/untracked.ts");
    const diagnostics = [
      {
        message: "Unexpected token",
        severity: vscode.DiagnosticSeverity.Error,
      },
    ];

    vi.mocked(vscode.languages.getDiagnostics).mockImplementation(
      (uri?: any) => {
        if (uri?.path === trackedUri.path) {
          return diagnostics as any;
        }
        return [];
      },
    );

    onDidChangeDiagnosticsListener?.({ uris: [trackedUri] as any });

    expect(manager.getDiagnostics(trackedUri as any)).toEqual(diagnostics);
    expect(manager.getDiagnostics(untrackedUri as any)).toEqual([]);

    manager.dispose();
  });

  it("disposes all registered event listeners", () => {
    const disposeActiveEditor = vi.fn();
    const disposeSelection = vi.fn();
    const disposeDocument = vi.fn();
    const disposeDiagnostics = vi.fn();

    vi.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(
      (listener: any) => {
        onDidChangeActiveTextEditorListener = listener;
        return { dispose: disposeActiveEditor } as any;
      },
    );
    vi.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(
      (listener: any) => {
        onDidChangeTextEditorSelectionListener = listener;
        return { dispose: disposeSelection } as any;
      },
    );
    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockImplementation(
      (listener: any) => {
        onDidChangeTextDocumentListener = listener;
        return { dispose: disposeDocument } as any;
      },
    );
    vi.mocked(vscode.languages.onDidChangeDiagnostics).mockImplementation(
      (listener: any) => {
        onDidChangeDiagnosticsListener = listener;
        return { dispose: disposeDiagnostics } as any;
      },
    );

    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    manager.dispose();

    expect(disposeActiveEditor).toHaveBeenCalledOnce();
    expect(disposeSelection).toHaveBeenCalledOnce();
    expect(disposeDocument).toHaveBeenCalledOnce();
    expect(disposeDiagnostics).toHaveBeenCalledOnce();
  });

  it("uses configured debounce delay", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "contextDebounceMs") {
          return 1200;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/configured.ts");
    onDidChangeActiveTextEditorListener?.(editor);

    vi.advanceTimersByTime(1199);
    expect(outputChannel.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    vi.advanceTimersByTime(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();
  });

  it("logs lifecycle and update events through OutputChannelService", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    expect(outputChannel.info).toHaveBeenCalledWith(
      expect.stringContaining("ContextManager initialized"),
    );

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/logging.ts");
    onDidChangeActiveTextEditorListener?.(editor);

    vi.advanceTimersByTime(500);

    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();

    expect(outputChannel.info).toHaveBeenCalledWith(
      expect.stringContaining("ContextManager disposed"),
    );
  });
});
