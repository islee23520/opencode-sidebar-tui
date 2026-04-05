import { h, FunctionComponent } from "preact";

import { TmuxDashboardWindowDto } from "../types";

export interface SessionMinimapProps {
  windows: TmuxDashboardWindowDto[];
}

export const SessionMinimap: FunctionComponent<SessionMinimapProps> = ({
  windows,
}) => {
  const hasGeometry =
    windows &&
    windows.some((w) =>
      w.panes.some(
        (p) =>
          p.paneLeft !== undefined &&
          p.paneTop !== undefined &&
          p.paneWidth !== undefined &&
          p.paneHeight !== undefined,
      ),
    );

  if (!windows || windows.length === 0 || !hasGeometry) {
    return h("div", { class: "session-minimap empty" }, "No layout data");
  }

  return h(
    "div",
    { class: "session-minimap" },
    windows.map((window) => {
      let maxCols = 1;
      let maxRows = 1;

      window.panes.forEach((p) => {
        if (
          p.paneLeft !== undefined &&
          p.paneWidth !== undefined &&
          p.paneTop !== undefined &&
          p.paneHeight !== undefined
        ) {
          maxCols = Math.max(maxCols, p.paneLeft + p.paneWidth);
          maxRows = Math.max(maxRows, p.paneTop + p.paneHeight);
        }
      });

      return h(
        "div",
        {
          key: window.windowId,
          style: "display: flex; flex-direction: column; align-items: center;",
        },
        h(
          "div",
          { class: `minimap-window${window.isActive ? " active" : ""}` },
          window.panes.map((p, index) => {
            if (
              p.paneLeft === undefined ||
              p.paneTop === undefined ||
              p.paneWidth === undefined ||
              p.paneHeight === undefined
            ) {
              return null;
            }

            const left = (p.paneLeft / maxCols) * 100;
            const top = (p.paneTop / maxRows) * 100;
            const width = (p.paneWidth / maxCols) * 100;
            const height = (p.paneHeight / maxRows) * 100;

            return h("div", {
              key: index,
              class: `minimap-pane${p.isActive ? " active" : ""}`,
              style: `left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;`,
            });
          }),
        ),
        h("span", { class: "minimap-window-name" }, window.name),
      );
    }),
  );
};
