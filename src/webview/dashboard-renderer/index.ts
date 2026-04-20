import { postMessage } from "../shared/vscode-api";
import { escapeHtml } from "../shared/utils";

export interface DashboardSession {
  id: string;
  name: string;
  workspace: string;
  isActive: boolean;
  preview?: string;
}

interface DashboardState {
  visible: boolean;
  sessions: DashboardSession[];
  workspace: string;
  showingAll: boolean;
}

export function createDashboardRenderer() {
  const state: DashboardState = {
    visible: false,
    sessions: [],
    workspace: "",
    showingAll: false,
  };

  function render(): void {
    const container = document.getElementById("dashboard-container");
    const workspaceEl = document.getElementById("dashboard-workspace");
    const listEl = document.getElementById("dashboard-session-list");

    if (!container || !listEl) return;

    if (!state.visible) {
      container.classList.add("hidden");
      return;
    }

    container.classList.remove("hidden");

    if (workspaceEl) {
      workspaceEl.textContent = `Workspace: ${state.workspace || "-"}${state.showingAll ? " (all)" : ""}`;
    }

    if (state.sessions.length === 0) {
      listEl.innerHTML =
        '<div class="dashboard-empty">No tmux sessions for this workspace.</div>';
      return;
    }

    listEl.innerHTML = state.sessions
      .map((session) => {
        const activeClass = session.isActive ? " active" : "";
        const statusText = session.isActive ? "Current" : "Available";
        const previewHtml = session.preview
          ? `<div class="session-preview">${session.preview
              .split(/\r?\n/)
              .filter((line) => line.trim().length > 0)
              .slice(-10)
              .map(
                (line) => `<div class="preview-line">${escapeHtml(line)}</div>`,
              )
              .join("")}</div>`
          : '<div class="session-preview empty">No preview available</div>';

        return `
        <div class="dashboard-session-card${activeClass}" data-session-id="${escapeHtml(session.id)}">
          <div class="row">
            <div>
              <strong>${escapeHtml(session.name)}</strong>
              <div class="status">${statusText}</div>
            </div>
            <button class="kill-btn" data-action="killSession" data-session-id="${escapeHtml(session.id)}" title="Kill Session">✕</button>
          </div>
          <div class="meta-grid">
            <div class="meta">tmux session: ${escapeHtml(session.id)}</div>
            <div class="meta">workspace: ${escapeHtml(session.workspace)}</div>
          </div>
          ${previewHtml}
        </div>
      `;
      })
      .join("");
  }

  return {
    setVisible(visible: boolean) {
      state.visible = visible;
      render();
      if (visible) {
        postMessage({ type: "listTerminals" });
      }
    },

    toggle() {
      state.visible = !state.visible;
      render();
      if (state.visible) {
        postMessage({ type: "listTerminals" });
      }
    },

    updateSessions(sessions: DashboardSession[]) {
      state.sessions = sessions;
      render();
    },

    updateWorkspace(workspace: string) {
      state.workspace = workspace;
      render();
    },

    updateShowingAll(showingAll: boolean) {
      state.showingAll = showingAll;
      render();
    },

    get isVisible() {
      return state.visible;
    },

    render,
  };
}

export function setupDashboardEventListeners(
  toggleDashboard: () => void,
): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target.id === "dashboard-new-tmux") {
      postMessage({ type: "createTmuxSession" });
      return;
    }

    if (target.id === "dashboard-refresh") {
      postMessage({ type: "listTerminals" });
      return;
    }

    const sessionCard = target.closest(".dashboard-session-card");
    if (sessionCard instanceof HTMLElement && sessionCard.dataset.sessionId) {
      const killBtn = target.closest(".kill-btn");
      if (killBtn) {
        postMessage({
          type: "killSession",
          sessionId: sessionCard.dataset.sessionId,
        });
      } else {
        postMessage({
          type: "switchSession",
          sessionId: sessionCard.dataset.sessionId,
        });
        toggleDashboard();
      }
    }
  });
}
