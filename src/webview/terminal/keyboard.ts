const detectMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");

const isLetterOrDigitCode = (code: string): boolean =>
  /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);

export interface KeyboardHandlerOptions {
  isMac?: boolean;
}

export function createKeyboardHandler(options: KeyboardHandlerOptions = {}) {
  const isMac = options.isMac ?? detectMacPlatform();

  const isWorkbenchPrimaryModifier = (event: KeyboardEvent): boolean =>
    isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

  const isPasteShortcut = (event: KeyboardEvent): boolean =>
    event.code === "KeyV" && !event.altKey && isWorkbenchPrimaryModifier(event);

  const handler = (event: KeyboardEvent): boolean => {
    const isLetterOrDigitChord =
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      isLetterOrDigitCode(event.code);

    if (!isLetterOrDigitChord) {
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
