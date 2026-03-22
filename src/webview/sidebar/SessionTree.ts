import { TmuxSession, TreeSnapshot, SessionTreeState } from "./types";

export class SessionTree {
  private state: SessionTreeState = {
    sessions: [],
    activeSessionId: null,
    collapsedGroups: new Set<string>(),
  };

  private listeners: Array<(state: SessionTreeState) => void> = [];

  public updateFromSnapshot(snapshot: TreeSnapshot): void {
    this.state = {
      ...this.state,
      sessions: snapshot.sessions,
      activeSessionId: snapshot.activeSessionId,
      emptyState: snapshot.emptyState,
    };
    this.notifyListeners();
  }

  public toggleGroup(groupName: string): void {
    if (this.state.collapsedGroups.has(groupName)) {
      this.state.collapsedGroups.delete(groupName);
    } else {
      this.state.collapsedGroups.add(groupName);
    }
    this.notifyListeners();
  }

  public setActiveSession(sessionId: string): void {
    this.state.activeSessionId = sessionId;
    this.notifyListeners();
  }

  public getState(): SessionTreeState {
    return this.state;
  }

  public subscribe(listener: (state: SessionTreeState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
