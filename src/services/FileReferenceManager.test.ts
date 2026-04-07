import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as fsTypes from "fs";
import type * as vscodeTypes from "../test/mocks/vscode";

type MockExecStep = {
  stdout?: string;
  stderr?: string;
  error?: Error | null;
  onCommand?: (command: string, options: { cwd: string }) => void;
};

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);
const fs = await vi.importMock<typeof import("fs")>("fs");
const childProcess =
  await vi.importMock<typeof import("child_process")>("child_process");
const exec = childProcess.exec;

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("child_process", async () => {
  const { promisify } = await import("util");

  Object.defineProperty(execMock, promisify.custom, {
    configurable: true,
    value: (command: string, options: { cwd: string }) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execMock(
          command,
          options,
          (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              reject(error);
              return;
            }

            resolve({ stdout, stderr });
          },
        );
      }),
  });

  return {
    exec: execMock,
  };
});

import { FileReferenceManager } from "./FileReferenceManager";

function createStat(isDirectory: boolean): fsTypes.Stats {
  return {
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  } as fsTypes.Stats;
}

function createDirEntry(
  name: string,
  kind: "file" | "directory",
): fsTypes.Dirent<string> {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  } as fsTypes.Dirent<string>;
}

function setWorkspaceRoot(rootPath: string | undefined): void {
  vscode.workspace.workspaceFolders = rootPath
    ? [{ uri: { fsPath: rootPath, path: rootPath } }]
    : undefined;
}

function mockExecSequence(steps: MockExecStep[]): void {
  let callIndex = 0;

  vi.mocked(exec).mockImplementation((...args) => {
    const [command, options, callback] = args;
    if (typeof callback !== "function") {
      throw new Error("Expected exec callback");
    }

    const step = steps[callIndex++] ?? {};
    step.onCommand?.(String(command), { cwd: String(options?.cwd ?? "") });

    callback(step.error ?? null, step.stdout ?? "", step.stderr ?? "");
    return {} as ReturnType<typeof exec>;
  });
}

