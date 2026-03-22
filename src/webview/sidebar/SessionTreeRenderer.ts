import { SessionTreeState, TmuxSession } from "./types";

export class SessionTreeRenderer {
  private container: HTMLElement;
  private onSessionClick: (sessionId: string) => void;
  private onGroupToggle: (groupName: string) => void;

  constructor(
    container: HTMLElement,
    onSessionClick: (sessionId: string) => void,
    onGroupToggle: (groupName: string) => void,
  ) {
    this.container = container;
    this.onSessionClick = onSessionClick;
    this.onGroupToggle = onGroupToggle;
  }

  public render(state: SessionTreeState): void {
    this.container.innerHTML = "";

    if (state.emptyState) {
      this.renderEmptyState(state.emptyState);
      return;
    }

    if (state.sessions.length === 0) {
      this.renderEmptyState("no-sessions");
      return;
    }

    const groupedSessions = this.groupSessions(state.sessions);

    for (const [groupName, sessions] of Object.entries(groupedSessions)) {
      const isCollapsed = state.collapsedGroups.has(groupName);
      const groupElement = this.renderGroup(
        groupName,
        sessions,
        isCollapsed,
        state.activeSessionId,
      );
      this.container.appendChild(groupElement);
    }
  }

  private renderEmptyState(emptyState: string): void {
    const el = document.createElement("div");
    el.className = "session-tree-empty-state";

    let message = "No sessions found.";
    if (emptyState === "no-workspace") {
      message = "No workspace open.";
    } else if (emptyState === "no-tmux") {
      message = "Tmux is not installed or running.";
    }

    el.textContent = message;
    this.container.appendChild(el);
  }

  private groupSessions(
    sessions: TmuxSession[],
  ): Record<string, TmuxSession[]> {
    const groups: Record<string, TmuxSession[]> = {};
    for (const session of sessions) {
      const group = session.workspace || "Other";
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(session);
    }
    return groups;
  }

  private renderGroup(
    groupName: string,
    sessions: TmuxSession[],
    isCollapsed: boolean,
    activeSessionId: string | null,
  ): HTMLElement {
    const groupEl = document.createElement("div");
    groupEl.className = "session-tree-group";

    const headerEl = document.createElement("div");
    headerEl.className = "session-tree-group-header";
    headerEl.textContent = `${isCollapsed ? "▶" : "▼"} ${groupName}`;
    headerEl.onclick = () => this.onGroupToggle(groupName);
    groupEl.appendChild(headerEl);

    if (!isCollapsed) {
      const listEl = document.createElement("div");
      listEl.className = "session-tree-list";
      for (const session of sessions) {
        const itemEl = this.renderSessionItem(
          session,
          session.id === activeSessionId,
        );
        listEl.appendChild(itemEl);
      }
      groupEl.appendChild(listEl);
    }

    return groupEl;
  }

  private renderSessionItem(
    session: TmuxSession,
    isActive: boolean,
  ): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.className = `session-tree-item ${isActive ? "active" : ""}`;
    itemEl.textContent = session.name;
    itemEl.onclick = () => this.onSessionClick(session.id);
    return itemEl;
  }
}
