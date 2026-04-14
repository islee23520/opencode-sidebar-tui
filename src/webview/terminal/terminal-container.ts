export interface TerminalContainerParams {
  fontSize: string;
  fontFamily: string;
  cursorBlink: string;
  cursorStyle: string;
  scrollback: string;
}

export function renderTerminalContainer({
  fontSize,
  fontFamily,
  cursorBlink,
  cursorStyle,
  scrollback,
}: TerminalContainerParams): string {
  return `<div
      id="terminal-container"
      data-font-size="${fontSize}"
      data-font-family="${fontFamily}"
      data-cursor-blink="${cursorBlink}"
      data-cursor-style="${cursorStyle}"
      data-scrollback="${scrollback}"
    ></div>`;
}
