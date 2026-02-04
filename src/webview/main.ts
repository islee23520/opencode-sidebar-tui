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

const style = document.createElement("style");
style.textContent = `
  .terminal-completion-widget {
    position: absolute;
    background-color: #252526;
    border: 1px solid #454545;
    z-index: 1000;
    max-height: 200px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 13px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    min-width: 200px;
    display: none;
  }
  .terminal-completion-item {
    padding: 4px 8px;
    cursor: pointer;
    color: #cccccc;
    display: flex;
    flex-direction: column;
  }
  .terminal-completion-item.selected {
    background-color: #094771;
    color: #ffffff;
  }
  .terminal-completion-item:hover {
    background-color: #2a2d2e;
  }
  .terminal-completion-item.selected:hover {
    background-color: #094771;
  }
  .terminal-completion-detail {
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 2px;
  }
`;
document.head.appendChild(style);

class TerminalCompletionProvider {
  private _terminal: Terminal;
  private _element: HTMLElement;
  private _isVisible: boolean = false;
  private _terminals: { name: string; cwd: string }[] = [];
  private _filteredTerminals: { name: string; cwd: string }[] = [];
  private _selectedIndex: number = 0;
  private _filter: string = "";
  private _startColumn: number = 0;
  private _pendingCheck: ReturnType<typeof setTimeout> | null = null;

  constructor(terminal: Terminal) {
    this._terminal = terminal;
    this._element = document.createElement("div");
    this._element.className = "terminal-completion-widget";
    document.body.appendChild(this._element);

    this._element.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    this._element.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest(".terminal-completion-item");
      if (item) {
        const index = parseInt(item.getAttribute("data-index") || "0", 10);
        this._selectItem(index);
      }
    });
  }

  public handleData(data: string) {
    if (this._pendingCheck) {
      clearTimeout(this._pendingCheck);
    }
    this._pendingCheck = setTimeout(() => {
      this._pendingCheck = null;
      this._checkTrigger();
    }, 0);
  }

  public dispose() {
    if (this._pendingCheck) {
      clearTimeout(this._pendingCheck);
      this._pendingCheck = null;
    }
    this._element.remove();
  }

  public updateTerminals(terminals: { name: string; cwd: string }[]) {
    this._terminals = terminals;
    if (this._isVisible) {
      this._updateList();
    }
  }

  public handleKey(event: KeyboardEvent): boolean {
    if (!this._isVisible) {
      return true;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        this._selectedIndex =
          (this._selectedIndex - 1 + this._filteredTerminals.length) %
          this._filteredTerminals.length;
        this._render();
        return false;
      case "ArrowDown":
        event.preventDefault();
        this._selectedIndex =
          (this._selectedIndex + 1) % this._filteredTerminals.length;
        this._render();
        return false;
      case "Enter":
      case "Tab":
        event.preventDefault();
        this._selectItem(this._selectedIndex);
        return false;
      case "Escape":
        event.preventDefault();
        this._hide();
        return false;
      default:
        return true;
    }
  }

  private _checkTrigger() {
    if (!this._terminal.buffer.active) return;

    const buffer = this._terminal.buffer.active;
    const cursorY = buffer.cursorY;
    const cursorX = buffer.cursorX;
    const line = buffer.getLine(cursorY);

    if (!line) return;

    const lineText = line.translateToString(true);
    const textBeforeCursor = lineText.substring(0, cursorX);

    const match = textBeforeCursor.match(/@terminal:([\w-]*)$/);

    if (match) {
      const matchText = match[0];
      this._filter = match[1];
      this._startColumn = cursorX - matchText.length;

      if (!this._isVisible) {
        vscode.postMessage({ type: "listTerminals" });
        this._show();
      }

      this._updateList();
    } else {
      this._hide();
    }
  }

  private _updateList() {
    if (!this._filter) {
      this._filteredTerminals = this._terminals;
    } else {
      const lowerFilter = this._filter.toLowerCase();
      this._filteredTerminals = this._terminals.filter((t) =>
        t.name.toLowerCase().includes(lowerFilter),
      );
    }

    this._selectedIndex = 0;
    this._render();
  }

  private _show() {
    this._isVisible = true;
    this._element.style.display = "block";
    this._updatePosition();
  }

  private _hide() {
    this._isVisible = false;
    this._element.style.display = "none";
  }

  private _updatePosition() {
    if (!this._terminal.element) return;

    const cursorY = this._terminal.buffer.active.cursorY;

    const termElement = this._terminal.element;
    const cellWidth = termElement.clientWidth / this._terminal.cols;
    const cellHeight = termElement.clientHeight / this._terminal.rows;

    const top = (cursorY + 1) * cellHeight;
    const left = this._startColumn * cellWidth;

    const rect = termElement.getBoundingClientRect();

    this._element.style.top = `${rect.top + top}px`;
    this._element.style.left = `${rect.left + left}px`;
  }

  private _render() {
    if (this._filteredTerminals.length === 0) {
      this._element.innerHTML =
        '<div class="terminal-completion-item">No matching terminals</div>';
      return;
    }

    this._element.innerHTML = this._filteredTerminals
      .map((term, index) => {
        const isSelected = index === this._selectedIndex;
        const name = this._escapeHtml(term.name);
        const cwd = this._escapeHtml(term.cwd);
        return `
        <div class="terminal-completion-item ${isSelected ? "selected" : ""}" data-index="${index}">
          <span>${name}</span>
          <span class="terminal-completion-detail">${cwd}</span>
        </div>
      `;
      })
      .join("");

    const selectedEl = this._element.querySelector(".selected");
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  private _selectItem(index: number) {
    if (index < 0 || index >= this._filteredTerminals.length) return;

    const term = this._filteredTerminals[index];
    const toInsert = term.name;

    const charsToDelete = this._filter.length;
    let backspaces = "";
    for (let i = 0; i < charsToDelete; i++) {
      backspaces += "\x7F";
    }

    vscode.postMessage({
      type: "terminalInput",
      data: backspaces + toInsert,
    });

    this._hide();
  }

  private _escapeHtml(unsafe: string) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/'/g, "&#039;")
      .replace(/"/g, "&quot;");
  }
}

