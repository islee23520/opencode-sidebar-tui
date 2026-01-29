import { vi, beforeEach, afterEach } from "vitest";
import * as vscodeMock from "./vscode";
import * as nodePtyMock from "./node-pty";

export function setupMocks() {
  vi.mock("vscode", () => vscodeMock);
  vi.mock("node-pty", () => nodePtyMock);
}

export function resetMocks() {
  vi.clearAllMocks();
}

export { vscodeMock, nodePtyMock };
