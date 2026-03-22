export interface TmuxSession {
  id: string;
  name: string;
  workspace: string;
  isActive: boolean;
}

export interface TreeSnapshot {
  type: "treeSnapshot";
  sessions: TmuxSession[];
  activeSessionId: string | null;
  emptyState?: "no-workspace" | "no-tmux" | "no-sessions";
}

export interface SessionTreeState {
  sessions: TmuxSession[];
  activeSessionId: string | null;
  emptyState?: "no-workspace" | "no-tmux" | "no-sessions";
  collapsedGroups: Set<string>;
}
