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
  | { type: "listTerminals" }
  | {
      type: "terminalAction";
      action: "focus" | "sendCommand" | "capture";
      terminalName: string;
      command?: string;
    }
  | { type: "getClipboard" }
  | { type: "triggerPaste" };

export type HostMessage =
  | { type: "clipboardContent"; text: string }
  | { type: "terminalOutput"; data: string }
  | { type: "terminalExited" }
  | { type: "clearTerminal" }
  | { type: "focusTerminal" }
  | { type: "terminalList"; terminals: { name: string; cwd: string }[] }
  | { type: "webviewVisible" }
  | { type: "platformInfo"; platform: string };
