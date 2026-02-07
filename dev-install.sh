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
print_header "Step 1: Installing Dependencies"

install_deps() {
    print_step "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
}

verify_installation() {
    print_step "Verifying installation..."
    if npm run compile 2>&1 | grep -q "error\|ERROR\|failed"; then
        return 1
    fi
    return 0
}

if [ -d "node_modules" ]; then
    if verify_installation; then
        print_success "Existing node_modules is valid, skipping installation"
    else
        print_warning "Existing node_modules appears corrupted"
        if confirm "Remove node_modules and reinstall?"; then
            print_step "Removing existing node_modules..."
            remove_node_modules || exit 1
            install_deps
        else
            print_info "Proceeding with existing node_modules (may cause issues)"
        fi
    fi
else
    install_deps
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

# Step 3: Always package and install
print_header "Step 3: Package & Install Extension"

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
print_success "Extension installed!"

# Step 4: Always launch Extension Development Host
print_header "Step 4: Launch Development Host"

print_step "Launching Extension Development Host..."
print_info "A new VSCode window will open with your extension loaded"
sleep 2
code --new-window --extensionDevelopmentPath="$PWD"
print_success "Dev Host launched!"

# Step 5: Quick summary
print_header "${ROCKET} Ready to Develop!"
echo ""
echo "Summary:"
echo "  ✓ Dependencies installed"
echo "  ✓ Extension bundled"
echo "  ✓ Extension installed from $vsix_file"
echo "  ✓ Development Host launched"
echo ""
echo "Quick commands:"
echo "  rebuild:  npm run compile"
echo "  full:     ./dev-install.sh"
echo ""
echo -e "${CYAN}Debug logs:${NC}"
echo "  In Dev Host: Ctrl+Shift+I → Console tab"
echo ""
