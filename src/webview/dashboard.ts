declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

interface Instance {
  id: string;
  label?: string;
  port?: number;
  state:
    | "connected"
    | "disconnected"
    | "error"
    | "spawning"
    | "connecting"
    | "resolving"
    | "stopping";
  error?: string;
  sessionTitle?: string;
  model?: string;
  messageCount?: number;
  version?: string;
}

type UpdateInstancesMessage = {
  type: "updateInstances";
  instances: Instance[];
  activeId?: string;
};

const stateColors: Record<string, string> = {
  connected: "#28a745",
  disconnected: "#6c757d",
  error: "#dc3545",
  spawning: "#ffc107",
  connecting: "#ffc107",
  resolving: "#ffc107",
  stopping: "#ffc107",
};

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createInstanceCard(instance: Instance, isActive: boolean): string {
  const label = escapeHtml(instance.label || instance.id);
  const state = escapeHtml(instance.state);
  const stateColor = stateColors[instance.state] || "#6c757d";
  const portText = instance.port !== undefined ? String(instance.port) : "N/A";
  const sessionTitle = instance.sessionTitle
    ? escapeHtml(instance.sessionTitle)
    : "N/A";
  const model = instance.model ? escapeHtml(instance.model) : "N/A";
  const messageCount =
    instance.messageCount !== undefined ? String(instance.messageCount) : "N/A";
  const version = instance.version ? escapeHtml(instance.version) : "N/A";
  const errorText = instance.error
    ? `<div class="error-text">Error: ${escapeHtml(instance.error)}</div>`
    : "";
  const activeBadge = isActive
    ? '<span class="active-badge">ACTIVE</span>'
    : "";

  return `
    <div class="instance-card ${isActive ? "active" : ""}" data-id="${escapeHtml(instance.id)}">
      <div class="instance-header">
        <span class="state-badge" style="background-color: ${stateColor}"></span>
        <span class="instance-label">${label}</span>
        ${activeBadge}
      </div>
      <div class="instance-details">
        <div>Port: ${escapeHtml(portText)} | State: ${state}</div>
        <div>Session: ${sessionTitle}</div>
        <div>Model: ${model}</div>
        <div>Messages: ${escapeHtml(messageCount)}</div>
        <div>Version: ${version}</div>
        ${errorText}
      </div>
      <div class="instance-actions">
        ${
          instance.state !== "connected"
            ? `<button class="action-btn connect" data-action="connect" data-id="${escapeHtml(instance.id)}">Connect</button>`
            : `<button class="action-btn disconnect" data-action="disconnect" data-id="${escapeHtml(instance.id)}">Disconnect</button>`
        }
        <button class="action-btn restart" data-action="restart" data-id="${escapeHtml(instance.id)}">Restart</button>
        <button class="action-btn focus" data-action="focus" data-id="${escapeHtml(instance.id)}">Focus</button>
        <button class="action-btn remove" data-action="remove" data-id="${escapeHtml(instance.id)}">Remove</button>
      </div>
    </div>
  `;
}

function renderInstances(instances: Instance[], activeId?: string): void {
  const container = document.getElementById("instances-container");
  if (!container) {
    return;
  }

  if (!instances || instances.length === 0) {
    container.innerHTML = '<p class="empty-state">No instances found.</p>';
    return;
  }

  container.innerHTML = instances
    .map((inst) => createInstanceCard(inst, inst.id === activeId))
    .join("");

  attachEventListeners();
}

function attachEventListeners(): void {
  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      const action = target.dataset.action;
      const instanceId = target.dataset.id;

      if (action && instanceId) {
        vscode.postMessage({ action, instanceId });
      }
    });
  });
}

window.addEventListener("message", (event) => {
  const message = event.data as UpdateInstancesMessage;

  if (message.type === "updateInstances") {
    renderInstances(message.instances, message.activeId);
  }
});

// Request initial data
vscode.postMessage({ action: "ready" });
