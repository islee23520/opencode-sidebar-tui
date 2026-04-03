# PROVIDERS KNOWLEDGE BASE

## OVERVIEW

Extension-host code. Bridges VS Code webview views/actions with backend services.

## STRUCTURE

```
providers/
├── TerminalProvider.ts            # Webview lifecycle shell + orchestration
├── MessageRouter.ts              # Message dispatch + all handlers
├── SessionRuntime.ts             # Start/restart/tmux/instance management
├── TerminalDashboardProvider.ts  # tmux dashboard
├── CodeActionProvider.ts         # Code actions
└── AGENTS.md
```

## WHERE TO LOOK

| Task             | Location                     | Notes                                             |
| ---------------- | ---------------------------- | ------------------------------------------------- |
| Webview shell    | `TerminalProvider.ts`        | resolveWebviewView, getHtmlForWebview, dispose    |
| Message handling | `MessageRouter.ts`           | handleMessage dispatch + 20+ handlers             |
| Session runtime  | `SessionRuntime.ts`          | start/restart, tmux attach/switch, HTTP readiness |
| Tmux dashboard   | `TerminalDashboardProvider.ts` | Inline HTML/CSS/JS                              |
| Code actions     | `CodeActionProvider.ts`      | Focused, no issues                                |

## PROVIDER SPLIT — RESPONSIBILITY MAP

| Module             | Owns                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `TerminalProvider` | webview lifecycle, HTML generation, nonce, public API surface                      |
| `MessageRouter`    | terminal I/O, clipboard, image paste, file open/drop, VS Code terminal bridge      |
| `SessionRuntime`   | process start/restart, tmux session management, instance switching, HTTP readiness |

## CONVENTIONS

- Providers = extension host process (not browser)
- Message contracts use `src/types.ts` — no arbitrary shapes
- Provider role: routing, orchestration, state bridging only

## ANTI-PATTERNS

- No browser-only logic (DOM, rendering) here — belongs in `src/webview`
- No arbitrary message shapes — must update `src/types.ts`
- Never bypass `ExtensionLifecycle` for provider registration or command wiring
