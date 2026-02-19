#!/bin/bash
# Dev Install: Build, Package, Reinstall

set -e
set -o pipefail

run_command() {
    local cmd="$1"
    local is_windows_shell=0
    local cmd_path=""
    shift

    case "$(uname -s 2>/dev/null || true)" in
        MINGW*|MSYS*|CYGWIN*)
            is_windows_shell=1
            ;;
    esac

    if [ "$is_windows_shell" -eq 1 ]; then
        cmd_path=$(where.exe "$cmd" 2>/dev/null | tr -d '\r' | grep -iE '\.cmd$' | head -n 1)
        if [ -n "$cmd_path" ]; then
            if command -v cygpath >/dev/null 2>&1; then
                cmd_path=$(cygpath -u "$cmd_path")
            fi
            "$cmd_path" "$@"
            return
        fi
    fi

    if command -v "$cmd" >/dev/null 2>&1; then
        "$cmd" "$@"
        return
    fi

    if command -v "${cmd}.exe" >/dev/null 2>&1; then
        "${cmd}.exe" "$@"
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
