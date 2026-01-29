const vscode = {
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    createWebviewPanel: jest.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    onDidChangeActiveTextEditor: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn(),
      update: jest.fn(),
    }),
    workspaceFolders: [],
    onDidOpenTextDocument: jest.fn(),
    onDidSaveTextDocument: jest.fn(),
  },
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
  },
  EventEmitter: class {
    event = jest.fn();
    fire = jest.fn();
  },
  Uri: {
    file: jest.fn((path: string) => ({ path, fsPath: path })),
    parse: jest.fn((url: string) => ({ url })),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
  },
  ExtensionContext: jest.fn(),
};

jest.mock("vscode", () => vscode, { virtual: true });
