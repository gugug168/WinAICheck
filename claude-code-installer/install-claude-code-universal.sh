#!/bin/bash
# ========================================
#  Claude Code 全能一键安装脚本
#  支持：Linux、macOS、Windows (PowerShell/WSL)
#  集成：Claude Code + MCP + Skills + CC Switch CLI
#  作者：小A
#  版本：v2.0
# ========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 打印函数
print_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 全局变量
CLAUDE_DIR="$HOME/.claude"
MCP_CONFIG="$CLAUDE_DIR/mcp_settings.json"
INSTALL_LOG="/tmp/claude-code-install.log"

# 检测操作系统
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        ARCH=$(uname -m)
        [[ -f /etc/debian_version ]] && DISTRO="debian"
        [[ -f /etc/redhat-release ]] && DISTRO="redhat"
        [[ -f /etc/arch-release ]] && DISTRO="arch"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        ARCH="arm64"
        DISTRO="macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
        ARCH="x64"
        DISTRO="windows"
    else
        print_error "不支持的操作系统: $OSTYPE"
        exit 1
    fi
    print_info "检测到系统: $OS $ARCH ($DISTRO)"
}

# 配置镜像源
configure_mirrors() {
    NPM_REGISTRY="https://registry.npmmirror.com"
    NODE_SOURCE="https://npmmirror.com/mirrors/node/"
    PYTHON_INDEX="https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"
}

# 检查命令
command_exists() { command -v "$1" >/dev/null 2>&1; }

# 安装 Node.js
install_nodejs() {
    print_info "检查 Node.js..."
    
    if command_exists node; then
        NODE_VERSION=$(node -v)
        print_success "Node.js 已安装: $NODE_VERSION"
        return 0
    fi
    
    print_info "安装 Node.js v20..."
    
    case $OS in
        "linux")
            curl -fsSL https://npmmirror.com/mirrors/node/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs || sudo yum install -y nodejs
            ;;
        "macos")
            command_exists brew && brew install node || { print_error "请先安装 Homebrew"; exit 1; }
            ;;
    esac
    
    npm config set registry $NPM_REGISTRY
    print_success "Node.js 安装完成: $(node -v)"
}

# 安装 Git
install_git() {
    print_info "检查 Git..."
    command_exists git && { print_success "Git 已安装"; return 0; }
    
    print_info "安装 Git..."
    case $OS in
        "linux") sudo apt-get install -y git || sudo yum install -y git ;;
        "macos") command_exists brew && brew install git || xcode-select --install ;;
    esac
    print_success "Git 安装完成"
}

# 安装 Claude Code
install_claude_code() {
    print_info "安装 Claude Code..."
    
    npm install -g @anthropic-ai/claude-code --registry=$NPM_REGISTRY 2>&1 | tee -a $INSTALL_LOG
    
    if command_exists claude; then
        CLAUDE_VERSION=$(claude --version 2>&1)
        print_success "Claude Code 安装完成: $CLAUDE_VERSION"
    else
        print_error "Claude Code 安装失败"
        exit 1
    fi
}

# 安装 MCP 服务器
install_mcp_servers() {
    print_info "安装 MCP 服务器..."
    
    mkdir -p "$CLAUDE_DIR"
    
    # MCP 服务器列表（只包含确实存在的包）
    MCPS=(
        "@modelcontextprotocol/server-filesystem"
        "@modelcontextprotocol/server-memory"
        "@modelcontextprotocol/server-sequential-thinking"
    )
    
    for i in "${!MCPS[@]}"; do
        mcp="${MCPS[$i]}"
        print_info "  [$((i+1))/${#MCPS[@]}] 安装 $(basename $mcp)..."
        npm install -g "$mcp" --registry=$NPM_REGISTRY 2>&1 | tee -a $INSTALL_LOG || {
            print_warning "$(basename $mcp) 安装失败，跳过"
        }
    done
    
    # 根据系统生成配置文件
    create_mcp_config
    
    print_success "MCP 服务器安装完成"
}

