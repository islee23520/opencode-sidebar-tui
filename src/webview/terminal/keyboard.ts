import type { Terminal } from "@xterm/xterm";
import * as AiSelector from "../ai-tool-selector";
import { postMessage } from "../shared/vscode-api";
import {
  copySelectionToClipboard,
  handlePasteWithImageSupport,
} from "../clipboard";
export function createKeyboardHandler(
  terminal: Terminal,
  options: {
    onCopy: (text: string) => void;
    onPaste: () => void;
    onTerminalInput: (data: string) => void;
    onToggleTmuxCommands: () => void;
  },
) {
  let justHandledCtrlC = false;
  let lastPasteTime = 0;

  const getPhysicalLetter = (code: string): string | null => {
    if (!code.startsWith("Key") || code.length !== 4) {
      return null;
    }

    return code.slice(3).toLowerCase();
  };

  const isLatinShortcutKey = (key: string): boolean => /^[a-z]$/i.test(key);

  const toControlCharacter = (letter: string): string => {
    const upperLetter = letter.toUpperCase();
    return String.fromCharCode(upperLetter.charCodeAt(0) - 64);
  };

  const handler = (event: KeyboardEvent): boolean => {
    if (AiSelector.isVisible()) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    const isMetaOrCtrl = event.metaKey || event.ctrlKey;
    const physicalLetter = getPhysicalLetter(event.code);

    if (event.isComposing) {
      return true;
    }

    if (event.altKey && isMetaOrCtrl) {
      if (physicalLetter === "m") {
        event.preventDefault();
        event.stopPropagation();
        options.onToggleTmuxCommands();
        return false;
      }
      if (physicalLetter === "t") {
        event.preventDefault();
        event.stopPropagation();
        postMessage({
          type: "executeTmuxCommand",
          commandId: "opencodeTui.browseTmuxSessions",
        });
        return false;
      }
    }

    const isCtrlC =
      event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      physicalLetter === "c";

    if (isCtrlC) {
      const selection = terminal.getSelection();
      if (selection && selection.length > 0) {
        copySelectionToClipboard(selection);
        justHandledCtrlC = true;
        setTimeout(() => {
          justHandledCtrlC = false;
        }, 100);
        event.preventDefault();
        event.stopPropagation();
        return false;
      }

      if (!isLatinShortcutKey(event.key)) {
        options.onTerminalInput(toControlCharacter("c"));
        event.preventDefault();
        event.stopPropagation();
        return false;
      }

      return true;
    }

    if (
      event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      physicalLetter === "v"
    ) {
      const now = Date.now();
      if (now - lastPasteTime < 500) {
        return false;
      }
      lastPasteTime = now;
      event.preventDefault();
      event.stopPropagation();
      handlePasteWithImageSupport();
      return false;
    }

    if (
      event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      physicalLetter &&
      !isLatinShortcutKey(event.key)
    ) {
      options.onTerminalInput(toControlCharacter(physicalLetter));
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    return true;
  };

  return {
    handler,
    get justHandledCtrlC() {
      return justHandledCtrlC;
    },
    setJustHandledCtrlC(value: boolean) {
      justHandledCtrlC = value;
    },
  };
}
