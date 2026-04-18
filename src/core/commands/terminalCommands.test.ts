import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "../../test/mocks/vscode";
import { registerTerminalCommands } from "./terminalCommands";
import type { TerminalCommandDependencies } from "./terminalCommands";
import type { TerminalProvider } from "../../providers/TerminalProvider";
import type { OutputChannelService } from "../../services/OutputChannelService";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../../test/mocks/vscode");
  return actual;
});

type CommandCallback = (...args: unknown[]) => unknown;

type ProviderMock = Pick<
  TerminalProvider,
  | "startOpenCode"
  | "focus"
  | "formatEditorReference"
  | "formatUriReference"
  | "pasteText"
  | "openInEditorTab"
  | "toggleEditorAttachment"
>;

type OutputChannelMock = Pick<OutputChannelService, "info" | "warn" | "error">;

function createProviderMock(): ProviderMock {
  return {
    startOpenCode: vi.fn(),
    focus: vi.fn(),
    formatEditorReference: vi.fn(),
    formatUriReference: vi.fn((uri) => `@${uri.fsPath}`),
    pasteText: vi.fn(),
    openInEditorTab: vi.fn(),
    toggleEditorAttachment: vi.fn(),
  };
}

function createOutputChannelMock(): OutputChannelMock {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockAutoFocusOnSend(enabled: boolean): void {
  const configuration = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === "autoFocusOnSend") {
        return enabled;
      }
      return defaultValue;
    }),
    inspect: vi.fn(() => undefined),
    update: vi.fn(),
  };

  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration);
}

function createDependencies(
  overrides: Partial<TerminalCommandDependencies> = {},
): TerminalCommandDependencies {
  const provider = createProviderMock();
  const outputChannel = createOutputChannelMock();

  return {
    provider: provider as unknown as TerminalProvider,
    terminalManager: undefined,
    contextSharingService:
      {} as TerminalCommandDependencies["contextSharingService"],
    outputChannel: outputChannel as unknown as OutputChannelService,
    getActiveTerminalId: vi.fn(() => "terminal-1"),
    sendTerminalCwd: vi.fn(),
    sendPrompt: vi.fn(async () => undefined),
    ...overrides,
  };
}

function registerAndGetCommands(
  deps: TerminalCommandDependencies,
): Map<string, CommandCallback> {
  registerTerminalCommands(deps);

  return new Map(
    vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.map(([id, callback]) => [id, callback as CommandCallback]),
  );
}

function getCommand(
  commands: Map<string, CommandCallback>,
  id: string,
): CommandCallback {
  const command = commands.get(id);

  if (!command) {
    throw new Error(`Missing registered command: ${id}`);
  }

  return command;
}