let terminal: Terminal | null = null;
let completionProvider: TerminalCompletionProvider | null = null;
let fitAddon: FitAddon | null = null;
let currentPlatform: string = "";
let justHandledCtrlC = false;

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

  completionProvider = new TerminalCompletionProvider(terminal);

  terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
    if (completionProvider && !completionProvider.handleKey(event)) {
      return false;
    }

    const isCtrlC =
      event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      (event.key === "c" || event.key === "C");
    const isCtrlZ =
      event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      (event.key === "z" || event.key === "Z");

    if (isCtrlC) {
      if (currentPlatform === "win32" && terminal) {
        const selection = terminal.getSelection();
        if (selection && selection.length > 0) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.error("Failed to copy to clipboard:", err);
          });
          justHandledCtrlC = true;
          // Reset flag after a short delay to prevent the subsequent onData event
          // (triggered by xterm.js when Ctrl+C is pressed) from being filtered.
          // The 100ms duration is chosen to be longer than typical event propagation
          // but short enough to not interfere with normal user input.
          setTimeout(() => {
            justHandledCtrlC = false;
          }, 100);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    if (isCtrlZ) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    return true;
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

      // Security: Limit line length to prevent ReDoS attacks
      const MAX_LINE_LENGTH = 10000;
      if (lineText.length > MAX_LINE_LENGTH) {
        callback(undefined);
        return;
      }

      const links: any[] = [];

      // Match OpenCode @file format: @path/to/file or @path/to/file#L10 or @path/to/file#L10-L20
      // Also match standard file paths: file://, /absolute, ./relative, ../relative, path:line:col
      const pathRegex =
        /(?:^[\s"'])(@?((?:file:\/\/|\/|[A-Za-z]:\\|\.?\.?\/)[^\s"'#]+|[^\s"':\/]+(?:\/[^\s"':\/]+)+)(?:#L(\d+)(?:-L?(\d+))?)?)(?=[\s"']|$)/gi;

      let match;
      let lastIndex = -1;
      while ((match = pathRegex.exec(lineText)) !== null) {
        // Prevent infinite loop on zero-width matches
        if (match.index === lastIndex) {
          pathRegex.lastIndex++;
          continue;
        }
        lastIndex = match.index;

        const fullMatch = match[1];
        const hasAtPrefix = fullMatch.startsWith("@");
        let path = match[2];
        const lineNumStr = match[3];
        const endLineStr = match[4];

        if (!path) continue;

        let lineNumber: number | undefined;
        let columnNumber: number | undefined;
        let endLineNumber: number | undefined;

        // Handle file:// URLs
        if (path.startsWith("file://")) {
          try {
            const url = new URL(path);
            path = decodeURIComponent(url.pathname);
            if (url.hostname && !url.pathname.startsWith("/")) {
              path = `${url.hostname}:${path}`;
            }
          } catch (e) {
            console.error("Failed to parse file:// URL:", path, e);
            continue;
          }
        }

        // Parse line numbers from @file#L10 or @file#L10-L20 format
        if (lineNumStr) {
          lineNumber = parseInt(lineNumStr, 10);
        }
        if (endLineStr) {
          endLineNumber = parseInt(endLineStr, 10);
        }

        // Also try to parse :line:col format for standard paths
        if (!hasAtPrefix && !lineNumStr) {
          const posRegex = /^(.*?):(\d+)(?::(\d+))?$/;
          const posMatch = path.match(posRegex);
          if (posMatch) {
            path = posMatch[1];
            lineNumber = parseInt(posMatch[2], 10);
            if (posMatch[3]) {
              columnNumber = parseInt(posMatch[3], 10);
            }
          }
        }

        // Calculate the actual start index of the clickable portion
        const index = match.index + (match[0].length - fullMatch.length);

        links.push({
          text: fullMatch,
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + fullMatch.length, y: bufferLineNumber },
          },
          activate: () => {
            vscode.postMessage({
              type: "openFile",
              path: path,
              line: lineNumber,
              endLine: endLineNumber,
              column: columnNumber,
            });
          },
        });
      }

      callback(links);
    },
  });

  // Register terminal link provider
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
      const terminalRegex = /@terminal:([a-zA-Z0-9_\-\.]+)/g;

      let match;
      while ((match = terminalRegex.exec(lineText)) !== null) {
        const fullMatch = match[0];
        const terminalName = match[1];
        const index = match.index;

        links.push({
          text: fullMatch,
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + fullMatch.length, y: bufferLineNumber },
          },
          activate: (event: MouseEvent) => {
            showTerminalContextMenu(event, terminalName);
          },
          hover: (event: MouseEvent, text: string) => {
            const tooltip = document.createElement("div");
            tooltip.id = "terminal-tooltip";
            tooltip.textContent = `Manage terminal: ${terminalName}`;
            Object.assign(tooltip.style, {
              position: "absolute",
              left: `${event.clientX}px`,
              top: `${event.clientY - 25}px`,
              backgroundColor: "#252526",
              border: "1px solid #454545",
              padding: "2px 6px",
              zIndex: "1001",
              color: "#cccccc",
              fontSize: "12px",
              pointerEvents: "none",
            });
            document.body.appendChild(tooltip);
          },
          leave: (event: MouseEvent, text: string) => {
            const tooltip = document.getElementById("terminal-tooltip");
            if (tooltip) tooltip.remove();
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

  const refreshTerminal = () => terminal?.refresh(0, terminal.rows - 1);
  container.addEventListener("focusin", refreshTerminal);
  container.addEventListener("click", refreshTerminal);

  // Fit terminal when container becomes visible using IntersectionObserver
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && fitAddon && terminal) {
          fitAddon.fit();
          terminal.refresh(0, terminal.rows - 1);
        }
      });
    },
    { threshold: 0.1 },
  );
  visibilityObserver.observe(container);

  // Use requestAnimationFrame for initial fit (waits for browser paint)
  requestAnimationFrame(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
    }
  });

  // Backup setTimeout to ensure sizing even if RAF fires too early
  setTimeout(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
      terminal.refresh(0, terminal.rows - 1);
    }
  }, 100);

  // Additional fit after a longer delay to handle slow rendering
  setTimeout(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
      terminal.refresh(0, terminal.rows - 1);
    }
  }, 500);

  terminal.onData((data) => {
    if (justHandledCtrlC) {
      justHandledCtrlC = false;
      const filteredData = data.replace(/[\x03\x1A]/g, "");
      if (filteredData) {
        if (completionProvider) {
          completionProvider.handleData(filteredData);
        }
        vscode.postMessage({
          type: "terminalInput",
          data: filteredData,
        });
      }
      return;
    }

    const filteredData = data.replace(/[\x03\x1A]/g, "");

    if (completionProvider && filteredData) {
      completionProvider.handleData(filteredData);
    }

    if (filteredData) {
      vscode.postMessage({
        type: "terminalInput",
        data: filteredData,
      });
    }
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

function showTerminalContextMenu(event: MouseEvent, terminalName: string) {
  const existing = document.getElementById("terminal-context-menu");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.id = "terminal-context-menu";
  Object.assign(menu.style, {
    position: "absolute",
    left: `${event.clientX}px`,
    top: `${event.clientY}px`,
    backgroundColor: "#252526",
    border: "1px solid #454545",
    padding: "4px 0",
    zIndex: "1000",
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
    color: "#cccccc",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    minWidth: "150px",
  });

  const createItem = (label: string, onClick: () => void) => {
    const item = document.createElement("div");
    item.textContent = label;
    Object.assign(item.style, {
      padding: "4px 12px",
      cursor: "pointer",
    });
    item.addEventListener(
      "mouseenter",
      () => (item.style.backgroundColor = "#094771"),
    );
    item.addEventListener(
      "mouseleave",
      () => (item.style.backgroundColor = "transparent"),
    );
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
      menu.remove();
    });
    return item;
  };

  menu.appendChild(
    createItem("Focus Terminal", () => {
      vscode.postMessage({
        type: "terminalAction",
        action: "focus",
        terminalName,
      });
    }),
  );

  menu.appendChild(
    createItem("Send Command...", () => {
      const cmd = window.prompt("Enter command to send:");
      if (cmd) {
        vscode.postMessage({
          type: "terminalAction",
          action: "sendCommand",
          terminalName,
          command: cmd,
        });
      }
    }),
  );

  menu.appendChild(
    createItem("Start Capture", () => {
      vscode.postMessage({
        type: "terminalAction",
        action: "capture",
        terminalName,
      });
    }),
  );

  document.body.appendChild(menu);

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener("click", closeMenu);
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 0);
}

window.addEventListener("message", (event) => {
  const message = event.data as HostMessage;

  switch (message.type) {
    case "terminalList":
      if (completionProvider) {
        completionProvider.updateTerminals(message.terminals);
      }
      break;
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
    case "webviewVisible":
      // Refit and refresh terminal when webview becomes visible
      setTimeout(() => {
        if (fitAddon && terminal) {
          fitAddon.fit();
          terminal.refresh(0, terminal.rows - 1);
        }
      }, 100);
      break;
    case "platformInfo":
      currentPlatform = message.platform;
      break;
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTerminal);
} else {
  initTerminal();
}
