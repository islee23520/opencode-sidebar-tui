import * as vscode from "vscode";
import { FileReferenceManager } from "./FileReferenceManager";

/**
 * Represents the current editor context including file path and selection.
 */
export interface Context {
  /** Relative path from workspace root */
  filePath: string;
  /** Selection start line (1-based, undefined if no selection) */
  selectionStart?: number;
  /** Selection end line (1-based, undefined if no selection) */
  selectionEnd?: number;
}

/**
 * Service for detecting and formatting editor context for sharing with OpenCode.
 * Provides functionality to get the current editor context and format it as
 * file references (@file, @file#L10, @file#L10-L20).
 */
export class ContextSharingService {
  constructor(private fileRefManager?: FileReferenceManager) {}

  /**
   * Gets the current editor context including file path and selection information.
   * Returns null if no editor is active or if the active editor has no valid document.
   *
   * @returns Context object with file path and optional selection lines, or null
   */
  public getCurrentContext(): Context | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const relativePath = vscode.workspace.asRelativePath(
      editor.document.uri,
      false,
    );

    const selection = editor.selection;
    if (selection.isEmpty) {
      return {
        filePath: relativePath,
      };
    }

    return {
      filePath: relativePath,
      selectionStart: selection.start.line + 1,
      selectionEnd: selection.end.line + 1,
    };
  }

  /**
   * Formats a file URI as a file reference string (@path/to/file).
   *
   * @param uri - The file URI to format
   * @returns Formatted file reference string
   */
  public formatFileRef(uri: vscode.Uri): string {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return `@${relativePath}`;
  }

  /**
   * Formats the current editor context as a file reference string.
   * Includes line numbers if there's an active selection.
   * Format: @path/to/file or @path/to/file#L10 or @path/to/file#L10-L20
   *
   * @param editor - The text editor to format
   * @returns Formatted file reference string with optional line numbers
   */
  public formatFileRefWithLineNumbers(editor: vscode.TextEditor): string {
    const relativePath = vscode.workspace.asRelativePath(
      editor.document.uri,
      false,
    );
    let reference = `@${relativePath}`;

    const selection = editor.selection;
    if (!selection.isEmpty) {
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      if (startLine === endLine) {
        reference += `#L${startLine}`;
      } else {
        reference += `#L${startLine}-L${endLine}`;
      }
    }

    return reference;
  }

  /**
   * Formats a Context object as a file reference string.
   * Format: @path/to/file or @path/to/file#L10 or @path/to/file#L10-L20
   *
   * @param context - The context object to format
   * @returns Formatted file reference string
   */
  public formatContext(context: Context): string {
    let reference = `@${context.filePath}`;

    if (context.selectionStart !== undefined) {
      if (context.selectionStart === context.selectionEnd) {
        reference += `#L${context.selectionStart}`;
      } else {
        reference += `#L${context.selectionStart}-L${context.selectionEnd}`;
      }
    }

    return reference;
  }

  /**
   * Adds current editor context to FileReferenceManager if available.
   * No-op if FileReferenceManager is not provided or no context exists.
   */
  addCurrentContextToManager(): void {
    if (!this.fileRefManager) return;
    const context = this.getCurrentContext();
    if (!context) return;
    this.fileRefManager.addReference({
      path: context.filePath,
      lineStart: context.selectionStart,
      lineEnd: context.selectionEnd,
    });
  }

  /**
   * Formats all managed file references from FileReferenceManager.
   * Returns empty string if FileReferenceManager is not provided.
   *
   * @returns Serialized string of all managed references
   */
  formatAllManagedRefs(): string {
    return this.fileRefManager?.serialize() ?? "";
  }
}
