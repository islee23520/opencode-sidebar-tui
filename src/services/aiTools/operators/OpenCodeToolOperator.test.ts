import { describe, expect, it } from "vitest";
import { OpenCodeToolOperator } from "./OpenCodeToolOperator";
import type { AiToolConfig } from "../../../types";

describe("OpenCodeToolOperator", () => {
  const operator = new OpenCodeToolOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "opencode",
    label: "OpenCode",
    path: "",
    args: ["-c"],
    aliases: [],
    operator: "opencode",
    ...overrides,
  });

  it("matches by id, operator, and alias", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "opencode" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["open-code"],
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
    expect(operator.getLaunchCommand(createTool())).toBe("opencode -c");
    expect(
      operator.getLaunchCommand(
        createTool({
          path: "/opt/bin/opencode",
          args: ["--headless", "--json"],
        }),
      ),
    ).toBe("/opt/bin/opencode --headless --json");
  });

  it("reports HTTP API and auto-context support", () => {
    expect(operator.supportsHttpApi()).toBe(true);
    expect(operator.supportsAutoContext()).toBe(true);
  });

  it("formats file references with optional line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 8,
        selectionEnd: 8,
      }),
    ).toBe("@src/file.ts#L8");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 8,
        selectionEnd: 12,
      }),
    ).toBe("@src/file.ts#L8-L12");
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
