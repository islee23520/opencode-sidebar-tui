const detectMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");

const isLetterOrDigitCode = (code: string): boolean =>
  /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);

export interface KeyboardHandlerOptions {
  /** Whether the platform is macOS (auto-detected if omitted). */
  isMac?: boolean;
  /**
   * Callback to send input data through the PTY/host path.
   * When provided, Shift+Enter sends `\r\n` (multiline newline) via this
   * callback instead of through xterm's default key processing.
   * When omitted, Shift+Enter is not intercepted.
   */
  sendInput?: (data: string) => void;
}

export function createKeyboardHandler(options: KeyboardHandlerOptions = {}) {
  const isMac = options.isMac ?? detectMacPlatform();

  const isWorkbenchPrimaryModifier = (event: KeyboardEvent): boolean =>
    isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

  const isPasteShortcut = (event: KeyboardEvent): boolean =>
    event.code === "KeyV" && !event.altKey && isWorkbenchPrimaryModifier(event);

  const isLetterOrDigitChord = (event: KeyboardEvent): boolean =>
    !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    isLetterOrDigitCode(event.code);

  /** Detect bare Shift+Enter without Ctrl/Meta/Alt modifiers. */
  const isShiftEnter = (event: KeyboardEvent): boolean =>
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey;

  const handler = (event: KeyboardEvent): boolean => {
    if (isShiftEnter(event) && event.type === "keydown" && options.sendInput) {
      event.preventDefault();
      event.stopPropagation();
      options.sendInput("\r\n");
      return false;
    }

    if (!isLetterOrDigitChord(event)) {
      return true;
    }

    if (isPasteShortcut(event)) {
      return true;
    }

    if (isWorkbenchPrimaryModifier(event)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return {
    handler,
  };
}
