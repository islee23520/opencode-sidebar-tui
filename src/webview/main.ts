import "@xterm/xterm/css/xterm.css";
import * as AiSelector from "./ai-tool-selector";
import * as TmuxPrompt from "./tmux-prompt";
import { HostMessage } from "../types";
import { postMessage } from "./shared/vscode-api";
import { initTerminal } from "./terminal";
import { createMessageHandler, type MessageHandlerCallbacks } from "./messages";
import {
  setupTmuxToolbar,
  setupPaneControls,
  setupAiToolButton,
} from "./toolbar";
import {
  createDashboardRenderer,
  setupDashboardEventListeners,
} from "./dashboard-renderer";

const dashboard = createDashboardRenderer();

const callbacks: MessageHandlerCallbacks = {
  onActiveSession(message) {
    const toolbar = document.getElementById("tmux-toolbar");
    const label = document.getElementById("tmux-session-label");
    const paneControls = document.getElementById("pane-controls");
    const aiToolBtn = document.getElementById("btn-ai-tool");
    if ("sessionName" in message && message.sessionName) {
      if (toolbar) toolbar.classList.remove("hidden");
      if (label) {
        const windowSuffix =
          message.windowIndex !== undefined
            ? ` [${message.windowIndex}]${message.windowName ? ` ${message.windowName}` : ""}`
            : "";
        label.textContent = message.sessionName + windowSuffix;
      }
      if (paneControls) paneControls.classList.remove("hidden");
      if (aiToolBtn) {
        aiToolBtn.style.display = message.paneHasAiTool ? "none" : "";
      }
    } else {
      if (toolbar) toolbar.classList.add("hidden");
      if (paneControls) paneControls.classList.add("hidden");
      if (aiToolBtn) aiToolBtn.style.display = "none";
    }
  },

  onShowAiToolSelector(message) {
    AiSelector.show(
      message.sessionId,
      message.sessionName,
      message.defaultTool,
      message.tools,
    );
  },

  onToggleDashboard(message) {
    dashboard.setVisible(message.visible);
  },

  onUpdateDashboard(message) {
    dashboard.updateSessions(message.sessions as any);
    dashboard.updateWorkspace(message.workspace ?? "");
    dashboard.updateShowingAll(message.showingAll ?? false);
  },

  onShowTmuxPrompt(message) {
    TmuxPrompt.show(message.workspaceName);
  },
};

const messageHandler = createMessageHandler(callbacks);

function initApp(): void {
  const container = document.getElementById("terminal-container");
  if (!container) return;

  const instance = initTerminal(container, {
    onData: (data) => {
      postMessage({ type: "terminalInput", data });
    },
    onResize: (cols, rows) => {
      postMessage({ type: "terminalResize", cols, rows });
    },
  });

  if (instance) {
    messageHandler.terminal = instance.terminal;
    messageHandler.fitAddon = instance.fitAddon;
  }

  setupTmuxToolbar();
  setupPaneControls();
  setupAiToolButton();
  setupDashboardEventListeners(() => dashboard.toggle());

  window.addEventListener("message", (event: MessageEvent) => {
    messageHandler.handleEvent(event as MessageEvent<HostMessage>);
  });

  setupAiToolSelectorEvents();
}

const aiCallbacks = {
  postMessage: (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m && m.action === "launchAiTool") {
      postMessage({
        type: "launchAiTool",
        sessionId: String(m.sessionId ?? ""),
        tool: String(m.tool ?? ""),
        savePreference: Boolean(m.savePreference),
      });
    }
  },
};

const tmuxPromptCallbacks = {
  postMessage: (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m && m.type === "sendTmuxPromptChoice") {
      postMessage({
        type: "sendTmuxPromptChoice",
        choice: String(m.choice) as "tmux" | "shell",
      });
    }
  },
};

function setupAiToolSelectorEvents(): void {
  document.addEventListener("keydown", (event) => {
    if (AiSelector.isVisible()) {
      AiSelector.handleKeydown(event, aiCallbacks);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event
      .composedPath()
      .find((el): el is Element => el instanceof Element);
    if (!target) return;

    if (AiSelector.isVisible()) {
      AiSelector.handleClick(target, aiCallbacks);
    }

    if (TmuxPrompt.isVisible()) {
      TmuxPrompt.handleClick(target, tmuxPromptCallbacks);
    }
  });
}

const boot = () => {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => initApp());
  } else {
    initApp();
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
