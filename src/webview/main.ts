import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebviewMessage, HostMessage } from "../types";

declare function acquireVsCodeApi(): {
  postMessage: (message: WebviewMessage) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;

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
  terminal.loadAddon(
    new WebLinksAddon((_, url) => {
      vscode.postMessage({
        type: "openUrl",
        url: url,
      });
    }),
  );

  // Register file path link provider
  terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      if (!terminal) {
        callback(undefined);
        return;
      }

      const line = terminal.buffer.active.getLine(bufferLineNumber);
      if (!line) {
        callback(undefined);
        return;
      }

      const lineText = line.translateToString(true);
      const links: any[] = [];

      const pathRegex =
        /(?:^|[\s"'])((file:\/\/|\/|[A-Z]:\\|\.?\.?\/|[^\s"':\/]+\/)[^\s"']+(?::\d+(?::\d+)?)?)/g;

      let match;
      while ((match = pathRegex.exec(lineText)) !== null) {
        const fullMatch = match[0];
        const pathWithPos = match[1];
        const index = match.index + (fullMatch.length - pathWithPos.length);

        // Parse path, line, column
        // Pattern: path:line:col or path:line
        const posRegex = /^(.*?):(\d+)(?::(\d+))?$/;
        const posMatch = pathWithPos.match(posRegex);

        let path = pathWithPos;
        let lineNumber: number | undefined;
        let columnNumber: number | undefined;

        if (path.startsWith("file://")) {
          try {
            const url = new URL(path);
            path = decodeURIComponent(url.pathname);
            if (url.hostname && !url.pathname.startsWith("/")) {
              path = `${url.hostname}:${path}`;
            }
          } catch (e) {
            console.error("Failed to parse file:// URL:", path, e);
          }
        }

        if (posMatch) {
          path = posMatch[1];
          lineNumber = parseInt(posMatch[2], 10);
          if (posMatch[3]) {
            columnNumber = parseInt(posMatch[3], 10);
          }
        }

        links.push({
          text: pathWithPos,
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + pathWithPos.length, y: bufferLineNumber },
          },
          activate: () => {
            vscode.postMessage({
              type: "openFile",
              path: path,
              line: lineNumber,
              column: columnNumber,
            });
          },
        });
      }

      callback(links);
    },
  });

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
      type: "terminalInput",
      data: data,
    });
  });

  terminal.onResize(({ cols, rows }) => {
    vscode.postMessage({
      type: "terminalResize",
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
    container.style.opacity = "0.7";
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

    console.log("[DROP] ShiftKey:", e.shiftKey);
    console.log("[DROP] dataTransfer.types:", e.dataTransfer?.types);
    console.log(
      "[DROP] dataTransfer.items.length:",
      e.dataTransfer?.items.length,
    );
    console.log(
      "[DROP] dataTransfer.files.length:",
      e.dataTransfer?.files.length,
    );

    if (e.dataTransfer) {
      const files: string[] = [];

      const uriList = e.dataTransfer.getData("text/uri-list");
      console.log("[DROP] URI List raw:", uriList);
      console.log("[DROP] URI List length:", uriList?.length);

      if (uriList) {
        const uris = uriList
          .split("\n")
          .filter((uri) => uri.trim().length > 0 && !uri.startsWith("#"));
        console.log("[DROP] Parsed URIs:", uris);
        console.log("[DROP] Parsed URIs count:", uris.length);

        for (const uri of uris) {
          try {
            const url = new URL(uri.trim());
            if (url.protocol === "file:") {
              const path = decodeURIComponent(url.pathname);
              files.push(path);
              console.log("[DROP] Added file from URI:", path);
            }
          } catch (err) {
            console.log("[DROP] Failed to parse URI:", uri, err);
            files.push(uri.trim());
          }
        }
      }

      if (files.length === 0) {
        console.log("[DROP] Fallback to dataTransfer.items");
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          console.log(
            "[DROP] Item",
            i,
            "- kind:",
            item.kind,
            "type:",
            item.type,
          );
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              const filePath = (file as any).path || file.name;
              console.log("[DROP] Added file from item:", filePath);
              files.push(filePath);
            }
          }
        }
      }

      console.log("[DROP] Final file count:", files.length, "Files:", files);
      if (files.length > 0) {
        vscode.postMessage({
          type: "filesDropped",
          files: files,
          shiftKey: e.shiftKey,
        });
      } else {
        console.warn("[DROP] No files found in drop event!");
      }
    }
  });

  vscode.postMessage({ type: "ready" });
}

window.addEventListener("message", (event) => {
  const message = event.data as HostMessage;

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
