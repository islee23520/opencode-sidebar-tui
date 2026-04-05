import { h, FunctionComponent, Fragment } from "preact";

import { DashboardPayload } from "../types";
import { EmptyState } from "./EmptyState";
import { NativeShellCard } from "./NativeShellCard";
import { ReturnBanner } from "./ReturnBanner";
import { SessionCard } from "./SessionCard";

export interface AppProps {
  payload: DashboardPayload;
  onAction: (action: Record<string, unknown>) => void;
}

export const App: FunctionComponent<AppProps> = ({
  payload,
  onAction,
}) => {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const nativeShells = Array.isArray(payload.nativeShells)
    ? payload.nativeShells
    : [];
  const activeOther = sessions.find(
    (session) => session.isActive && session.workspace !== payload.workspace,
  );

  const handleAction = (action: Record<string, unknown>): void => {
    onAction(action);
  };

  if (sessions.length === 0 && nativeShells.length === 0) {
    return h(EmptyState, null);
  }

  return h(
    Fragment,
    null,
    activeOther
      ? h(ReturnBanner, {
          workspace: payload.workspace || "current workspace",
          onReturn: (): void => {
            const matching = sessions.find(
              (session) => session.workspace === payload.workspace,
            );
            if (matching) {
              handleAction({ action: "activate", sessionId: matching.id });
              return;
            }
            handleAction({ action: "create" });
          },
          onCreate: (): void => {
            handleAction({ action: "create" });
          },
        })
      : null,
    nativeShells.map((shell) =>
      h(NativeShellCard, {
        key: shell.id,
        shell,
        onActivate: (instanceId): void => {
          handleAction({ action: "activateNativeShell", instanceId });
        },
        onKill: (instanceId): void => {
          handleAction({ action: "killNativeShell", instanceId });
        },
      }),
    ),
    sessions.map((session) =>
      h(SessionCard, {
        key: session.id,
        session,
        windows: payload.windows?.[session.id],
        onActivate: (sessionId): void => {
          handleAction({ action: "activate", sessionId });
        },
        onShowAiToolSelector: (sessionId, sessionName): void => {
          handleAction({ action: "showAiToolSelector", sessionId, sessionName });
        },
        onKill: (sessionId): void => {
          handleAction({ action: "killSession", sessionId });
        },
      }),
    ),
  );
};
