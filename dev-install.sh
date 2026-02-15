#!/bin/bash
# Dev Install: Build, Package, Reinstall

set -e
set -o pipefail

run_command() {
    local cmd="$1"
    local is_windows_shell=0
    local exit_code=0
    local cmd_path=""
    shift

    case "$(uname -s 2>/dev/null || true)" in
        MINGW*|MSYS*|CYGWIN*)
            is_windows_shell=1
            ;;
    esac

    if command -v "$cmd" >/dev/null 2>&1; then
        cmd_path="$(command -v "$cmd")"
        case "$cmd_path" in
            [A-Za-z]:/*)
                is_windows_shell=1
                ;;
        esac
    fi

    if [ "$is_windows_shell" -eq 1 ] && command -v "${cmd}.cmd" >/dev/null 2>&1; then
        "${cmd}.cmd" "$@"
        return
    fi

    if [ "$is_windows_shell" -eq 1 ] && [ -n "$cmd_path" ]; then
        if "$cmd_path" "$@"; then
            return
        fi

        exit_code=$?
        if [ "$exit_code" -ne 127 ] && [ "$exit_code" -ne 126 ]; then
            exit "$exit_code"
        fi
    fi

    if command -v "$cmd" >/dev/null 2>&1; then
        if [ -n "$cmd_path" ]; then
            if "$cmd_path" "$@"; then
                return
            fi
        elif "$cmd" "$@"; then
            return
        fi

        exit_code=$?
        if [ "$exit_code" -ne 127 ]; then
            exit "$exit_code"
        fi
    fi

    if command -v "${cmd}.cmd" >/dev/null 2>&1; then
        "${cmd}.cmd" "$@"
        return
    fi

    echo "Error: '$cmd' command not found"
    exit 1
}

echo "📦 Building extension..."
run_command npm run compile

echo ""
echo "📋 Packaging extension..."
run_command npx @vscode/vsce package

# Find the latest .vsix file
vsix_file=$(ls -t *.vsix 2>/dev/null | head -n 1)

if [ -z "$vsix_file" ]; then
    echo "Error: No .vsix file found after packaging"
    exit 1
fi

echo ""
echo "🚀 Installing $vsix_file..."
run_command code --install-extension "$vsix_file" --force

echo ""
echo "Done! Run 'Developer: Reload Window' in VS Code: to apply changes."
