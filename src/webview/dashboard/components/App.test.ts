// @vitest-environment jsdom

import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const aiToolMock = vi.hoisted(() => ({
  isVisible: vi.fn(() => false),
  show: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("../../ai-tool-selector", () => aiToolMock);

describe("dashboard App", () => {
  afterEach(() => {
    render(null, document.body);
    document.body.innerHTML = "";
    vi.clearAllMocks();
    aiToolMock.isVisible.mockReturnValue(false);
  });

  it("forwards the dashboard AI button action through onAction with session name", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [
            {
              id: "repo-a",
              name: "Repo A",
              workspace: "repo-a",
              isActive: true,
              preview: "",
            },
          ],
          workspace: "repo-a",
        },
        onAction,
      }),
      document.body,
    );

    const button = document.querySelector(
      '[data-action="showAiToolSelector"]',
    );

    expect(button).toBeInstanceOf(HTMLButtonElement);

    button?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onAction).toHaveBeenCalledWith({
      action: "showAiToolSelector",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });
    expect(aiToolMock.show).not.toHaveBeenCalled();
  });
});