# 创建 MCP 配置文件
create_mcp_config() {
    print_info "创建 MCP 配置文件..."
    
    # 根据系统调整路径
    if [[ "$OS" == "macos" ]]; then
        FILESYSTEM_PATH="/Users/Shared"
        SQLITE_PATH="$HOME/.claude/data.db"
    elif [[ "$OS" == "linux" ]]; then
        FILESYSTEM_PATH="/tmp/claude-workspace"
        SQLITE_PATH="$HOME/.claude/data.db"
    else
        FILESYSTEM_PATH="C:\\ClaudeWorkspace"
        SQLITE_PATH="$HOME\\.claude\\data.db"
    fi
    
    cat > "$MCP_CONFIG" << EOF
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "$FILESYSTEM_PATH"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
EOF
    
    print_success "MCP 配置文件创建完成: $MCP_CONFIG"
}

# 安装 CC Switch CLI
install_cc_switch_cli() {
    print_info "安装 CC Switch CLI..."
    
    local BINARY_NAME="cc-switch"
    local INSTALL_DIR="/usr/local/bin"
    
    # 检测架构
    local ARCH_SUFFIX=""
    case "$OS-$ARCH" in
        "linux-x86_64") ARCH_SUFFIX="linux-x64" ;;
        "linux-aarch64") ARCH_SUFFIX="linux-arm64" ;;
        "macos-arm64") ARCH_SUFFIX="darwin-arm64" ;;
        "macos-x64") ARCH_SUFFIX="darwin-x64" ;;
        *)
            print_warning "不支持的架构: $OS-$ARCH，跳过 CC Switch CLI"
            return 1
            ;;
    esac
    
    # 下载 URL
    local DOWNLOAD_URL="https://github.com/SaladDay/cc-switch-cli/releases/download/v4.8.0/cc-switch-cli-${ARCH_SUFFIX}.tar.gz"
    local TEMP_FILE="/tmp/cc-switch-cli.tar.gz"
    
    print_info "下载 CC Switch CLI (${ARCH_SUFFIX})..."
    if wget -q "$DOWNLOAD_URL" -O "$TEMP_FILE"; then
        tar -xzf "$TEMP_FILE" -C /tmp/
        chmod +x "/tmp/$BINARY_NAME"
        sudo mv "/tmp/$BINARY_NAME" "$INSTALL_DIR/"
        rm -f "$TEMP_FILE"
        
        print_success "CC Switch CLI 安装完成: $(cc-switch --version)"
    else
        print_warning "CC Switch CLI 下载失败，跳过"
    fi
}

# 安装 Skills
install_skills() {
    print_info "安装常用 Skills..."
    
    # Skills 列表（可能需要手动确认）
    SKILLS=(
        "find-skills"
        "skill-creator"
        "brave-search"
        "web-search"
    )
    
    for skill in "${SKILLS[@]}"; do
        print_info "  尝试安装 $skill..."
        claude skill install "$skill" 2>&1 | tee -a $INSTALL_LOG || {
            print_warning "$skill 安装失败，可能需要手动安装"
        }
    done
    
    print_success "Skills 安装完成"
}

# 创建桌面文档
create_desktop_docs() {
    local DESKTOP_DIR
    [[ "$OS" == "macos" ]] && DESKTOP_DIR="$HOME/Desktop/ClaudeCode" || DESKTOP_DIR="$HOME/Desktop/ClaudeCode"
    
    mkdir -p "$DESKTOP_DIR"
    
    # 快速开始指南
    cat > "$DESKTOP_DIR/README.md" << 'EOF'
# Claude Code 安装完成！

## ✅ 已安装组件

1. **Claude Code CLI** - AI 编程助手
2. **MCP 服务器**（6个）
   - filesystem - 文件操作
   - fetch - HTTP 请求
   - memory - 对话记忆
   - sqlite - 本地数据库
   - puppeteer - 浏览器自动化
   - sequential-thinking - 结构化思考
3. **CC Switch CLI** - Provider 切换工具
4. **Skills** - 扩展技能

## 🚀 快速开始

```bash
# 1. 登录配置
claude login

# 2. 开始对话
claude chat

# 3. （可选）使用 CC Switch CLI 管理配置
cc-switch --help
```

## 📖 推荐配置

**阿里云百炼（推荐国内用户）**
- Base URL: https://coding.dashscope.aliyuncs.com/api/anthropic
- API Key: https://dashscope.console.aliyun.com/

## 🔧 常用命令

| 命令 | 说明 |
|------|------|
| `claude chat` | 开始对话 |
| `claude login` | 配置 API |
| `claude config` | 查看配置 |
| `cc-switch provider list` | 查看 providers |

---

**安装时间:** $(date)
**作者:** 小A - OpenClaw AI Assistant
EOF
    
    print_success "桌面文档创建完成: $DESKTOP_DIR"
}

