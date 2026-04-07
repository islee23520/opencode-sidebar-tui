import { describe, expect, it } from "vitest";
import { ClaudeCodeToolOperator } from "./ClaudeCodeToolOperator";
import type { AiToolConfig } from "../../../types";

describe("ClaudeCodeToolOperator", () => {
  const operator = new ClaudeCodeToolOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "claude",
    label: "Claude Code",
    path: "",
    args: [],
    aliases: ["claude"],
    operator: "claude",
    ...overrides,
  });

  it("matches by id, operator, and alias", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "claude" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["claude"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["different"],
        }),
      ),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("claude");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "/opt/bin/claude", args: ["--print", "hello"] }),
      ),
    ).toBe("/opt/bin/claude --print hello");
  });

  it("reports HTTP API and auto-context support as disabled", () => {
    expect(operator.supportsHttpApi()).toBe(false);
    expect(operator.supportsAutoContext()).toBe(false);
  });

  it("formats file references with optional line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 3,
        selectionEnd: 3,
      }),
    ).toBe("@src/file.ts#L3");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 3,
        selectionEnd: 9,
      }),
    ).toBe("@src/file.ts#L3-L9");
  });

  it("formats dropped files with and without @ syntax", () => {
    const files = ["src/a.ts", "src/b.ts"];

    expect(operator.formatDroppedFiles(files, { useAtSyntax: true })).toBe(
      "@src/a.ts @src/b.ts",
    );
    expect(operator.formatDroppedFiles(files, { useAtSyntax: false })).toBe(
      "src/a.ts src/b.ts",
    );
  });

  it("passes pasted image paths through unchanged", () => {
    expect(operator.formatPastedImage("/tmp/pasted.png")).toBe(
      "/tmp/pasted.png",
    );
  });
});
