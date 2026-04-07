import { describe, expect, it } from "vitest";
import { CodexToolOperator } from "./CodexToolOperator";
import type { AiToolConfig } from "../../../types";

describe("CodexToolOperator", () => {
  const operator = new CodexToolOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "codex",
    label: "Codex",
    path: "",
    args: [],
    aliases: [],
    operator: "codex",
    ...overrides,
  });

  it("matches by id or operator but not unrelated aliases", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "codex" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["codex"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["open-code"],
        }),
      ),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("codex");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "/opt/bin/codex", args: ["exec", "prompt"] }),
      ),
    ).toBe("/opt/bin/codex exec prompt");
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
        selectionStart: 5,
        selectionEnd: 5,
      }),
    ).toBe("@src/file.ts#L5");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 5,
        selectionEnd: 11,
      }),
    ).toBe("@src/file.ts#L5-L11");
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
