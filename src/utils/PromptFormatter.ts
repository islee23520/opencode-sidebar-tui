import * as vscode from "vscode";

export function formatDiagnostic(
  diagnostic: vscode.Diagnostic,
  uri: vscode.Uri,
  maxLength: number = 500,
): string {
  const relativePath = vscode.workspace.asRelativePath(uri);
  const startLine = diagnostic.range.start.line + 1;
  const endLine = diagnostic.range.end.line + 1;

  const location =
    startLine === endLine
      ? `@${relativePath}#L${startLine}`
      : `@${relativePath}#L${startLine}-L${endLine}`;

  const severityLabel = getSeverityLabel(diagnostic.severity);

  let codeStr = "";
  if (diagnostic.code) {
    if (
      typeof diagnostic.code === "string" ||
      typeof diagnostic.code === "number"
    ) {
      codeStr = `[${diagnostic.code}] `;
    } else if (
      typeof diagnostic.code === "object" &&
      "value" in diagnostic.code
    ) {
      codeStr = `[${diagnostic.code.value}] `;
    }
  }

  let message = diagnostic.message;
  if (message.length > maxLength) {
    message = message.substring(0, maxLength) + "...";
  }

  return `${location}\n${severityLabel}: ${codeStr}${message}`;
}

export function formatDiagnostics(
  diagnostics: vscode.Diagnostic[],
  uri: vscode.Uri,
  maxLength: number = 500,
): string {
  return diagnostics
    .map((d) => formatDiagnostic(d, uri, maxLength))
    .join("\n\n");
}

function getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "Error";
    case vscode.DiagnosticSeverity.Warning:
      return "Warning";
    case vscode.DiagnosticSeverity.Information:
      return "Info";
    case vscode.DiagnosticSeverity.Hint:
      return "Hint";
    default:
      return "Diagnostic";
  }
}
