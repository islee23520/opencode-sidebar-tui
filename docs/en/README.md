# Open Sidebar TUI Guide

[English (default)](../README.md) · [한국어](../ko/README.md) · [日本語](../ja/README.md)

- [Default English guide](../README.md)
- [Root README](../../README.md)

This guide explains how to install and use **Open Sidebar TUI** as a sidebar-only terminal experience inside VS Code.

## Overview

Open Sidebar TUI embeds **OpenCode** directly in the VS Code sidebar instead of the native terminal panel.

It provides two main sidebar views:

1. **OpenCode Terminal** in the secondary sidebar for the interactive TUI session.
2. **Terminal Managers** in the activity bar for managing `tmux` sessions, panes, and windows.

## Key Features

- Auto-launch **OpenCode** when the terminal view is activated.
- Full TUI rendering with `xterm.js` and WebGL.
- Multi-AI tool support for OpenCode, Claude, Codex, or custom tools.
- Integrated `tmux` session discovery and workspace-aware filtering.
- Native shell switching inside the same terminal surface.
- HTTP API communication with OpenCode for prompts and context sharing.
- File references with line numbers such as `@filename#L10-L20`.
- Context menu actions, drag and drop, and keyboard shortcuts.

## Installation

### Install from VS Code Marketplace

1. Open VS Code.
2. Open Extensions with `Cmd+Shift+X` or `Ctrl+Shift+X`.
3. Search for **Open Sidebar TUI**.
4. Click **Install**.

### Install from OpenVSX

For VSCodium, Gitpod, Eclipse Theia, and other compatible IDEs:

1. Open the extension view.
2. Search for **Open Sidebar TUI**.
3. Click **Install**.

You can also use the [OpenVSX page](https://open-vsx.org/extension/islee23520/opencode-sidebar-tui).

### Install from Source

```bash
git clone https://github.com/islee23520/opencode-sidebar-tui.git
cd opencode-sidebar-tui
npm install
npm run compile
npx @vscode/vsce package
```

Then install the generated VSIX from the Extensions view with **Install from VSIX**.

## Quick Start

1. Click the OpenCode icon in the activity bar to open **Terminal Managers**.
2. Open **Open Sidebar Terminal** in the secondary sidebar.
3. Let Open Sidebar TUI auto-start OpenCode, or start it manually.
4. Work with OpenCode directly inside the sidebar.

### Common Shortcuts

| Shortcut                   | Action                        |
| -------------------------- | ----------------------------- |
| `Cmd+Alt+L` / `Ctrl+Alt+L` | Send current file reference   |
| `Cmd+Alt+A` / `Ctrl+Alt+A` | Send all open file references |
| `Cmd+Alt+T` / `Ctrl+Alt+T` | Browse `tmux` sessions        |
| `Cmd+V` / `Ctrl+V`         | Paste into the terminal       |

## Working with Files and Context

Open Sidebar TUI supports several ways to share context with OpenCode:

- **File reference command**: send `@filename`, `@filename#L10`, or `@filename#L10-L20`.
- **Context menu integration**: send files, folders, or editor selections.
- **Drag and drop**: hold **Shift** and drop files or folders into the terminal.
- **Auto-context sharing**: automatically sends open files and active selections when the terminal opens.

The file-reference syntax stays the same in every language guide:

- `@filename`
- `@filename#L10`
- `@filename#L10-L20`

## Terminal Managers and tmux

The **Terminal Managers** view is the control center for `tmux` workflows inside the sidebar.

It includes:

- Automatic session discovery.
- Workspace-scoped filtering.
- Pane controls for split, focus, resize, swap, and kill.
- Window controls for next, previous, create, select, and kill.
- A quick banner to return to the active workspace session.
- Hidden `tmux` status bar in the sidebar to save vertical space.

### Common tmux Actions

- **Spawn Tmux Session for Workspace**
- **Select OpenCode Tmux Session**
- **Switch Tmux Session**
- **Split Pane Horizontal / Vertical**
- **Create Window**
- **Kill Pane / Kill Window / Kill Session**

## HTTP API Integration

Open Sidebar TUI uses an HTTP API to communicate with OpenCode more reliably.

### What it does

- Discovers the OpenCode HTTP server automatically.
- Checks `/health` before sending requests.
- Sends prompts and file references to `/tui/append-prompt`.
- Uses retry logic and timeout handling.

### How it works

1. OpenCode starts an HTTP server on an ephemeral port.
2. The extension discovers that port.
3. The extension sends prompts and context over HTTP.
4. The sidebar WebView handles terminal input and output rendering.

## Configuration Highlights

The most important settings stay in English because they must match the real VS Code setting keys.

### Terminal and Startup

| Setting                       | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `opencodeTui.autoStart`       | Start OpenCode automatically when the view is activated |
| `opencodeTui.autoStartOnOpen` | Start OpenCode when the sidebar opens                   |
| `opencodeTui.command`         | Command used to launch OpenCode                         |
| `opencodeTui.fontSize`        | Terminal font size                                      |
| `opencodeTui.fontFamily`      | Terminal font family                                    |
| `opencodeTui.autoFocusOnSend` | Focus the sidebar after sending file references         |

### HTTP API and Context Sharing

| Setting                         | Description                        |
| ------------------------------- | ---------------------------------- |
| `opencodeTui.enableHttpApi`     | Enable HTTP API communication      |
| `opencodeTui.httpTimeout`       | Request timeout in milliseconds    |
| `opencodeTui.autoShareContext`  | Share editor context automatically |
| `opencodeTui.contextDebounceMs` | Debounce delay for context updates |

### AI Tool and tmux Behavior

| Setting                          | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `opencodeTui.aiTools`            | Configure available AI tools                      |
| `opencodeTui.defaultAiTool`      | Default tool for new `tmux` sessions              |
| `opencodeTui.enableAutoSpawn`    | Auto-spawn OpenCode if it is not already running  |
| `opencodeTui.nativeShellDefault` | Default behavior when switching to a native shell |
| `opencodeTui.tmuxSessionDefault` | Default behavior for new `tmux` sessions          |

## Requirements

- VS Code `1.106.0` or higher
- Node.js `20.0.0` or higher
- OpenCode installed and available through the `opencode` command

## More Information

For the full command list, complete setting reference, development workflow, and implementation details, see the [root README](../../README.md).
