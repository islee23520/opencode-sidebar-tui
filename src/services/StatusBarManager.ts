import * as vscode from "vscode";
import { InstanceStore, InstanceRecord } from "./InstanceStore";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private instanceStore?: InstanceStore;
  private activeInstanceSubscription?: vscode.Disposable;

  /**
   * Creates a new StatusBarManager.
   * @param instanceStore - Optional InstanceStore for showing active instance status.
   *                       If not provided, shows static text.
   */
  constructor(instanceStore?: InstanceStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1,
    );
    this.statusBarItem.tooltip = "Open OpenCode TUI";
    this.statusBarItem.command = "opencodeTui.focus";
    this.instanceStore = instanceStore;

    if (this.instanceStore) {
      // Subscribe to instance changes
      this.activeInstanceSubscription = this.instanceStore.onDidSetActive(
        () => {
          this.updateStatus();
        },
      );
      // Also subscribe to general changes to update port/label info
      this.instanceStore.onDidChange(() => {
        this.updateStatus();
      });
      // Initial update
      this.updateStatus();
    } else {
      // Fallback to static text when no store is provided
      this.statusBarItem.text = "$(terminal) OpenCode";
    }
  }

  /**
   * Updates the status bar based on the active instance state.
   * Shows icon, port, and label information with appropriate colors.
   */
  private updateStatus(): void {
    if (!this.instanceStore) {
      return;
    }

    try {
      const active = this.instanceStore.getActive();
      this.updateStatusForInstance(active);
    } catch {
      // Store is empty or instance not found
      this.statusBarItem.text = "$(circle-outline) OpenCode";
      this.statusBarItem.color = new vscode.ThemeColor(
        "statusBarItem.errorForeground",
      );
    }
  }

  /**
   * Updates status bar display for a specific instance.
   * @param instance - The instance record to display.
   */
  private updateStatusForInstance(instance: InstanceRecord): void {
    const isConnected = instance.state === "connected";
    const icon = isConnected ? "$(circle-filled)" : "$(circle-outline)";
    const port = instance.runtime.port ? `:${instance.runtime.port}` : "";
    const label = instance.config.label ? ` [${instance.config.label}]` : "";

    this.statusBarItem.text = `${icon} OpenCode${port}${label}`;
    this.statusBarItem.color = isConnected
      ? undefined
      : new vscode.ThemeColor("statusBarItem.errorForeground");
  }

  public show(): void {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const showStatusBar = config.get<boolean>("showStatusBar", true);

    if (showStatusBar) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  public hide(): void {
    this.statusBarItem.hide();
  }

  public dispose(): void {
    this.activeInstanceSubscription?.dispose();
    this.statusBarItem.dispose();
  }
}
