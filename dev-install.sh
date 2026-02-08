#!/bin/bash
# Dev Install: Build, Package, Reinstall

set -e
set -o pipefail

echo "📦 Building extension..."
npm run compile

echo ""
echo "📋 Packaging extension..."
npx @vscode/vsce package

# Find the latest .vsix file
vsix_file=$(ls -t *.vsix 2>/dev/null | head -n 1)

if [ -z "$vsix_file" ]; then
    echo "Error: No .vsix file found after packaging"
    exit 1
fi

echo ""
echo "🚀 Installing $vsix_file..."
code --install-extension "$vsix_file" --force

echo ""
echo "Done! Run 'Developer: Reload Window' in VS Code: to apply changes."
