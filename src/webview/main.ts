import "@xterm/xterm/css/xterm.css";
import * as AiSelector from "./ai-tool-selector";
import * as TmuxPrompt from "./tmux-prompt";
import * as TmuxCmd from "./tmux-command-dropdown";
import { HostMessage } from "../types";
import { postMessage } from "./shared/vscode-api";
import { initTerminal } from "./terminal";
import { createMessageHandler, type MessageHandlerCallbacks } from "./messages";
import {
  setupTmuxToolbar,
  setupPaneControls,
  setupAiToolButton,
  setupReloadButton,
  setupTmuxCommandButton,
} from "./toolbar";

import {
  createDashboardRenderer,
  setupDashboardEventListeners,
} from "./dashboard-renderer";

const dashboard = createDashboardRenderer();

let currentSessionId: string | null = null;

const callbacks: MessageHandlerCallbacks = {
  onActiveSession(message) {
    const toolbar = document.getElementById("tmux-toolbar");
    const label = document.getElementById("tmux-session-label");
    const toolbarControls = document.querySelector(".toolbar-controls");
    const aiToolBtn = document.getElementById("btn-ai-tool");
    const killPaneBtn = document.getElementById("btn-kill-pane");
    if ("sessionName" in message && message.sessionName) {
      currentSessionId = message.sessionId;
      if (toolbar) toolbar.classList.remove("hidden");
      if (label) {
        const windowSuffix =
          message.windowIndex !== undefined
            ? ` [${message.windowIndex}]${message.windowName ? ` ${message.windowName}` : ""}`
            : "";
        label.textContent = message.sessionName + windowSuffix;
      }
      if (toolbarControls) {
        toolbarControls.classList.remove("hidden");
      }
      if (aiToolBtn) {
        aiToolBtn.style.display = message.paneHasAiTool ? "none" : "";
      }
      if (killPaneBtn) {
        killPaneBtn.toggleAttribute("disabled", !message.canKillPane);
      }
    } else {
      currentSessionId = null;
      if (label) label.textContent = "";
      if (toolbarControls) {
        toolbarControls.classList.add("hidden");
      }
      if (aiToolBtn) aiToolBtn.style.display = "none";
    }
  },

  onShowAiToolSelector(message) {
    AiSelector.show(
      message.sessionId,
      message.sessionName,
      message.defaultTool,
      message.tools,
      message.targetPaneId,
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
  setupReloadButton();
  setupTmuxCommandButton(() => currentSessionId, {
    postMessage: (message) => postMessage(message as never),
  });
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
        targetPaneId: m.targetPaneId ? String(m.targetPaneId) : undefined,
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
    if (TmuxCmd.isVisible()) {
      if (TmuxCmd.handleKeydown(event)) {
        return;
      }
    }
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

    if (TmuxCmd.isVisible()) {
      if (
        target.closest(".tmux-cmd-item") &&
        !target.closest(".tmux-cmd-item.disabled")
      ) {
        TmuxCmd.handleClick(target);
      } else if (
        !target.closest("#tmux-command-dropdown") &&
        !target.closest("#btn-tmux-commands")
      ) {
        TmuxCmd.hide();
      }
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
