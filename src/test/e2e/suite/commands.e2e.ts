import * as assert from "assert";
import * as vscode from "vscode";

suite("Command registration", () => {
  test("registers core extension commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("opencodeTui.start"));
    assert.ok(commands.includes("opencodeTui.focus"));
    assert.ok(commands.includes("opencodeTui.openTerminalInEditor"));
    assert.ok(commands.includes("opencodeTui.toggleDashboard"));
  });

  test("executes focus command without throwing", async () => {
    await vscode.commands.executeCommand("opencodeTui.focus");
    assert.ok(true);
  });
});
