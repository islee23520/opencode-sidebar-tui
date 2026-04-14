import { postMessage } from "../shared/vscode-api";

import * as TmuxCmd from "../tmux-command-dropdown";

export function setupTmuxCommandButton(
  getSessionId: () => string | null,
): void {
  const btnTmuxCommands = document.getElementById("btn-tmux-commands");
  btnTmuxCommands?.addEventListener("click", () => {
    TmuxCmd.isVisible() ? TmuxCmd.hide() : TmuxCmd.show(getSessionId());
  });
}

export function setupKillPaneButton(): void {
  document.getElementById("btn-kill-pane")?.addEventListener("click", () => {
    postMessage({ type: "killTmuxPane" });
  });
}

export function setupReloadButton(): void {
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    postMessage({ type: "requestRestart" });
  });
}
