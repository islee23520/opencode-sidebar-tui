import * as vscode from "vscode";
import { InstanceStore, InstanceId } from "./InstanceStore";

/**
 * Manages mapping between OpenCode instances and VS Code workspaces.
 * Persists mappings to workspaceState for durability across sessions.
 */
export class WorkspaceAffinityService {
  private readonly context: vscode.ExtensionContext;
  private readonly instanceStore: InstanceStore;
  private readonly storageKey = "opencodeTui.instanceWorkspaceMappings";
  private mappings: Map<InstanceId, string>; // instanceId -> workspaceUri

  constructor(context: vscode.ExtensionContext, instanceStore: InstanceStore) {
    this.context = context;
    this.instanceStore = instanceStore;
    this.mappings = this.loadMappings();
  }

  /**
   * Assigns an OpenCode instance to a VS Code workspace.
   * @param instanceId - The instance identifier.
   * @param workspaceUri - The workspace URI string.
   */
  public assignInstanceToWorkspace(
    instanceId: InstanceId,
    workspaceUri: string,
  ): void {
    this.mappings.set(instanceId, workspaceUri);
    this.persistMappings();
  }

  /**
   * Returns all instance IDs mapped to the given workspace.
   * @param workspaceUri - The workspace URI string.
   * @returns Array of instance IDs associated with this workspace.
   */
  public getInstancesForWorkspace(workspaceUri: string): InstanceId[] {
    const instances: InstanceId[] = [];
    for (const [instanceId, uri] of this.mappings.entries()) {
      if (uri === workspaceUri) {
        instances.push(instanceId);
      }
    }
    return instances;
  }

  /**
   * Returns the workspace URI for a given instance.
   * @param instanceId - The instance identifier.
   * @returns The workspace URI string, or undefined if not mapped.
   */
  public getWorkspaceForInstance(instanceId: InstanceId): string | undefined {
    return this.mappings.get(instanceId);
  }

  /**
   * Removes the workspace mapping for an instance.
   * @param instanceId - The instance identifier to unmap.
   */
  public removeInstanceMapping(instanceId: InstanceId): void {
    this.mappings.delete(instanceId);
    this.persistMappings();
  }

  /**
   * Loads mappings from workspaceState on initialization.
   * @returns A Map of instanceId to workspaceUri.
   */
  private loadMappings(): Map<InstanceId, string> {
    const stored = this.context.workspaceState.get<Record<InstanceId, string>>(
      this.storageKey,
    );
    return stored ? new Map(Object.entries(stored)) : new Map();
  }

  /**
   * Persists current mappings to workspaceState.
   */
  private persistMappings(): void {
    const obj = Object.fromEntries(this.mappings.entries());
    this.context.workspaceState.update(this.storageKey, obj);
  }
}
