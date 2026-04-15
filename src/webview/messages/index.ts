import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { HostMessage } from "../../types";
import { postMessage } from "../shared/vscode-api";
import { scheduleRefresh } from "../shared/utils";

export interface MessageHandlerCallbacks {
  onActiveSession: (
    message: Extract<HostMessage, { type: "activeSession" }>,
  ) => void;
  onShowAiToolSelector: (
    message: Extract<HostMessage, { type: "showAiToolSelector" }>,
  ) => void;
  onToggleDashboard: (
    message: Extract<HostMessage, { type: "toggleDashboard" }>,
  ) => void;
  onToggleTmuxCommandToolbar: (
    message: Extract<HostMessage, { type: "toggleTmuxCommandToolbar" }>,
  ) => void;
  onUpdateDashboard: (
    message: Extract<HostMessage, { type: "updateDashboard" }>,
  ) => void;
  onShowTmuxPrompt: (
    message: Extract<HostMessage, { type: "showTmuxPrompt" }>,
  ) => void;
  onPlatformInfo?: (
    message: Extract<HostMessage, { type: "platformInfo" }>,
  ) => void;
}

export interface MessageHandler {
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  handleEvent: (event: MessageEvent<HostMessage>) => void;
}

export function createMessageHandler(
  callbacks: MessageHandlerCallbacks,
): MessageHandler {
  const state: MessageHandler = {
    terminal: null,
    fitAddon: null,
    handleEvent(event: MessageEvent<HostMessage>) {
      const message = event.data;
      const { terminal, fitAddon } = state;

      switch (message.type) {
        case "terminalOutput":
          if (terminal) {
            terminal.write(message.data);
          }
          break;

        case "terminalExited":
          if (terminal) {
            terminal.write("\r\n\x1b[31mOpenCode exited\x1b[0m\r\n");
          }
          break;

        case "clearTerminal":
          if (terminal) {
            terminal.clear();
            terminal.reset();
            if (fitAddon) {
              fitAddon.fit();
              postMessage({
                type: "terminalResize",
                cols: terminal.cols,
                rows: terminal.rows,
              });
            }
          }
          break;

        case "focusTerminal":
          if (terminal) {
            terminal.focus();
          }
          break;

        case "webviewVisible":
          setTimeout(() => {
            if (terminal && fitAddon) {
              fitAddon.fit();
              scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
              postMessage({
                type: "terminalResize",
                cols: terminal.cols,
                rows: terminal.rows,
              });
            }
          }, 50);
          break;

        case "platformInfo":
          callbacks.onPlatformInfo?.(message);
          break;

        case "terminalConfig":
          if (terminal) {
            terminal.options.fontSize = message.fontSize;
            terminal.options.fontFamily = message.fontFamily;
            terminal.options.cursorBlink = message.cursorBlink;
            terminal.options.cursorStyle = message.cursorStyle;
            if (fitAddon) {
              fitAddon.fit();
            }
            scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
          }
          break;

        case "clipboardContent":
          if (message.text && terminal) {
            terminal.paste(message.text);
          }
          break;

        case "activeSession":
          callbacks.onActiveSession(message);
          break;

        case "showAiToolSelector":
          callbacks.onShowAiToolSelector(message);
          break;

        case "toggleDashboard":
          callbacks.onToggleDashboard(message);
          break;

        case "toggleTmuxCommandToolbar":
          callbacks.onToggleTmuxCommandToolbar(message);
          break;

        case "updateDashboard":
          callbacks.onUpdateDashboard(message);
          break;

        case "showTmuxPrompt":
          callbacks.onShowTmuxPrompt(message);
          break;
      }
    },
  };

  return state;
}
