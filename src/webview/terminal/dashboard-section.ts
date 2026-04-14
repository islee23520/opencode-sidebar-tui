export function renderDashboardSection(): string {
  return `<div id="dashboard-container" class="dashboard-container hidden">
      <div class="dashboard-header">
        <div class="dashboard-header-main">
          <div class="dashboard-title">Session Dashboard</div>
          <div class="dashboard-workspace" id="dashboard-workspace">
            Workspace: -
          </div>
        </div>
        <div class="dashboard-actions">
          <button
            type="button"
            id="dashboard-new-tmux"
            class="dashboard-btn primary"
            data-tmux-only
          >
            New tmux
          </button>
          <button type="button" id="dashboard-new-shell" class="dashboard-btn">
            New shell
          </button>
          <button
            type="button"
            id="dashboard-toggle-scope"
            class="dashboard-btn"
          >
            Global
          </button>
          <button type="button" id="dashboard-refresh" class="dashboard-btn">
            Refresh
          </button>
          <button
            type="button"
            id="dashboard-close"
            class="dashboard-btn close-btn"
          >
            ×
          </button>
        </div>
      </div>
      <div id="dashboard-session-list" class="dashboard-session-list"></div>
      <div id="dashboard-ai-selector" class="ai-selector-backdrop">
        <div class="ai-selector-card">
          <div class="ai-selector-title">Launch AI Tool</div>
          <div
            class="ai-selector-subtitle"
            id="dashboard-ai-selector-session"
          ></div>
          <div class="ai-selector-options" id="dashboard-ai-tool-options"></div>
          <label class="ai-selector-save">
            <input type="checkbox" id="dashboard-ai-save-default" />
            <span>Save as default</span>
          </label>
          <div class="ai-selector-hint">
            ↑↓ Navigate · Enter Select · Esc Dismiss
          </div>
        </div>
      </div>
    </div>`;
}
