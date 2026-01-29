# OpenCode Sidebar TUI - AGENTS.md

**프로젝트:** VS Code 확장 - OpenCode TUI 사이드바 통합  
**스택:** TypeScript, VS Code API, node-pty, xterm.js  
**생성:** 2026-01-29

---

## 개요

VS Code 사이드바에서 OpenCode TUI를 자동으로 렌더링하는 확장. node-pty로 PTY 프로세스를 관리하고 xterm.js로 터미널을 렌더링함.

## 구조

```
.
├── src/
│   ├── extension.ts              # 진입점
│   ├── core/
│   │   └── ExtensionLifecycle.ts # 생명주기 + 명령어 등록
│   ├── providers/
│   │   └── OpenCodeTuiProvider.ts # Webview 제공자
│   ├── terminals/
│   │   └── TerminalManager.ts    # node-pty 관리
│   ├── webview/
│   │   └── main.ts               # xterm.js 프론트엔드
│   └── types.ts                  # 공유 타입
├── dist/                         # webpack 빌드 출력
├── resources/                    # 아이콘, 에셋
└── .github/workflows/            # CI/CD (publish.yml)
```

## 코드 맵

| 심볼                  | 타입   | 위치                                 | 역할                  |
| --------------------- | ------ | ------------------------------------ | --------------------- |
| `activate`            | 함수   | `extension.ts:10`                    | 확장 활성화 진입점    |
| `ExtensionLifecycle`  | 클래스 | `core/ExtensionLifecycle.ts:8`       | 서비스 초기화 및 정리 |
| `OpenCodeTuiProvider` | 클래스 | `providers/OpenCodeTuiProvider.ts:4` | Webview 제공자 구현   |
| `TerminalManager`     | 클래스 | `terminals/TerminalManager.ts:13`    | PTY 프로세스 관리     |
| `WebviewMessage`      | 타입   | `types.ts:1`                         | Webview→Host 메시지   |
| `HostMessage`         | 타입   | `types.ts:9`                         | Host→Webview 메시지   |

## 컨벤션

### 네이밍

- **클스:** PascalCase (`OpenCodeTuiProvider`)
- **파일:** PascalCase (클스 파일), camelCase (진입점)
- **메서드:** camelCase (`resolveWebviewView`)
- **프라이빗:** `_` 접두사 (`_view`)

### 모듈

- ES Modules (`import`/`export`)
- Webpack으로 두 개의 번들 생성:
  - `extension.js` (Node 환경)
  - `webview.js` (Webview 환경)

### 에러 처리

- 비동기 작업 주변에 `try-catch` 필수
- `vscode.window.showErrorMessage`로 사용자에게 표시
- 파일 열기 실패 시 퍼지 매칭 시도 (`fuzzyMatchFile`)

## 명령어

```bash
npm run compile    # 개발 빌드
npm run watch      # 감시 모드
npm run package    # 프로덕션 빌드
npm run lint       # ESLint 검사
npm run format     # Prettier 포맷팅
```

## 아키텍처

### 데이터 흐름

```
[VS Code Host]
    ↕ (Webview API)
[OpenCodeTuiProvider] ←→ [TerminalManager] ←→ [node-pty]
    ↕ (postMessage)
[Webview (xterm.js)]
```

### 메시지 타입

- **Webview→Host:** `terminalInput`, `terminalResize`, `openFile`, `filesDropped`
- **Host→Webview:** `terminalOutput`, `terminalExited`, `focusTerminal`

## 주의사항

- `node-pty`는 네이티브 모듈 - 설치 시 컴파일 필요
- Webview는 `retainContextWhenHidden: true`로 설정됨
- 터미널 ID는 `"opencode-main"`으로 고정
- 파일 참조 형식: `@path/to/file#L10-L20`

## 설정 키

- `opencodeTui.autoStart` - 사이드바 열릴 때 자동 시작
- `opencodeTui.command` - OpenCode 실행 명령어
- `opencodeTui.fontSize` - 터미널 폰트 크기
- `opencodeTui.shellPath` - 커스텀 셸 경로

## 릴리스 노트 작성 가이드

GitHub 버전 업데이트 시 아래 형식으로 작성:

```markdown
## What's New in v{VERSION}

### ✨ New Features

- {기능 설명}

### 🐛 Bug Fixes

- {버그 수정 설명}

### 🔧 Improvements

- {개선사항}

### 📦 Dependencies

- {의존성 업데이트}
```

### 버전 기록

| 버전  | 날짜       | 주요 변경사항 |
| ----- | ---------- | ------------- |
| 0.1.7 | 2026-01-29 | 초기 릴리스   |
