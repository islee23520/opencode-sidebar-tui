// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { createKeyboardHandler } from "./keyboard";

vi.mock("../ai-tool-selector", () => ({
  isVisible: vi.fn(() => false),
}));

vi.mock("../clipboard", () => ({
  copySelectionToClipboard: vi.fn(),
  handlePasteWithImageSupport: vi.fn(),
}));

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

import {
  copySelectionToClipboard,
  handlePasteWithImageSupport,
} from "../clipboard";
import { postMessage } from "../shared/vscode-api";

describe("createKeyboardHandler", () => {
  const createTerminal = (selection = "") =>
    ({
      getSelection: vi.fn(() => selection),
    }) as unknown as Terminal;

  const createKeyboardEvent = (
    type: string,
    init: KeyboardEventInit & { code: string },
  ): KeyboardEvent => {
    const event = new KeyboardEvent(type, init);
    Object.defineProperty(event, "code", {
      value: init.code,
    });
    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies the selection for Ctrl+C even with a Korean-layout key", () => {
    const terminal = createTerminal("selected text");
    const onTerminalInput = vi.fn();
    const keyboard = createKeyboardHandler(terminal, {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onTerminalInput,
      onToggleTmuxCommands: vi.fn(),
    });
    const event = createKeyboardEvent("keydown", {
      ctrlKey: true,
      key: "ㅊ",
      code: "KeyC",
      bubbles: true,
      cancelable: true,
    });

    const allowed = keyboard.handler(event);

    expect(allowed).toBe(false);
    expect(copySelectionToClipboard).toHaveBeenCalledWith("selected text");
    expect(onTerminalInput).not.toHaveBeenCalled();
  });

  it("sends the English control character for Ctrl shortcuts typed on a Korean layout", () => {
    const terminal = createTerminal();
    const onTerminalInput = vi.fn();
    const keyboard = createKeyboardHandler(terminal, {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onTerminalInput,
      onToggleTmuxCommands: vi.fn(),
    });
    const event = createKeyboardEvent("keydown", {
      ctrlKey: true,
      key: "ㅠ",
      code: "KeyB",
      bubbles: true,
      cancelable: true,
    });

    const allowed = keyboard.handler(event);

    expect(allowed).toBe(false);
    expect(onTerminalInput).toHaveBeenCalledWith("\u0002");
  });

  it("keeps Ctrl+V paste working on a Korean layout", () => {
    const terminal = createTerminal();
    const keyboard = createKeyboardHandler(terminal, {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onTerminalInput: vi.fn(),
      onToggleTmuxCommands: vi.fn(),
    });
    const event = createKeyboardEvent("keydown", {
      ctrlKey: true,
      key: "ㅍ",
      code: "KeyV",
      bubbles: true,
      cancelable: true,
    });

    const allowed = keyboard.handler(event);

    expect(allowed).toBe(false);
    expect(handlePasteWithImageSupport).toHaveBeenCalledTimes(1);
  });

  it("passes through composing input without remapping shortcuts", () => {
    const terminal = createTerminal();
    const onTerminalInput = vi.fn();
    const keyboard = createKeyboardHandler(terminal, {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onTerminalInput,
      onToggleTmuxCommands: vi.fn(),
    });
    const event = createKeyboardEvent("keydown", {
      ctrlKey: true,
      key: "ㅠ",
      code: "KeyB",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "isComposing", {
      value: true,
    });

    const allowed = keyboard.handler(event);

    expect(allowed).toBe(true);
    expect(onTerminalInput).not.toHaveBeenCalled();
  });

  it("uses the physical key for the tmux command shortcut", () => {
    const terminal = createTerminal();
    const onToggleTmuxCommands = vi.fn();
    const keyboard = createKeyboardHandler(terminal, {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onTerminalInput: vi.fn(),
      onToggleTmuxCommands,
    });
    const event = createKeyboardEvent("keydown", {
      ctrlKey: true,
      altKey: true,
      key: "ㅡ",
      code: "KeyM",
      bubbles: true,
      cancelable: true,
    });

    const allowed = keyboard.handler(event);

    expect(allowed).toBe(false);
    expect(onToggleTmuxCommands).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
