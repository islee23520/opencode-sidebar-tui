// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionTree } from "./SessionTree";
import { SessionTreeRenderer } from "./SessionTreeRenderer";
import { TreeSnapshot } from "./types";

describe("SessionTreeRenderer", () => {
  let container: HTMLElement;
  let tree: SessionTree;
  let renderer: SessionTreeRenderer;
  let onSessionClick: any;
  let onGroupToggle: any;

  beforeEach(() => {
    container = document.createElement("div");
    onSessionClick = vi.fn();
    onGroupToggle = vi.fn();
    tree = new SessionTree();
    renderer = new SessionTreeRenderer(
      container,
      onSessionClick,
      onGroupToggle,
    );

    tree.subscribe((state) => {
      renderer.render(state);
    });
  });

  it("renders empty state for no-workspace", () => {
    tree.updateFromSnapshot({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-workspace",
    });

    expect(container.innerHTML).toContain("No workspace open.");
  });

  it("renders empty state for no-tmux", () => {
    tree.updateFromSnapshot({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-tmux",
    });

    expect(container.innerHTML).toContain("Tmux is not installed or running.");
  });

  it("renders empty state for no-sessions", () => {
    tree.updateFromSnapshot({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-sessions",
    });

    expect(container.innerHTML).toContain("No sessions found.");
  });

  it("renders grouped sessions and active highlight", () => {
    const snapshot: TreeSnapshot = {
      type: "treeSnapshot",
      sessions: [
        { id: "1", name: "session1", workspace: "repo-a", isActive: false },
        { id: "2", name: "session2", workspace: "repo-a", isActive: true },
        { id: "3", name: "session3", workspace: "repo-b", isActive: false },
      ],
      activeSessionId: "2",
    };

    tree.updateFromSnapshot(snapshot);

    const groups = container.querySelectorAll(".session-tree-group");
    expect(groups.length).toBe(2);

    const repoAGroup = groups[0];
    expect(repoAGroup.textContent).toContain("repo-a");
    expect(repoAGroup.textContent).toContain("session1");
    expect(repoAGroup.textContent).toContain("session2");

    const activeItem = container.querySelector(".session-tree-item.active");
    expect(activeItem).not.toBeNull();
    expect(activeItem?.textContent).toBe("session2");
  });

  it("handles group toggle", () => {
    const snapshot: TreeSnapshot = {
      type: "treeSnapshot",
      sessions: [
        { id: "1", name: "session1", workspace: "repo-a", isActive: false },
      ],
      activeSessionId: null,
    };

    tree.updateFromSnapshot(snapshot);

    const header = container.querySelector(
      ".session-tree-group-header",
    ) as HTMLElement;
    header.click();

    expect(onGroupToggle).toHaveBeenCalledWith("repo-a");
  });

  it("handles session click", () => {
    const snapshot: TreeSnapshot = {
      type: "treeSnapshot",
      sessions: [
        { id: "1", name: "session1", workspace: "repo-a", isActive: false },
      ],
      activeSessionId: null,
    };

    tree.updateFromSnapshot(snapshot);

    const item = container.querySelector(".session-tree-item") as HTMLElement;
    item.click();

    expect(onSessionClick).toHaveBeenCalledWith("1");
  });
});
