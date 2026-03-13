import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";

export class ConfigMigration {
  private static readonly MIGRATION_DONE_KEY = "migrationDone";

  public static async migrate(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const logger = OutputChannelService.getInstance();

    if (context.globalState.get<boolean>(this.MIGRATION_DONE_KEY, false)) {
      return;
    }

    logger.info("Checking for configuration migration...");

    let migrated = false;

    const toolsOpencodeGlobal = config.get<any>("tools.opencode") || {};
    const toolsOpencodeWorkspace = config.get<any>("tools.opencode") || {};

    const commandInspect = config.inspect<string>("command");
    if (commandInspect) {
      if (commandInspect.globalValue !== undefined) {
        toolsOpencodeGlobal.command = commandInspect.globalValue;
        migrated = true;
      }
      if (commandInspect.workspaceValue !== undefined) {
        toolsOpencodeWorkspace.command = commandInspect.workspaceValue;
        migrated = true;
      }
    }

    const shellPathInspect = config.inspect<string>("shellPath");
    if (shellPathInspect) {
      if (shellPathInspect.globalValue !== undefined) {
        toolsOpencodeGlobal.shellPath = shellPathInspect.globalValue;
        migrated = true;
      }
      if (shellPathInspect.workspaceValue !== undefined) {
        toolsOpencodeWorkspace.shellPath = shellPathInspect.workspaceValue;
        migrated = true;
      }
    }

    const shellArgsInspect = config.inspect<string[]>("shellArgs");
    if (shellArgsInspect) {
      if (shellArgsInspect.globalValue !== undefined) {
        toolsOpencodeGlobal.shellArgs = shellArgsInspect.globalValue;
        migrated = true;
      }
      if (shellArgsInspect.workspaceValue !== undefined) {
        toolsOpencodeWorkspace.shellArgs = shellArgsInspect.workspaceValue;
        migrated = true;
      }
    }

    // Write the updated objects back (must write entire object for nested configs)
    if (
      commandInspect?.globalValue !== undefined ||
      shellPathInspect?.globalValue !== undefined ||
      shellArgsInspect?.globalValue !== undefined
    ) {
      await config.update(
        "tools.opencode",
        toolsOpencodeGlobal,
        vscode.ConfigurationTarget.Global,
      );
    }

    if (
      commandInspect?.workspaceValue !== undefined ||
      shellPathInspect?.workspaceValue !== undefined ||
      shellArgsInspect?.workspaceValue !== undefined
    ) {
      await config.update(
        "tools.opencode",
        toolsOpencodeWorkspace,
        vscode.ConfigurationTarget.Workspace,
      );
    }

    if (migrated) {
      logger.info("Configuration migrated to new multi-tool format");
      vscode.window.showInformationMessage(
        "OpenCode configuration has been migrated to the new multi-tool format.",
      );
    }

    await context.globalState.update(this.MIGRATION_DONE_KEY, true);
    logger.info("Configuration migration check completed");
  }
}
