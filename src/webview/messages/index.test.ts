// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "./index";

const mockHandlePasteWithImageSupport = vi.hoisted(() => vi.fn());

vi.mock("../clipboard", () => ({
  handlePasteWithImageSupport: mockHandlePasteWithImageSupport,
}));

describe("createMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes requestPaste messages through image-aware paste handling", () => {
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
      onToggleTmuxCommandToolbar: vi.fn(),
      onShowTmuxPrompt: vi.fn(),
      onPlatformInfo: vi.fn(),
    });

    handler.handleEvent(
      new MessageEvent("message", { data: { type: "requestPaste" } }),
    );

    expect(mockHandlePasteWithImageSupport).toHaveBeenCalledTimes(1);
  });
});
