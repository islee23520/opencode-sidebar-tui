# Open Sidebar TUI ガイド

[English](../en/README.md) · [한국어](../ko/README.md) · [日本語](../ja/README.md)

- [ドキュメント一覧](../README.md)
- [ルート README](../../README.md)

このガイドでは、**Open Sidebar TUI** を VS Code のサイドバー専用ターミナルとしてインストールし、日常的に使う方法を説明します。

## 概要

Open Sidebar TUI は、OpenCode を VS Code の標準ターミナルパネルではなく、**サイドバー内**に直接埋め込みます。

主なビューは 2 つあります。

1. **OpenCode Terminal**: セカンダリサイドバーで動作するメインの TUI セッション
2. **Terminal Managers**: アクティビティバーで `tmux` の session、pane、window を管理するダッシュボード

## 主な機能

- ターミナルビューが有効になると **OpenCode** を自動起動
- `xterm.js` と WebGL による完全な TUI レンダリング
- OpenCode、Claude、Codex、カスタムツールを含む複数 AI ツール対応
- `tmux` session の自動検出とワークスペース単位のフィルタリング
- 同じターミナル内で native shell へ切り替え可能
- OpenCode とプロンプトやコンテキストをやり取りする HTTP API 通信
- `@filename#L10-L20` 形式のファイル参照
- コンテキストメニュー、ドラッグ＆ドロップ、キーボードショートカット対応

## インストール

### VS Code Marketplace からインストール

1. VS Code を開きます。
2. `Cmd+Shift+X` または `Ctrl+Shift+X` で Extensions を開きます。
3. **Open Sidebar TUI** を検索します。
4. **Install** をクリックします。

### OpenVSX からインストール

VSCodium、Gitpod、Eclipse Theia などの互換 IDE では次の手順でインストールできます。

1. 拡張機能ビューを開きます。
2. **Open Sidebar TUI** を検索します。
3. **Install** をクリックします。

または [OpenVSX ページ](https://open-vsx.org/extension/islee23520/opencode-sidebar-tui) を利用できます。

### ソースからインストール

```bash
git clone https://github.com/islee23520/opencode-sidebar-tui.git
cd opencode-sidebar-tui
npm install
npm run compile
npx @vscode/vsce package
```

その後、Extensions ビューの **Install from VSIX** から生成された VSIX をインストールします。

## クイックスタート

1. アクティビティバーの OpenCode アイコンをクリックして **Terminal Managers** を開きます。
2. セカンダリサイドバーで **Open Sidebar Terminal** を開きます。
3. 自動起動を使うか、手動で OpenCode を起動します。
4. サイドバー内でそのまま OpenCode を操作します。

### よく使うショートカット

| ショートカット             | 操作                                 |
| -------------------------- | ------------------------------------ |
| `Cmd+Alt+L` / `Ctrl+Alt+L` | 現在のファイル参照を送信             |
| `Cmd+Alt+A` / `Ctrl+Alt+A` | 開いているすべてのファイル参照を送信 |
| `Cmd+Alt+T` / `Ctrl+Alt+T` | `tmux` session を参照                |
| `Cmd+V` / `Ctrl+V`         | ターミナルへ貼り付け                 |

## ファイルとコンテキストの共有

Open Sidebar TUI は、複数の方法で OpenCode にコンテキストを渡せます。

- **ファイル参照コマンド**: `@filename`、`@filename#L10`、`@filename#L10-L20`
- **コンテキストメニュー連携**: ファイル、フォルダ、エディタ選択範囲の送信
- **ドラッグ＆ドロップ**: **Shift** を押したままファイルやフォルダをターミナルへドロップ
- **自動コンテキスト共有**: ターミナルを開いたときに、開いているファイルと現在の選択範囲を自動送信

ファイル参照の書式は、どの言語ガイドでも同じです。

- `@filename`
- `@filename#L10`
- `@filename#L10-L20`

## Terminal Managers と tmux

**Terminal Managers** ビューは、サイドバー内で `tmux` ワークフローを制御するための中心的な画面です。

次の機能を提供します。

- 既存 session の自動検出
- ワークスペース単位のフィルタリング
- pane の分割、フォーカス移動、サイズ変更、入れ替え、終了
- window の移動、作成、選択、終了
- 現在のワークスペース session に戻るためのバナー
- 縦方向のスペースを確保するため、サイドバー内では `tmux` ステータスバーを非表示

### よく使う tmux 操作

- **Spawn Tmux Session for Workspace**
- **Select OpenCode Tmux Session**
- **Switch Tmux Session**
- **Split Pane Horizontal / Vertical**
- **Create Window**
- **Kill Pane / Kill Window / Kill Session**

## HTTP API 連携

Open Sidebar TUI は、OpenCode とより安定して通信するために HTTP API を使用します。

### 役割

- OpenCode の HTTP サーバーを自動検出
- リクエスト送信前に `/health` を確認
- `/tui/append-prompt` へプロンプトとファイル参照を送信
- リトライ処理とタイムアウト制御

### 動作の流れ

1. OpenCode が ephemeral port で HTTP サーバーを起動します。
2. 拡張機能がそのポートを検出します。
3. 拡張機能がプロンプトとコンテキストを HTTP 経由で送信します。
4. サイドバー WebView がターミナルの入出力をレンダリングします。

## 主要な設定

実際の VS Code 設定キーと一致させる必要があるため、主要な設定名は英語のままにしています。

### ターミナルと起動動作

| 設定                          | 説明                                         |
| ----------------------------- | -------------------------------------------- |
| `opencodeTui.autoStart`       | ビュー有効化時に OpenCode を自動起動         |
| `opencodeTui.autoStartOnOpen` | サイドバーを開いたときに OpenCode を自動起動 |
| `opencodeTui.command`         | OpenCode 起動に使うコマンド                  |
| `opencodeTui.fontSize`        | ターミナルのフォントサイズ                   |
| `opencodeTui.fontFamily`      | ターミナルのフォントファミリー               |
| `opencodeTui.autoFocusOnSend` | ファイル参照送信後にサイドバーへフォーカス   |

### HTTP API とコンテキスト共有

| 設定                            | 説明                             |
| ------------------------------- | -------------------------------- |
| `opencodeTui.enableHttpApi`     | HTTP API 通信を有効化            |
| `opencodeTui.httpTimeout`       | リクエストのタイムアウト (ms)    |
| `opencodeTui.autoShareContext`  | エディタのコンテキストを自動共有 |
| `opencodeTui.contextDebounceMs` | コンテキスト更新の debounce 遅延 |

### AI ツールと tmux 動作

| 設定                             | 説明                               |
| -------------------------------- | ---------------------------------- |
| `opencodeTui.aiTools`            | 利用可能な AI ツールの設定         |
| `opencodeTui.defaultAiTool`      | 新しい `tmux` session の既定ツール |
| `opencodeTui.enableAutoSpawn`    | OpenCode が未起動なら自動起動      |
| `opencodeTui.nativeShellDefault` | native shell 切り替え時の既定動作  |
| `opencodeTui.tmuxSessionDefault` | 新しい `tmux` session の既定動作   |

## 要件

- VS Code `1.106.0` 以上
- Node.js `20.0.0` 以上
- `opencode` コマンドで実行できる OpenCode がインストール済みであること

## さらに詳しく

完全なコマンド一覧、すべての設定表、開発ワークフロー、実装の詳細は [ルート README](../../README.md) を参照してください。
