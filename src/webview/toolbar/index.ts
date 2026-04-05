import { postMessage } from "../shared/vscode-api";

export function setupAiToolButton(): void {
  const btnAiTool = document.getElementById("btn-ai-tool");
  btnAiTool?.addEventListener("click", () => {
    postMessage({ type: "requestAiToolSelector" });
  });
}

export function setupTmuxToolbar(): void {
  const prevSession = document.getElementById("btn-prev-session");
  const nextSession = document.getElementById("btn-next-session");
  const prevWindow = document.getElementById("btn-prev-window");
  const nextWindow = document.getElementById("btn-next-window");

  prevSession?.addEventListener("click", () => {
    postMessage({ type: "navigateTmuxSession", direction: "prev" });
  });
  nextSession?.addEventListener("click", () => {
    postMessage({ type: "navigateTmuxSession", direction: "next" });
  });
  prevWindow?.addEventListener("click", () => {
    postMessage({ type: "navigateTmuxWindow", direction: "prev" });
  });
  nextWindow?.addEventListener("click", () => {
    postMessage({ type: "navigateTmuxWindow", direction: "next" });
  });
}

export function setupPaneControls(): void {
  const btnSplitV = document.getElementById("btn-split-v");
  const btnSplitH = document.getElementById("btn-split-h");
  const btnNewWindow = document.getElementById("btn-new-window");
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
  btnZoomPane?.addEventListener("click", () => {
    postMessage({ type: "zoomTmuxPane" });
  });
  btnKillPane?.addEventListener("click", () => {
    postMessage({ type: "killTmuxPane" });
  });
}