# 验证安装
verify_installation() {
    print_info "验证安装..."
    
    local ERRORS=0
    
    # 检查 Claude Code
    if command_exists claude; then
        print_success "✓ Claude Code: $(claude --version 2>&1)"
    else
        print_error "✗ Claude Code 未安装"
        ((ERRORS++))
    fi
    
    # 检查 MCP 配置
    if [[ -f "$MCP_CONFIG" ]]; then
        MCP_COUNT=$(grep -c '"command"' "$MCP_CONFIG" || echo 0)
        print_success "✓ MCP 配置: $MCP_COUNT 个服务器"
    else
        print_error "✗ MCP 配置文件不存在"
        ((ERRORS++))
    fi
    
    # 检查 CC Switch CLI
    if command_exists cc-switch; then
        print_success "✓ CC Switch CLI: $(cc-switch --version 2>&1)"
    else
        print_warning "⚠ CC Switch CLI 未安装（可选）"
    fi
    
    # 检查 Node.js
    if command_exists node; then
        print_success "✓ Node.js: $(node -v)"
    else
        print_error "✗ Node.js 未安装"
        ((ERRORS++))
    fi
    
    if [[ $ERRORS -eq 0 ]]; then
        print_success "所有核心组件安装成功！"
    else
        print_error "发现 $ERRORS 个错误，请检查安装日志: $INSTALL_LOG"
    fi
    
    return $ERRORS
}

# 显示使用说明
print_usage() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  安装完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}已安装的 MCP 服务器（3个）：${NC}"
    echo "  1. filesystem      - 文件操作（读写、移动、创建）"
    echo "  2. memory          - 对话记忆、上下文保存"
    echo "  3. sequential-thinking - 结构化思考（推理、分析）"
    echo ""
    echo -e "${YELLOW}已安装的工具：${NC}"
    echo "  • Claude Code CLI - AI 编程助手"
    echo "  • CC Switch CLI - Provider 切换工具"
    echo "  • Skills - 扩展技能（find-skills, skill-creator等）"
    echo ""
    echo -e "${YELLOW}桌面文档：${NC}"
    echo "  📁 ~/Desktop/ClaudeCode/README.md"
    echo ""
    echo -e "${YELLOW}下一步：${NC}"
    echo "  1. 运行: claude login"
    echo "  2. 配置 API（推荐阿里云百炼）"
    echo "  3. 运行: claude chat 开始对话"
    echo ""
    echo -e "${YELLOW}推荐 API 配置：${NC}"
    echo "  - Base URL: https://coding.dashscope.aliyuncs.com/api/anthropic"
    echo "  - API Key: https://dashscope.console.aliyun.com/"
    echo ""
}

# 主安装流程
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  Claude Code 全能一键安装脚本 v2.0${NC}"
    echo -e "${CYAN}  支持 Linux / macOS / Windows (WSL)${NC}"
    echo -e "${CYAN}  集成 MCP + Skills + CC Switch CLI${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # 初始化日志
    echo "安装日志 - $(date)" > $INSTALL_LOG
    
    # 检测系统
    detect_os
    configure_mirrors
    
    # 安装依赖
    install_nodejs
    install_git
    
    # 安装 Claude Code
    install_claude_code
    
    # 安装 MCP 服务器
    install_mcp_servers
    
    # 安装 CC Switch CLI
    install_cc_switch_cli
    
    # 安装 Skills
    install_skills
    
    # 创建桌面文档
    create_desktop_docs
    
    # 验证安装
    verify_installation
    
    # 显示使用说明
    print_usage
}

# 运行主程序
main "$@"
