import * as vscode from "vscode";
import { FileReference } from "./FileReferenceManager";

export interface ReferenceGroup {
  id: string;
  name: string;
  refs: FileReference[];
  isPreset?: boolean;
  createdAt: number;
}

const STORAGE_KEY = "opencodeTui.referenceGroups";
const PRESET_CHANGED_FILES = "preset_changed_files";
const PRESET_OPEN_FILES = "preset_open_files";

export class ReferenceGroupsStore {
  private groups: Map<string, ReferenceGroup> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadFromStorage();
    this.initializePresets();
  }

  /**
   * Create a new reference group
   * @param name Group name
   * @returns Created ReferenceGroup
   */
  createGroup(name: string): ReferenceGroup {
    const id = this.generateId();
    const group: ReferenceGroup = {
      id,
      name,
      refs: [],
      isPreset: false,
      createdAt: Date.now(),
    };

    this.groups.set(id, group);
    this.persist();

    return group;
  }

  /**
   * Delete a reference group by ID
   * @param id Group ID to delete
   */
  deleteGroup(id: string): void {
    const group = this.groups.get(id);

    // Prevent deletion of preset groups
    if (group?.isPreset) {
      throw new Error("Cannot delete preset groups");
    }

    if (this.groups.has(id)) {
      this.groups.delete(id);
      this.persist();
    }
  }

  /**
   * Add a file reference to a group
   * @param groupId Group ID
   * @param ref File reference to add
   */
  addToGroup(groupId: string, ref: FileReference): void {
    const group = this.groups.get(groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Check if reference already exists (by path)
    const existingIndex = group.refs.findIndex((r) => r.path === ref.path);

    if (existingIndex >= 0) {
      // Update existing reference
      group.refs[existingIndex] = ref;
    } else {
      // Add new reference
      group.refs.push(ref);
    }

    this.persist();
  }

  /**
   * Remove a file reference from a group
   * @param groupId Group ID
   * @param refId Reference ID to remove
   */
  removeFromGroup(groupId: string, refId: string): void {
    const group = this.groups.get(groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    group.refs = group.refs.filter((ref) => ref.id !== refId);
    this.persist();
  }

  /**
   * Get a reference group by ID
   * @param id Group ID
   * @returns ReferenceGroup or undefined if not found
   */
  getGroup(id: string): ReferenceGroup | undefined {
    return this.groups.get(id);
  }

  /**
   * Get all reference groups
   * @returns Array of all reference groups, sorted by creation time
   */
  getAllGroups(): ReferenceGroup[] {
    return Array.from(this.groups.values()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  }

  /**
   * Update the "Changed Files" preset group
   * @param files Array of changed file paths
   */
  updateChangedFiles(files: string[]): void {
    const group = this.groups.get(PRESET_CHANGED_FILES);

    if (!group) {
      return;
    }

    // Convert file paths to FileReference objects
    group.refs = files.map((filePath) => ({
      id: this.generateId(),
      path: filePath,
      timestamp: Date.now(),
    }));

    this.persist();
  }

  /**
   * Update the "Open Files" preset group
   * @param files Array of open file paths
   */
  updateOpenFiles(files: string[]): void {
    const group = this.groups.get(PRESET_OPEN_FILES);

    if (!group) {
      return;
    }

    // Convert file paths to FileReference objects
    group.refs = files.map((filePath) => ({
      id: this.generateId(),
      path: filePath,
      timestamp: Date.now(),
    }));

    this.persist();
  }

  /**
   * Initialize preset groups if they don't exist
   */
  private initializePresets(): void {
    if (!this.groups.has(PRESET_CHANGED_FILES)) {
      this.groups.set(PRESET_CHANGED_FILES, {
        id: PRESET_CHANGED_FILES,
        name: "Changed Files",
        refs: [],
        isPreset: true,
        createdAt: Date.now(),
      });
    }

    if (!this.groups.has(PRESET_OPEN_FILES)) {
      this.groups.set(PRESET_OPEN_FILES, {
        id: PRESET_OPEN_FILES,
        name: "Open Files",
        refs: [],
        isPreset: true,
        createdAt: Date.now(),
      });
    }

    this.persist();
  }

  /**
   * Load groups from workspace state
   */
  private loadFromStorage(): void {
    const stored =
      this.context.workspaceState.get<ReferenceGroup[]>(STORAGE_KEY);

    if (stored && Array.isArray(stored)) {
      this.groups = new Map(stored.map((group) => [group.id, group]));
    }
  }

  /**
   * Persist groups to workspace state
   */
  private persist(): void {
    const groupsArray = Array.from(this.groups.values());
    this.context.workspaceState.update(STORAGE_KEY, groupsArray);
  }

  /**
   * Generate a unique ID for a group or reference
   * @returns Unique identifier string
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
