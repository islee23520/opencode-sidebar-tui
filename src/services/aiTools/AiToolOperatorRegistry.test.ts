import { describe, expect, it } from "vitest";
import { AiToolOperatorRegistry } from "./AiToolOperatorRegistry";
import { DEFAULT_AI_TOOLS } from "../../types";
import { OpenCodeToolOperator } from "./operators/OpenCodeToolOperator";
import { ClaudeCodeToolOperator } from "./operators/ClaudeCodeToolOperator";
import { CodexToolOperator } from "./operators/CodexToolOperator";

describe("AiToolOperatorRegistry", () => {
  it("resolves aliased tools by name", () => {
    const registry = new AiToolOperatorRegistry();

    const resolved = registry.resolveTool(DEFAULT_AI_TOOLS, "claude");

    expect(resolved?.name).toBe("claude");
  });

  it("formats file references through the matching operator", () => {
    const registry = new AiToolOperatorRegistry();
    const tool = registry.resolveTool(DEFAULT_AI_TOOLS, "opencode");

    expect(tool).toBeDefined();

    const operator = registry.getForConfig(tool!);
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 12,
      }),
    ).toBe("@src/file.ts#L10-L12");
  });

  it("uses operator aliases when matching a config", () => {
    const registry = new AiToolOperatorRegistry();
    const tool = {
      name: "claude",
      label: "Claude Code",
      path: "",
      args: [],
      aliases: ["claude"],
      operator: "claude",
    };

    expect(registry.getForConfig(tool).id).toBe("claude");
    expect(registry.matchesName(tool, "claude")).toBe(true);
    expect(registry.matchesName(tool, "claude")).toBe(true);
    expect(registry.matchesName(tool, "missing")).toBe(false);
  });

  it("returns operators by id or alias", () => {
    const registry = new AiToolOperatorRegistry();

    expect(registry.getByToolName("opencode")).toBeInstanceOf(
      OpenCodeToolOperator,
    );
    expect(registry.getByToolName("claude")).toBeInstanceOf(
      ClaudeCodeToolOperator,
    );
    expect(registry.getByToolName("codex")).toBeInstanceOf(CodexToolOperator);
    expect(registry.getByToolName("missing")).toBeUndefined();
  });

  it("falls back to codex when no operator matches a config", () => {
    const registry = new AiToolOperatorRegistry();

    const tool = {
      name: "custom-tool",
      label: "Custom Tool",
      path: "",
      args: [],
      aliases: ["custom-alias"],
      operator: "custom-operator",
    };

    expect(registry.getForConfig(tool)).toBeInstanceOf(CodexToolOperator);
  });

  it("returns the first configured or default tool when no preference is provided", () => {
    const registry = new AiToolOperatorRegistry();

    expect(registry.resolveTool([], undefined)?.name).toBe("opencode");
    expect(
      registry.resolveTool(
        [
          {
            name: "custom",
            label: "Custom",
            path: "/opt/custom",
            args: ["--run"],
            aliases: ["custom-cli"],
            operator: "codex",
          },
        ],
        undefined,
      ),
    ).toMatchObject({
      name: "custom",
      path: "/opt/custom",
      args: ["--run"],
      aliases: ["custom-cli"],
      operator: "codex",
    });
  });

  it("resolves the preferred tool by name, operator, or alias", () => {
    const registry = new AiToolOperatorRegistry();
    const userTools = [
      {
        name: "custom-opencode",
        label: "Custom OpenCode",
        path: "/opt/opencode",
        args: ["-c"],
        aliases: ["open-code"],
        operator: "opencode",
      },
      {
        name: "assistant",
        label: "Assistant",
        path: "/opt/assistant",
        args: [],
        aliases: ["claude"],
        operator: "claude",
      },
    ];

    expect(registry.resolveTool(userTools, "custom-opencode")?.label).toBe(
      "Custom OpenCode",
    );
    expect(registry.resolveTool(userTools, "claude")?.name).toBe("assistant");
    expect(registry.resolveTool(userTools, "claude")?.name).toBe(
      "assistant",
    );
    expect(registry.resolveTool(userTools, "missing")).toBeUndefined();
  });
});
