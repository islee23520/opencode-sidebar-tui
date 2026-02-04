#!/bin/bash
# Interactive Development Setup Script
# Easily install and test local extension

set -e
set -o pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Emoji indicators
SUCCESS="✅"
ERROR="❌"
INFO="ℹ️"
WARNING="⚠️"
ROCKET="🚀"

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}➜${NC} $1"
}

print_success() {
    echo -e "${GREEN}${SUCCESS} $1${NC}"
}

print_error() {
    echo -e "${RED}${ERROR} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}${WARNING} $1${NC}"
}

print_info() {
    echo -e "${INFO} $1"
}

confirm() {
    read -p "$(echo -e ${CYAN}"$1 [y/N]: "${NC})" response
    [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]
}

# Robust node_modules removal with lock detection
remove_node_modules() {
    print_step "Removing node_modules..."
    
    # First attempt: standard removal
    if rm -rf node_modules package-lock.json 2>/dev/null; then
        return 0
    fi
    
    # If failed, check for locked files
    print_info "Checking for locked files..."
    local locked_files=$(lsof +D node_modules 2>/dev/null | tail -n +2)
    
    if [ -n "$locked_files" ]; then
        print_error "Found processes holding files in node_modules:"
        echo "$locked_files" | awk '{print "  PID " $2 ": " $1}' | head -10
        echo ""
        
        if confirm "Kill these processes and retry?"; then
            # Extract PIDs and kill them
            local pids=$(echo "$locked_files" | awk '{print $2}' | sort -u)
            for pid in $pids; do
                print_step "Killing PID $pid..."
                kill -9 "$pid" 2>/dev/null || true
            done
            sleep 1
            
            # Retry removal
            if rm -rf node_modules package-lock.json 2>/dev/null; then
                print_success "Successfully removed after killing processes"
                return 0
            fi
        fi
    fi
    
    # Last resort: force removal with sudo
    print_warning "Standard removal failed. Trying force removal..."
    if sudo rm -rf node_modules package-lock.json 2>/dev/null; then
        print_success "Removed with elevated privileges"
        return 0
    fi
    
    print_error "Failed to remove node_modules. Manual intervention required."
    return 1
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    print_error "This script must be run from the project root directory"
    exit 1
fi

print_header "OpenCode Sidebar TUI - Development Setup"

echo ""
echo "This script will help you:"
echo "  1. Install dependencies"
echo "  2. Bundle the extension"
echo "  3. Install in VSCode"
echo "  4. Launch for testing"
echo ""

# Step 1: Install dependencies
print_header "Step 1: Dependencies"

if [ ! -d "node_modules" ]; then
    print_step "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_info "Dependencies already installed"
    if confirm "Reinstall dependencies?"; then
        print_step "Reinstalling..."
        remove_node_modules || exit 1
        npm install
        print_success "Dependencies reinstalled"
    fi
fi

# Step 2: Bundle
print_header "Step 2: Bundle Extension"

print_step "Bundling with webpack..."
npm run compile 2>&1 | tail -20

if [ -d "dist" ]; then
    print_success "Extension bundled successfully"
else
    print_error "Bundling failed!"
    exit 1
fi

# Step 3: Install/Uninstall options
print_header "Step 3: Installation Options"

echo ""
echo "Choose installation method:"
echo "  1) Install in current VSCode (code --install-extension)"
echo "  2) Launch Extension Development Host (F5 debug mode)"
echo "  3) Both: Install + Launch Dev Host"
echo "  4) Uninstall existing extension first"
echo "  5) Publish to VS Code Marketplace"
echo "  6) Skip installation (already installed)"
echo ""

read -p "$(echo -e ${CYAN}"Select option [1-6]: "${NC})" choice

case $choice in
    1)
        print_step "Packaging extension..."
        npx @vscode/vsce package
        # Check for .vsix files using shell glob to avoid ls errors
        shopt -s nullglob
        vsix_files=(*.vsix)
        shopt -u nullglob
        if [ ${#vsix_files[@]} -eq 0 ]; then
            print_error "No .vsix file found after packaging"
            exit 1
        fi
        vsix_file=$(ls -t *.vsix | head -n 1)
        print_step "Installing extension from $vsix_file..."
        code --install-extension "$vsix_file"
        print_success "Extension installed! Reload VSCode window."
        ;;
    2)
        print_step "Launching Extension Development Host..."
        print_info "A new VSCode window will open with your extension loaded"
        sleep 2
        code --new-window --extensionDevelopmentPath="$PWD"
        ;;
    3)
        print_step "Packaging extension..."
        npx @vscode/vsce package
        # Check for .vsix files using shell glob to avoid ls errors
        shopt -s nullglob
        vsix_files=(*.vsix)
        shopt -u nullglob
        if [ ${#vsix_files[@]} -eq 0 ]; then
            print_error "No .vsix file found after packaging"
            exit 1
        fi
        vsix_file=$(ls -t *.vsix | head -n 1)
        print_step "Installing extension from $vsix_file..."
        code --install-extension "$vsix_file"
        print_step "Launching Extension Development Host..."
        sleep 2
        code --new-window --extensionDevelopmentPath="$PWD"
        ;;
    4)
        print_step "Uninstalling ilseoblee.opencode-sidebar-tui..."
        code --uninstall-extension ilseoblee.opencode-sidebar-tui
        print_success "Uninstalled. Run script again to install new version."
        exit 0
        ;;
    5)
        print_header "Step 4: Publish to VS Code Marketplace"
        echo ""
        print_warning "Publishing requires a Personal Access Token (PAT)"
        echo ""
        echo "If you haven't set up publishing yet, see PUBLISHING.md for:"
        echo "  1. Creating publisher account"
        echo "  2. Generating PAT token"
        echo "  3. Authentication steps"
        echo ""
        
        if ! confirm "Do you have a PAT token ready?"; then
            print_info "Please follow PUBLISHING.md to set up your PAT token first."
            print_info "Then run this script again and select option 5."
            exit 0
        fi
        
        print_step "Checking vsce login status..."
        if npx @vscode/vsce ls-publishers 2>&1 | grep -q "ilseoblee"; then
            print_success "Already logged in as ilseoblee"
        else
            print_warning "Not logged in. Please authenticate..."
            echo ""
            print_step "Running: npx @vscode/vsce login ilseoblee"
            echo ""
            npx @vscode/vsce login ilseoblee
            echo ""
        fi
        
        echo ""
        print_step "Choose publish type:"
        echo "  1) Publish current version (0.1.0)"
        echo "  2) Publish patch version (0.1.0 -> 0.1.1)"
        echo "  3) Publish minor version (0.1.0 -> 0.2.0)"
        echo "  4) Publish major version (0.1.0 -> 1.0.0)"
        echo ""
        read -p "$(echo -e ${CYAN}"Select publish type [1-4]: "${NC})" pub_choice
        
        case $pub_choice in
            1)
                print_step "Publishing version 0.1.0..."
                npx @vscode/vsce publish
                ;;
            2)
                print_step "Publishing patch version..."
                npx @vscode/vsce publish patch
                ;;
            3)
                print_step "Publishing minor version..."
                npx @vscode/vsce publish minor
                ;;
            4)
                print_step "Publishing major version..."
                npx @vscode/vsce publish major
                ;;
            *)
                print_error "Invalid option. Aborting publish."
                exit 1
                ;;
        esac
        
        echo ""
        print_success "Extension published successfully!"
        print_info "Visit: https://marketplace.visualstudio.com/items?itemName=ilseoblee.opencode-sidebar-tui"
        exit 0
        ;;
    6)
        print_info "Skipping installation"
        ;;
    *)
        print_error "Invalid option. Skipping installation."
        ;;
esac

# Step 4: Testing instructions
print_header "Step 4: Testing"

echo ""
print_success "Setup complete!"
echo ""
echo -e "${CYAN}How to test:${NC}"
echo ""
echo "1. Open Extension Development Host window"
echo "2. Click the OpenCode icon in the sidebar"
echo "3. OpenCode TUI should auto-start"
echo "4. Test terminal interaction and commands"
echo "5. Verify restart and clear buttons work"
echo ""
echo -e "${CYAN}Debug logs:${NC}"
echo "  In Dev Host: Ctrl+Shift+I → Console tab"
echo ""

if confirm "Open Extension Development Host now?"; then
    print_step "Opening VSCode Extension Development Host..."
    code --new-window --extensionDevelopmentPath="$PWD"
    print_success "Dev Host launched!"
fi

print_header "${ROCKET} Ready to Develop!"
echo ""
echo "Quick commands:"
echo "  rebuild:  npm run compile"
echo "  install:  ./dev-install.sh (Option 1)"
echo "  test:     code --new-window --extensionDevelopmentPath=\"\$PWD\""
echo ""
