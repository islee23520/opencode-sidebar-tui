import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let isShiftKeyPressed = false;

function initTerminal(): void {
  const container = document.getElementById("terminal-container");
  if (!container) return;

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "monospace",
    theme: {
      background: "#1e1e1e",
      foreground: "#cccccc",
    },
    scrollback: 10000,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });
    terminal.loadAddon(webglAddon);
  } catch (e) {
    console.warn("WebGL addon failed to load, using canvas renderer");
  }

  terminal.open(container);
  fitAddon.fit();

  terminal.onData((data) => {
    vscode.postMessage({
      command: "terminalInput",
      data: data,
    });
  });

  terminal.onResize(({ cols, rows }) => {
    vscode.postMessage({
      command: "terminalResize",
      cols,
      rows,
    });
  });

  window.addEventListener("resize", () => {
    if (fitAddon && terminal) {
      fitAddon.fit();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
    }
  });

  resizeObserver.observe(container);

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isShiftKeyPressed = e.shiftKey;
    if (isShiftKeyPressed) {
      container.style.opacity = "0.7";
    }
  });

  container.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.style.opacity = "1";
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.style.opacity = "1";

    if (isShiftKeyPressed && e.dataTransfer) {
      const files: string[] = [];

      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            const filePath = (file as any).path || file.name;
            files.push(filePath);
          }
        }
      }

      if (files.length > 0) {
        vscode.postMessage({
          command: "filesDropped",
          files: files,
        });
      }
    }
    isShiftKeyPressed = false;
  });

  vscode.postMessage({ command: "ready" });
}

window.addEventListener("message", (event) => {
  const message = event.data;

  switch (message.command) {
    case "terminalOutput":
      if (terminal) {
        terminal.write(message.data);
      }
      break;
    case "clearTerminal":
      if (terminal) {
        terminal.clear();
      }
      break;
    case "terminalExited":
      if (terminal) {
        terminal.write("\r\n\x1b[31mOpenCode exited\x1b[0m\r\n");
      }
      break;
    case "focusTerminal":
      if (terminal) {
        terminal.focus();
      }
      break;
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTerminal);
} else {
  initTerminal();
}