describe("registerTerminalCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAutoFocusOnSend(true);
    vscode.window.activeTextEditor = undefined;
    vscode.window.tabGroups.all = [];
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("registers all 9 terminal commands", () => {
    const commands = registerAndGetCommands(createDependencies());

    expect(Array.from(commands.keys())).toEqual(
      expect.arrayContaining([
        "opencodeTui.start",
        "opencodeTui.sendToTerminal",
        "opencodeTui.sendAtMention",
        "opencodeTui.sendAllOpenFiles",
        "opencodeTui.sendFileToTerminal",
        "opencodeTui.paste",
        "opencodeTui.focus",
        "opencodeTui.openTerminalInEditor",
        "opencodeTui.restoreTerminalToSidebar",
      ]),
    );
    expect(commands.size).toBe(9);
  });

  it("starts OpenCode from the start command", () => {
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "opencodeTui.start")();

    expect(deps.provider?.startOpenCode).toHaveBeenCalledTimes(1);
  });

  it("sends selected editor text to the terminal and focuses when enabled", () => {
    const deps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "selected text",
    );
    const selection = new vscode.Selection(0, 0, 0, 4);
    const editor = new vscode.TextEditor(document, selection);
    vscode.window.activeTextEditor = editor;

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "opencodeTui.sendToTerminal")();

    expect(document.getText).toHaveBeenCalledWith(selection);
    expect(deps.getActiveTerminalId).toHaveBeenCalledTimes(1);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendToTerminal] terminalId="terminal-1" textLength=13',
    );
    expect(deps.sendPrompt).toHaveBeenCalledWith("selected text\n");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.focus",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("does not send selected text when there is no editor or selection", () => {
    const noEditorDeps = createDependencies();
    const noEditorCommands = registerAndGetCommands(noEditorDeps);

    getCommand(noEditorCommands, "opencodeTui.sendToTerminal")();

    expect(noEditorDeps.sendPrompt).not.toHaveBeenCalled();
    expect(noEditorDeps.outputChannel?.info).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const emptySelectionDeps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "ignored",
    );
    const emptySelection = new vscode.Selection(0, 0, 0, 0);
    vscode.window.activeTextEditor = new vscode.TextEditor(
      document,
      emptySelection,
    );

    const emptySelectionCommands = registerAndGetCommands(emptySelectionDeps);
    getCommand(emptySelectionCommands, "opencodeTui.sendToTerminal")();

    expect(emptySelectionDeps.sendPrompt).not.toHaveBeenCalled();
    expect(emptySelectionDeps.outputChannel?.info).not.toHaveBeenCalled();
  });

  it("skips focus after sending selected text when autoFocusOnSend is disabled", () => {
    mockAutoFocusOnSend(false);

    const deps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "text",
    );
    const selection = new vscode.Selection(0, 0, 0, 2);
    vscode.window.activeTextEditor = new vscode.TextEditor(document, selection);

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "opencodeTui.sendToTerminal")();

    expect(deps.sendPrompt).toHaveBeenCalledWith("text\n");
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "opencodeTui.focus",
    );

    vi.runAllTimers();

    expect(deps.provider?.focus).not.toHaveBeenCalled();
  });

  it("sends editor references and falls back to cwd when @mention cannot be created", () => {
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "content",
    );
    const selection = new vscode.Selection(0, 0, 0, 1);
    const editor = new vscode.TextEditor(document, selection);

    const successDeps = createDependencies();
    vi.mocked(successDeps.provider!.formatEditorReference).mockReturnValue(
      "@src/file.ts#L1",
    );
    vscode.window.activeTextEditor = editor;

    const successCommands = registerAndGetCommands(successDeps);
    getCommand(successCommands, "opencodeTui.sendAtMention")();

    expect(successDeps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendAtMention] terminalId="terminal-1" fileRef="@src/file.ts#L1"',
    );
    expect(successDeps.sendPrompt).toHaveBeenCalledWith("@src/file.ts#L1 ");

    vi.advanceTimersByTime(100);

    expect(successDeps.provider?.focus).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const noProviderDeps = createDependencies({ provider: undefined });
    vscode.window.activeTextEditor = editor;
    const noProviderCommands = registerAndGetCommands(noProviderDeps);

    getCommand(noProviderCommands, "opencodeTui.sendAtMention")();

    expect(noProviderDeps.outputChannel?.warn).toHaveBeenCalledWith(
      "[DIAG:sendAtMention] skipped — provider=false editor=true",
    );
    expect(noProviderDeps.sendTerminalCwd).toHaveBeenCalledTimes(1);
    expect(noProviderDeps.sendPrompt).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const noEditorDeps = createDependencies();
    vscode.window.activeTextEditor = undefined;
    const noEditorCommands = registerAndGetCommands(noEditorDeps);

    getCommand(noEditorCommands, "opencodeTui.sendAtMention")();

    expect(noEditorDeps.outputChannel?.warn).toHaveBeenCalledWith(
      "[DIAG:sendAtMention] skipped — editor=false contextSharingService=true",
    );
    expect(noEditorDeps.sendTerminalCwd).toHaveBeenCalledTimes(1);
    expect(noEditorDeps.sendPrompt).not.toHaveBeenCalled();
  });

  it("sends all open file references while filtering unsupported tabs", () => {
    const deps = createDependencies();
    const fileUri = vscode.Uri.parse("file:///workspace/a.ts");
    const untitledUri = vscode.Uri.parse("untitled:///scratch.ts");
    const secondFileUri = vscode.Uri.parse("file:///workspace/b.ts");

    vi.mocked(deps.provider!.formatUriReference)
      .mockReturnValueOnce("@workspace/a.ts")
      .mockReturnValueOnce("@workspace/b.ts");

    vscode.window.tabGroups.all = [
      {
        tabs: [
          { input: new vscode.TabInputText(fileUri) },
          { input: new vscode.TabInputText(untitledUri) },
          { input: { uri: secondFileUri } },
        ],
      },
      {
        tabs: [{ input: new vscode.TabInputText(secondFileUri) }],
      },
    ];

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "opencodeTui.sendAllOpenFiles")();

    expect(deps.provider?.formatUriReference).toHaveBeenCalledTimes(2);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendAllOpenFiles] terminalId="terminal-1" fileCount=2 refs="@workspace/a.ts @workspace/b.ts"',
    );
    expect(deps.sendPrompt).toHaveBeenCalledWith(
      "@workspace/a.ts @workspace/b.ts ",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("deduplicates queued file references and debounces prompt sending", () => {
    const deps = createDependencies();
    const firstUri = vscode.Uri.file("/workspace/a.ts");
    const duplicateUri = vscode.Uri.file("/workspace/a.ts");
    const secondUri = vscode.Uri.file("/workspace/b.ts");

    vi.mocked(deps.provider!.formatUriReference)
      .mockReturnValueOnce("@workspace/a.ts")
      .mockReturnValueOnce("@workspace/b.ts");

    const commands = registerAndGetCommands(deps);
    const sendFileToTerminal = getCommand(
      commands,
      "opencodeTui.sendFileToTerminal",
    );

    sendFileToTerminal("ignored", [firstUri]);
    sendFileToTerminal("ignored", [duplicateUri, secondUri]);

    expect(deps.sendPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(deps.provider?.formatUriReference).toHaveBeenCalledTimes(2);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendFileToTerminal] terminalId="terminal-1" fileCount=2 refs="@workspace/a.ts @workspace/b.ts"',
    );
    expect(deps.sendPrompt).toHaveBeenCalledTimes(1);
    expect(deps.sendPrompt).toHaveBeenCalledWith(
      "@workspace/a.ts @workspace/b.ts ",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("drops queued file references when provider is unavailable", () => {
    const deps = createDependencies({ provider: undefined });
    const commands = registerAndGetCommands(deps);
    const sendFileToTerminal = getCommand(
      commands,
      "opencodeTui.sendFileToTerminal",
    );

    sendFileToTerminal("ignored", [vscode.Uri.file("/workspace/a.ts")]);
    vi.advanceTimersByTime(100);

    expect(deps.sendPrompt).not.toHaveBeenCalled();

    sendFileToTerminal("ignored", [vscode.Uri.file("/workspace/b.ts")]);
    vi.advanceTimersByTime(100);

    expect(deps.sendPrompt).not.toHaveBeenCalled();
    expect(deps.outputChannel?.info).not.toHaveBeenCalled();
  });

  it("pastes clipboard text on success and reports clipboard failures", async () => {
    const successDeps = createDependencies();
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValueOnce(
      "clipboard text",
    );

    const successCommands = registerAndGetCommands(successDeps);
    await getCommand(successCommands, "opencodeTui.paste")();

    expect(successDeps.provider?.pasteText).toHaveBeenCalledWith(
      "clipboard text",
    );
    expect(successDeps.outputChannel?.error).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const errorDeps = createDependencies();
    vi.mocked(vscode.env.clipboard.readText).mockRejectedValueOnce(
      new Error("clipboard unavailable"),
    );

    const errorCommands = registerAndGetCommands(errorDeps);
    await getCommand(errorCommands, "opencodeTui.paste")();

    expect(errorDeps.outputChannel?.error).toHaveBeenCalledWith(
      "[TerminalProvider] Failed to paste: clipboard unavailable",
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to paste from clipboard",
    );
  });

  it("focuses the sidebar, opens the terminal in an editor tab, and restores it to the sidebar", () => {
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "opencodeTui.focus")();
    getCommand(commands, "opencodeTui.openTerminalInEditor")();
    getCommand(commands, "opencodeTui.restoreTerminalToSidebar")();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.view.focus",
      "opencodeTui",
    );
    expect(deps.provider?.openInEditorTab).toHaveBeenCalledTimes(1);
    expect(deps.provider?.toggleEditorAttachment).toHaveBeenCalledTimes(1);
  });
});