describe("FileReferenceManager", () => {
  let manager: FileReferenceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FileReferenceManager();
    setWorkspaceRoot("/workspace");
  });

  describe("reference lifecycle", () => {
    it("adds, removes, retrieves, and clears references while emitting events", () => {
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(200)
        .mockReturnValueOnce(300);
      vi.spyOn(Math, "random").mockReturnValue(0.123456789);

      const added: string[] = [];
      const removed: string[] = [];
      let cleared = 0;

      manager.onDidAddReference((reference) => added.push(reference.id));
      manager.onDidRemoveReference((id) => removed.push(id));
      manager.onDidClearReferences(() => {
        cleared += 1;
      });

      const generated = manager.addReference({ path: "src/first.ts" });
      const explicit = manager.addReference({
        id: "ref-explicit",
        path: "src/second.ts",
        lineStart: 2,
        lineEnd: 4,
      });

      expect(generated.id).toMatch(/^ref_100_/);
      expect(generated.timestamp).toBe(200);
      expect(explicit).toMatchObject({
        id: "ref-explicit",
        path: "src/second.ts",
        lineStart: 2,
        lineEnd: 4,
        timestamp: 300,
      });
      expect(added).toEqual([generated.id, "ref-explicit"]);
      expect(manager.getReferences().map((reference) => reference.id)).toEqual([
        generated.id,
        "ref-explicit",
      ]);

      manager.removeReference(generated.id);
      manager.removeReference("missing-ref");

      expect(removed).toEqual([generated.id]);
      expect(manager.getReferences()).toEqual([explicit]);

      manager.clearReferences();

      expect(cleared).toBe(1);
      expect(manager.getReferences()).toEqual([]);
    });
  });

  describe("serialize", () => {
    it("serializes files, line references, directories, and preserves timestamp order", () => {
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(20)
        .mockReturnValueOnce(30)
        .mockReturnValueOnce(40)
        .mockReturnValueOnce(50)
        .mockReturnValueOnce(60);

      manager.addReference({ id: "plain", path: "src/plain.ts" });
      manager.addReference({
        id: "single-line",
        path: "src/single.ts",
        lineStart: 10,
      });
      manager.addReference({
        id: "line-range",
        path: "src/range.ts",
        lineStart: 5,
        lineEnd: 8,
      });
      manager.addReference({
        id: "same-start-end",
        path: "src/same.ts",
        lineStart: 7,
        lineEnd: 7,
      });
      manager.addReference({
        id: "directory",
        path: "src/components",
        isDirectory: true,
      });
      manager.addReference({
        id: "already-slashed",
        path: "docs/",
        isDirectory: true,
      });

      expect(manager.serialize()).toBe(
        [
          "@src/plain.ts",
          "@src/single.ts#L10",
          "@src/range.ts#L5-8",
          "@src/same.ts#L7",
          "@src/components/",
          "@docs/",
        ].join("\n"),
      );
    });

    it("returns an empty string when there are no references", () => {
      expect(manager.serialize()).toBe("");
    });
  });

  describe("expandDirectory", () => {
    it("throws when there is no workspace folder", async () => {
      setWorkspaceRoot(undefined);

      await expect(manager.expandDirectory("src")).rejects.toThrow(
        "No workspace folder open",
      );
    });

    it("returns an empty array when the path does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(manager.expandDirectory("missing")).resolves.toEqual([]);
      expect(fs.existsSync).toHaveBeenCalledWith("/workspace/missing");
    });

    it("returns an empty array when the path is not a directory", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue(createStat(false));

      await expect(manager.expandDirectory("README.md")).resolves.toEqual([]);
      expect(fs.statSync).toHaveBeenCalledWith("/workspace/README.md");
    });

    it("recursively expands a relative directory, ignores common paths, and sorts output", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue(createStat(true));
      Reflect.set(
        fs,
        "readdirSync",
        vi.fn(
          (
            currentPath: fsTypes.PathLike,
            options:
              | {
                  withFileTypes?: boolean;
                }
              | undefined,
          ) => {
            if (
              !options ||
              typeof options !== "object" ||
              !options.withFileTypes
            ) {
              return [];
            }

            if (currentPath === "/workspace/src") {
              return [
                createDirEntry("z-last.ts", "file"),
                createDirEntry("nested", "directory"),
                createDirEntry("node_modules", "directory"),
                createDirEntry(".git", "directory"),
                createDirEntry("dist", "directory"),
                createDirEntry("a-first.ts", "file"),
              ];
            }

            if (currentPath === "/workspace/src/nested") {
              return [
                createDirEntry("util.ts", "file"),
                createDirEntry("coverage", "directory"),
              ];
            }

            return [];
          },
        ),
      );

      await expect(manager.expandDirectory("src")).resolves.toEqual([
        "src/a-first.ts",
        "src/nested/util.ts",
        "src/z-last.ts",
      ]);
      expect(fs.readdirSync).toHaveBeenCalledWith("/workspace/src", {
        withFileTypes: true,
      });
      expect(fs.readdirSync).toHaveBeenCalledWith("/workspace/src/nested", {
        withFileTypes: true,
      });
    });

    it("expands an absolute directory path and returns workspace-relative files", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue(createStat(true));
      Reflect.set(
        fs,
        "readdirSync",
        vi.fn(
          (
            currentPath: fsTypes.PathLike,
            options:
              | {
                  withFileTypes?: boolean;
                }
              | undefined,
          ) => {
            if (
              !options ||
              typeof options !== "object" ||
              !options.withFileTypes
            ) {
              return [];
            }

            if (currentPath === "/workspace/packages") {
              return [createDirEntry("feature.ts", "file")];
            }

            return [];
          },
        ),
      );

      await expect(
        manager.expandDirectory("/workspace/packages"),
      ).resolves.toEqual(["packages/feature.ts"]);
    });

    it("returns an empty array when recursive traversal throws", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue(createStat(true));
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("permission denied");
      });

      await expect(manager.expandDirectory("src")).resolves.toEqual([]);
      expect(consoleError).toHaveBeenCalledWith(
        "Error expanding directory:",
        expect.any(Error),
      );
    });
  });

  describe("getGitDiffFiles", () => {
    it("throws when there is no workspace folder", async () => {
      setWorkspaceRoot(undefined);

      await expect(manager.getGitDiffFiles()).rejects.toThrow(
        "No workspace folder open",
      );
    });

    it("returns an empty array when the workspace is not a git repository", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      mockExecSequence([
        {
          error: new Error("fatal: not a git repository"),
        },
      ]);

      await expect(manager.getGitDiffFiles()).resolves.toEqual([]);
      expect(consoleError).toHaveBeenCalledWith(
        "Error getting git diff files:",
        expect.any(Error),
      );
    });

    it("combines unstaged, staged, and untracked files with dedupe and sorting", async () => {
      mockExecSequence([
        {
          stdout: ".git\n",
          onCommand: (command, options) => {
            expect(command).toBe("git rev-parse --git-dir");
            expect(options).toEqual({ cwd: "/workspace" });
          },
        },
        { stdout: "src/b.ts\nsrc/a.ts\n" },
        { stdout: "src/a.ts\nsrc/c.ts\n" },
        { stdout: "notes.md\nsrc/c.ts\n" },
      ]);

      await expect(manager.getGitDiffFiles()).resolves.toEqual([
        "notes.md",
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
      ]);
    });

    it("includes branch diff files when a branch comparison is provided", async () => {
      mockExecSequence([
        { stdout: ".git\n" },
        { stdout: "src/current.ts\n" },
        { stdout: "" },
        { stdout: "" },
        {
          stdout: "src/branch-only.ts\n",
          onCommand: (command) => {
            expect(command).toBe("git diff --name-only origin/main");
          },
        },
      ]);

      await expect(manager.getGitDiffFiles("origin/main")).resolves.toEqual([
        "src/branch-only.ts",
        "src/current.ts",
      ]);
    });

    it("ignores a missing branch comparison and still returns local changes", async () => {
      mockExecSequence([
        { stdout: ".git\n" },
        { stdout: "src/local.ts\n" },
        { stdout: "src/staged.ts\n" },
        { stdout: "src/untracked.ts\n" },
        {
          error: new Error("fatal: ambiguous argument 'missing-branch'"),
        },
      ]);

      await expect(manager.getGitDiffFiles("missing-branch")).resolves.toEqual([
        "src/local.ts",
        "src/staged.ts",
        "src/untracked.ts",
      ]);
    });
  });

  describe("dispose", () => {
    it("disposes event emitters so later operations do not notify existing listeners", () => {
      const added = vi.fn();
      const removed = vi.fn();
      const cleared = vi.fn();

      manager.onDidAddReference(added);
      manager.onDidRemoveReference(removed);
      manager.onDidClearReferences(cleared);

      manager.dispose();

      const reference = manager.addReference({
        id: "after-dispose",
        path: "src/file.ts",
      });
      manager.removeReference(reference.id);
      manager.clearReferences();

      expect(added).not.toHaveBeenCalled();
      expect(removed).not.toHaveBeenCalled();
      expect(cleared).not.toHaveBeenCalled();
    });
  });
});
