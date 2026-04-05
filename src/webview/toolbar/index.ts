import { postMessage } from "../shared/vscode-api";

export function setupAiToolButton(): void {
  const btnAiTool = document.getElementById("btn-ai-tool");
  btnAiTool?.addEventListener("click", () => {
    postMessage({ type: "requestAiToolSelector" });
  });
}

export function setupTmuxToolbar(): void {
  document
    .getElementById("btn-open-dashboard")
    ?.addEventListener("click", () => {
      postMessage({ type: "toggleDashboard" });
    });
}

export function setupPaneControls(): void {
  const btnSplitV = document.getElementById("btn-split-v");
  const btnSplitH = document.getElementById("btn-split-h");
  const btnNewWindow = document.getElementById("btn-new-window");
  const btnNextWindow = document.getElementById("btn-next-window");
  const btnZoomPane = document.getElementById("btn-zoom-pane");
  const btnKillPane = document.getElementById("btn-kill-pane");

  btnSplitV?.addEventListener("click", () => {
    postMessage({ type: "splitTmuxPane", direction: "v" });
  });
  btnSplitH?.addEventListener("click", () => {
    postMessage({ type: "splitTmuxPane", direction: "h" });
  });
  btnNewWindow?.addEventListener("click", () => {
    postMessage({ type: "createTmuxWindow" });
  });
  btnNextWindow?.addEventListener("click", () => {
    postMessage({ type: "navigateTmuxWindow", direction: "next" });
  });
  btnZoomPane?.addEventListener("click", () => {
    postMessage({ type: "zoomTmuxPane" });
  });
  btnKillPane?.addEventListener("click", () => {
    postMessage({ type: "killTmuxPane" });
  });
}
