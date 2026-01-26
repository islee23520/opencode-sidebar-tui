# OpenCode Sidebar TUI

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/ilseoblee.opencode-sidebar-tui?logo=visual-studio-code&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=ilseoblee.opencode-sidebar-tui)
[![Open VSX](https://img.shields.io/open-vsx/v/ilseoblee/opencode-sidebar-tui?logo=open-vsx&label=Open%20VSX)](https://open-vsx.org/extension/ilseoblee/opencode-sidebar-tui)

Automatically render OpenCode TUI in VS Code sidebar with full terminal support.

## Features

- **Auto-launch OpenCode**: Opens OpenCode automatically when the sidebar is activated
- **Full TUI Support**: Complete terminal emulation with xterm.js and WebGL rendering
- **File References with Line Numbers**: Send file references with `@filename#L10-L20` syntax
- **Keyboard Shortcuts**: Quick access with Cmd+Alt+L and Cmd+Alt+A
- **Drag & Drop Support**: Hold Shift and drag files/folders to send as references
- **Context Menu Integration**: Right-click files in Explorer or text in Editor to send to OpenCode
- **Configurable**: Customize command, font, and terminal settings

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X)
3. Search for "OpenCode Sidebar TUI"
4. Click **Install**

### From OpenVSX Registry

For VSCodium, Gitpod, Eclipse Theia, and other VS Code-compatible IDEs:

1. Open your IDE's extension view
2. Search for "OpenCode Sidebar TUI"
3. Click **Install**

Or visit the [OpenVSX page](https://open-vsx.org/extension/ilseoblee/opencode-sidebar-tui).

### From Source

1. Clone the repository:

```bash
git clone https://github.com/islee23520/opencode-sidebar-tui.git
cd opencode-sidebar-tui
```

2. Install dependencies:

```bash
npm install
```

3. Build the extension:

```bash
npm run compile
```

4. Package the extension:

```bash
npx @vscode/vsce package
```

5. Install in VS Code:

- Open VS Code
- Go to Extensions (Cmd+Shift+X)
- Click "..." menu → "Install from VSIX"
- Select the generated `.vsix` file

## Usage

1. Click the OpenCode icon in the activity bar (sidebar)
2. OpenCode TUI automatically starts
3. Interact with OpenCode directly in the sidebar

## Commands

### Basic Commands

- **OpenCode TUI: Start OpenCode** - Manually start OpenCode
- **OpenCode TUI: Restart OpenCode** - Restart the OpenCode process
- **OpenCode TUI: Clear Terminal** - Clear the terminal display

### File Reference Commands

- **Send File Reference** (`Cmd+Alt+L` / `Ctrl+Alt+L`) - Send current file with line numbers
  - No selection: `@filename`
  - Single line: `@filename#L10`
  - Multiple lines: `@filename#L10-L20`
- **Send All Open Files** (`Cmd+Alt+A` / `Ctrl+Alt+A`) - Send all open file references
- **Send to OpenCode** - Send selected text or file from context menu

### Context Menu Options

- **Explorer**: Right-click any file or folder → "Send to OpenCode"
- **Editor**: Right-click selected text → "Send to OpenCode Terminal"
- **Editor**: Right-click anywhere → "Send File Reference (@file)"

### Drag & Drop

- Hold **Shift** and drag files/folders to the terminal to send as `@file` references

## Configuration

Available settings in VS Code settings (Cmd+,):

```json
{
  "opencodeTui.autoStart": true,
  "opencodeTui.command": "opencode -c",
  "opencodeTui.fontSize": 14,
  "opencodeTui.fontFamily": "monospace",
  "opencodeTui.cursorBlink": true,
  "opencodeTui.cursorStyle": "block",
  "opencodeTui.scrollback": 10000
}
```

## Requirements

- VS Code 1.106.0 or higher
- Node.js 18.0.0 or higher
- OpenCode installed and accessible via `opencode` command

## Development

### Build

```bash
npm run compile    # Development build
npm run watch      # Watch mode
npm run package    # Production build
```

### Project Structure

```
opencode-sidebar-tui/
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── core/
│   │   └── ExtensionLifecycle.ts # Lifecycle management
│   ├── providers/
│   │   └── OpenCodeTuiProvider.ts # WebView provider
│   ├── terminals/
│   │   └── TerminalManager.ts    # Terminal process manager
│   └── webview/
│       └── main.ts               # WebView entry (xterm.js)
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## Implementation Details

Based on the excellent [vscode-sidebar-terminal](https://github.com/s-hiraoku/vscode-sidebar-terminal) extension, streamlined specifically for OpenCode TUI:

- **Terminal Backend**: node-pty for PTY support
- **Terminal Frontend**: xterm.js with WebGL rendering
- **Process Management**: Automatic OpenCode lifecycle
- **WebView Communication**: Bidirectional messaging for terminal I/O

## License

MIT

## Acknowledgments

- Based on [vscode-sidebar-terminal](https://github.com/s-hiraoku/vscode-sidebar-terminal) by s-hiraoku
- Development assisted by [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode) from oh-my-opencode
- Uses [xterm.js](https://github.com/xtermjs/xterm.js) for terminal emulation
- Uses [node-pty](https://github.com/microsoft/node-pty) for PTY support
