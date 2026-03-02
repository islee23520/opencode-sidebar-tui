import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface FileReference {
  id: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  isDirectory?: boolean;
  timestamp: number;
}

export class FileReferenceManager {
  private references: Map<string, FileReference> = new Map();
  private _onDidAddReference = new vscode.EventEmitter<FileReference>();
  private _onDidRemoveReference = new vscode.EventEmitter<string>();
  private _onDidClearReferences = new vscode.EventEmitter<void>();

  public readonly onDidAddReference = this._onDidAddReference.event;
  public readonly onDidRemoveReference = this._onDidRemoveReference.event;
  public readonly onDidClearReferences = this._onDidClearReferences.event;

  /**
   * Add a file reference
   * @param ref Partial reference (id will be generated if not provided)
   * @returns Complete FileReference with generated ID
   */
  addReference(
    ref: Omit<FileReference, "id" | "timestamp"> & { id?: string },
  ): FileReference {
    const id = ref.id || this.generateId();
    const timestamp = Date.now();

    const fileReference: FileReference = {
      id,
      path: ref.path,
      lineStart: ref.lineStart,
      lineEnd: ref.lineEnd,
      isDirectory: ref.isDirectory,
      timestamp,
    };

    this.references.set(id, fileReference);
    this._onDidAddReference.fire(fileReference);

    return fileReference;
  }

  /**
   * Remove a file reference by ID
   * @param id Reference ID to remove
   */
  removeReference(id: string): void {
    if (this.references.has(id)) {
      this.references.delete(id);
      this._onDidRemoveReference.fire(id);
    }
  }

  /**
   * Get all file references
   * @returns Array of all references, sorted by timestamp
   */
  getReferences(): FileReference[] {
    return Array.from(this.references.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  /**
   * Clear all file references
   */
  clearReferences(): void {
    this.references.clear();
    this._onDidClearReferences.fire();
  }

  /**
   * Serialize references to @path#L format
   * @returns Formatted string with one reference per line
   *
   * Format:
   * - File without lines: @path/to/file.ts
   * - File with single line: @path/to/file.ts#L10
   * - File with line range: @path/to/file.ts#L10-20
   * - Directory: @path/to/dir/
   */
  serialize(): string {
    const refs = this.getReferences();

    return refs
      .map((ref) => {
        let result = `@${ref.path}`;

        if (ref.isDirectory) {
          // Ensure directory ends with /
          if (!result.endsWith("/")) {
            result += "/";
          }
        } else if (ref.lineStart !== undefined) {
          result += `#L${ref.lineStart}`;
          if (ref.lineEnd !== undefined && ref.lineEnd !== ref.lineStart) {
            result += `-${ref.lineEnd}`;
          }
        }

        return result;
      })
      .join("\n");
  }

  /**
   * Expand a directory path to list of files using glob pattern
   * @param dirPath Directory path to expand
   * @returns Array of file paths within the directory
   */
  async expandDirectory(dirPath: string): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("No workspace folder open");
    }

    const absolutePath = path.isAbsolute(dirPath)
      ? dirPath
      : path.join(workspaceFolder.uri.fsPath, dirPath);

    // Check if directory exists
    if (
      !fs.existsSync(absolutePath) ||
      !fs.statSync(absolutePath).isDirectory()
    ) {
      return [];
    }

    const files: string[] = [];

    // Recursive directory traversal
    const traverseDirectory = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(
          workspaceFolder.uri.fsPath,
          fullPath,
        );

        // Skip node_modules, .git, and other common ignore patterns
        if (this.shouldIgnorePath(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          traverseDirectory(fullPath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    };

    try {
      traverseDirectory(absolutePath);
    } catch (error) {
      console.error("Error expanding directory:", error);
      return [];
    }

    return files.sort();
  }

  /**
   * Get files changed in git diff
   * @param branch Optional branch to compare against (default: HEAD)
   * @returns Array of changed file paths
   */
  async getGitDiffFiles(branch?: string): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("No workspace folder open");
    }

    const cwd = workspaceFolder.uri.fsPath;

    try {
      // Check if it's a git repository
      await execAsync("git rev-parse --git-dir", { cwd });

      // Get unstaged changes
      const { stdout: unstaged } = await execAsync("git diff --name-only", {
        cwd,
      });

      // Get staged changes
      const { stdout: staged } = await execAsync(
        "git diff --cached --name-only",
        { cwd },
      );

      // Get untracked files
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        { cwd },
      );

      // Optionally compare against a branch
      let branchDiff = "";
      if (branch) {
        try {
          const { stdout } = await execAsync(`git diff --name-only ${branch}`, {
            cwd,
          });
          branchDiff = stdout;
        } catch {
          // Branch might not exist, ignore
        }
      }

      // Combine all changes and remove duplicates
      const allChanges = [
        ...unstaged.trim().split("\n"),
        ...staged.trim().split("\n"),
        ...untracked.trim().split("\n"),
        ...branchDiff.trim().split("\n"),
      ].filter(Boolean);

      return Array.from(new Set(allChanges)).sort();
    } catch (error) {
      // Not a git repository or git not available
      console.error("Error getting git diff files:", error);
      return [];
    }
  }

  /**
   * Dispose event emitters
   */
  dispose(): void {
    this._onDidAddReference.dispose();
    this._onDidRemoveReference.dispose();
    this._onDidClearReferences.dispose();
  }

  /**
   * Generate a unique ID for a reference
   * @returns Unique identifier string
   */
  private generateId(): string {
    return `ref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Check if a path should be ignored during directory expansion
   * @param relativePath Relative path to check
   * @returns True if path should be ignored
   */
  private shouldIgnorePath(relativePath: string): boolean {
    const ignorePatterns = [
      "node_modules",
      ".git",
      "dist",
      "build",
      "out",
      ".vscode",
      ".idea",
      "coverage",
      ".next",
      ".nuxt",
      "__pycache__",
      ".pytest_cache",
      "vendor",
      "target",
    ];

    const pathParts = relativePath.split(path.sep);
    return ignorePatterns.some((pattern) => pathParts.includes(pattern));
  }
}
