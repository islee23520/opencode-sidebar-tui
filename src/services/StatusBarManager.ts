import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1,
    );
    this.statusBarItem.text = "$(terminal) OpenCode";
    this.statusBarItem.tooltip = "Open OpenCode TUI";
    this.statusBarItem.command = "opencodeTui.focus";
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
    this.statusBarItem.dispose();
  }
}
