export type WebviewMessage =
  | { type: "terminalInput"; data: string }
  | { type: "terminalResize"; cols: number; rows: number }
  | {
      type: "openFile";
      path: string;
      line?: number;
      endLine?: number;
      column?: number;
    }
  | { type: "openUrl"; url: string }
  | { type: "ready"; cols: number; rows: number }
  | { type: "filesDropped"; files: string[]; shiftKey: boolean }
  | { type: "getClipboard" }
  | { type: "setClipboard"; text: string }
  | { type: "triggerPaste" };

export type HostMessage =
  | { type: "clipboardContent"; text: string }
  | { type: "terminalOutput"; data: string }
  | { type: "terminalExited" }
  | { type: "clearTerminal" }
  | { type: "focusTerminal" }
  | { type: "webviewVisible" }
  | { type: "platformInfo"; platform: string };

export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface ExtensionConfig {
  autoStart: boolean;
  command: string;
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  autoFocusOnSend: boolean;
  autoStartOnOpen: boolean;
  shellPath: string;
  shellArgs: string[];
  autoShareContext: boolean;
  httpTimeout: number;
  enableHttpApi: boolean;
  logLevel: LogLevel;
  showStatusBar: boolean;
  contextDebounceMs: number;
  maxDiagnosticLength: number;
  enableAutoSpawn: boolean;
  codeActionSeverities: DiagnosticSeverity[];
}
