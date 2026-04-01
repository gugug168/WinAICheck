# ========================================
#  Claude Code 全能一键安装脚本 (Windows)
#  支持：Windows 10/11 (PowerShell 5.1+)
#  集成：Claude Code + MCP + Skills + CC Switch CLI
#  作者：小A
#  版本：v2.0
# ========================================

#Requires -RunAsAdministrator

# 颜色函数
function Write-Info { param($msg) Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Success { param($msg) Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warning { param($msg) Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Error { param($msg) Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $msg }

# 全局变量
$ClaudeDir = "$env:USERPROFILE\.claude"
$McpConfig = "$ClaudeDir\mcp_settings.json"
$InstallLog = "$env:TEMP\claude-code-install.log"

# 检测系统架构
function Detect-System {
    $Script:OS = "windows"
    $Script:Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $Script:PowerShellVersion = $PSVersionTable.PSVersion.ToString()
    
    Write-Info "检测到系统: Windows $Script:Arch (PowerShell $Script:PowerShellVersion)"
}

# 检查命令
function Test-Command {
    param($command)
    $null -ne (Get-Command $command -ErrorAction SilentlyContinue)
}

# 安装 Chocolatey（如果未安装）
function Install-Chocolatey {
    if (Test-Command choco) {
        Write-Success "Chocolatey 已安装"
        return
    }
    
    Write-Info "安装 Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    
    if (Test-Command choco) {
        Write-Success "Chocolatey 安装完成"
    } else {
        Write-Error "Chocolatey 安装失败"
        exit 1
    }
}

# 安装 Node.js
function Install-NodeJS {
    Write-Info "检查 Node.js..."
    
    if (Test-Command node) {
        $nodeVersion = node -v
        Write-Success "Node.js 已安装: $nodeVersion"
        return
    }
    
    Write-Info "安装 Node.js v20..."
    choco install nodejs-lts -y --version=20.11.0
    
    # 刷新环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    
    if (Test-Command node) {
        Write-Success "Node.js 安装完成: $(node -v)"
    } else {
        Write-Error "Node.js 安装失败"
        exit 1
    }
}

# 安装 Git
function Install-Git {
    Write-Info "检查 Git..."
    
    if (Test-Command git) {
        Write-Success "Git 已安装"
        return
    }
    
    Write-Info "安装 Git..."
    choco install git -y
    
    # 刷新环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    
    Write-Success "Git 安装完成"
}

# 配置 npm 镜像
function Configure-NPM-Mirror {
    Write-Info "配置 npm 镜像..."
    npm config set registry https://registry.npmmirror.com
    Write-Success "npm 镜像配置完成"
}

# 安装 Claude Code
function Install-ClaudeCode {
    Write-Info "安装 Claude Code..."
    
    npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com 2>&1 | Tee-Object -FilePath $InstallLog
    
    if (Test-Command claude) {
        $claudeVersion = claude --version 2>&1
        Write-Success "Claude Code 安装完成: $claudeVersion"
    } else {
        Write-Error "Claude Code 安装失败"
        exit 1
    }
}

# 安装 MCP 服务器
function Install-MCPServers {
    Write-Info "安装 MCP 服务器..."
    
    # 创建 Claude 目录
    New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
    
    # MCP 服务器列表（只包含确实存在的包）
    $MCPServers = @(
        "@modelcontextprotocol/server-filesystem",
        "@modelcontextprotocol/server-memory",
        "@modelcontextprotocol/server-sequential-thinking"
    )
    
    $i = 1
    foreach ($mcp in $MCPServers) {
        $mcpName = $mcp -replace "@modelcontextprotocol/server-", ""
        Write-Info "  [$i/$($MCPServers.Count)] 安装 $mcpName..."
        
        try {
            npm install -g $mcp --registry=https://registry.npmmirror.com 2>&1 | Tee-Object -FilePath $InstallLog
        } catch {
            Write-Warning "$mcpName 安装失败，跳过"
        }
        
        $i++
    }
    
    # 创建 MCP 配置文件
    New-MCPConfig
    
    Write-Success "MCP 服务器安装完成"
}

# 创建 MCP 配置文件
function New-MCPConfig {
    Write-Info "创建 MCP 配置文件..."
    
    # Windows 路径格式
    $filesystemPath = "C:\\ClaudeWorkspace"
    $sqlitePath = "$env:USERPROFILE\\.claude\\data.db" -replace "\\", "\\"
    
    $config = @{
        mcpServers = @{
            filesystem = @{
                command = "npx"
                args = @("-y", "@modelcontextprotocol/server-filesystem", $filesystemPath)
            }
            memory = @{
                command = "npx"
                args = @("-y", "@modelcontextprotocol/server-memory")
            }
            "sequential-thinking" = @{
                command = "npx"
                args = @("-y", "@modelcontextprotocol/server-sequential-thinking")
            }
        }
    }
    
    $config | ConvertTo-Json -Depth 10 | Set-Content -Path $McpConfig -Encoding UTF8
    
    Write-Success "MCP 配置文件创建完成: $McpConfig"
    
    # 创建工作目录
    New-Item -ItemType Directory -Force -Path "C:\ClaudeWorkspace" | Out-Null
}

# 安装 CC Switch CLI
function Install-CCSwitchCLI {
    Write-Info "安装 CC Switch CLI..."
    
    $archSuffix = "windows-x64"
    $downloadUrl = "https://github.com/SaladDay/cc-switch-cli/releases/download/v4.8.0/cc-switch-cli-${archSuffix}.zip"
    $tempFile = "$env:TEMP\cc-switch-cli.zip"
    $installDir = "$env:ProgramFiles\CC-Switch-CLI"
    
    Write-Info "下载 CC Switch CLI..."
    
    try {
        # 下载文件
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
        
        # 创建安装目录
        New-Item -ItemType Directory -Force -Path $installDir | Out-Null
        
        # 解压文件
        Expand-Archive -Path $tempFile -DestinationPath $installDir -Force
        
        # 添加到 PATH
        $env:Path += ";$installDir"
        [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
        
        # 清理临时文件
        Remove-Item $tempFile -Force
        
        Write-Success "CC Switch CLI 安装完成"
    } catch {
        Write-Warning "CC Switch CLI 安装失败: $_"
    }
}

# 安装 Skills
function Install-Skills {
    Write-Info "安装常用 Skills..."
    
    $skills = @("find-skills", "skill-creator", "brave-search", "web-search")
    
    foreach ($skill in $skills) {
        Write-Info "  尝试安装 $skill..."
        try {
            claude skill install $skill 2>&1 | Tee-Object -FilePath $InstallLog
        } catch {
            Write-Warning "$skill 安装失败，可能需要手动安装"
        }
    }
    
    Write-Success "Skills 安装完成"
}

# 创建桌面文档
function New-DesktopDocs {
    $desktopDir = "$env:USERPROFILE\Desktop\ClaudeCode"
    New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null
    
    # README
    $readme = @"
# Claude Code 安装完成！

## ✅ 已安装组件

1. **Claude Code CLI** - AI 编程助手
2. **MCP 服务器**（3个）
   - filesystem - 文件操作
   - memory - 对话记忆
   - sequential-thinking - 结构化思考
3. **CC Switch CLI** - Provider 切换工具
4. **Skills** - 扩展技能

## 🚀 快速开始

``````powershell
# 1. 登录配置
claude login

# 2. 开始对话
claude chat

# 3. （可选）使用 CC Switch CLI 管理配置
cc-switch --help
``````

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

## 📂 文件位置

- 配置文件: `~\.claude\config.json`
- MCP 配置: `~\.claude\mcp_settings.json`
- 工作目录: `C:\ClaudeWorkspace\`

---

**安装时间:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**作者:** 小A - OpenClaw AI Assistant
"@
    
    $readme | Set-Content -Path "$desktopDir\README.md" -Encoding UTF8
    
    Write-Success "桌面文档创建完成: $desktopDir"
}

# 验证安装
function Test-Installation {
    Write-Info "验证安装..."
    
    $errors = 0
    
    # 检查 Claude Code
    if (Test-Command claude) {
        $version = claude --version 2>&1
        Write-Success "✓ Claude Code: $version"
    } else {
        Write-Error "✗ Claude Code 未安装"
        $errors++
    }
    
    # 检查 MCP 配置
    if (Test-Path $McpConfig) {
        $mcpCount = (Get-Content $McpConfig | ConvertFrom-Json).mcpServers.PSObject.Properties.Count
        Write-Success "✓ MCP 配置: $mcpCount 个服务器"
    } else {
        Write-Error "✗ MCP 配置文件不存在"
        $errors++
    }
    
    # 检查 CC Switch CLI
    if (Test-Command cc-switch) {
        $version = cc-switch --version 2>&1
        Write-Success "✓ CC Switch CLI: $version"
    } else {
        Write-Warning "⚠ CC Switch CLI 未安装（可选）"
    }
    
    # 检查 Node.js
    if (Test-Command node) {
        Write-Success "✓ Node.js: $(node -v)"
    } else {
        Write-Error "✗ Node.js 未安装"
        $errors++
    }
    
    if ($errors -eq 0) {
        Write-Success "所有核心组件安装成功！"
    } else {
        Write-Error "发现 $errors 个错误，请检查安装日志: $InstallLog"
    }
    
    return $errors
}

# 显示使用说明
function Show-Usage {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  安装完成！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "已安装的 MCP 服务器（3个）：" -ForegroundColor Yellow
    Write-Host "  1. filesystem      - 文件操作（读写、移动、创建）"
    Write-Host "  2. memory          - 对话记忆、上下文保存"
    Write-Host "  3. sequential-thinking - 结构化思考（推理、分析）"
    Write-Host ""
    Write-Host "已安装的工具：" -ForegroundColor Yellow
    Write-Host "  • Claude Code CLI - AI 编程助手"
    Write-Host "  • CC Switch CLI - Provider 切换工具"
    Write-Host "  • Skills - 扩展技能（find-skills, skill-creator等）"
    Write-Host ""
    Write-Host "桌面文档：" -ForegroundColor Yellow
    Write-Host "  📁 ~/Desktop/ClaudeCode/README.md"
    Write-Host ""
    Write-Host "下一步：" -ForegroundColor Yellow
    Write-Host "  1. 打开新的 PowerShell 窗口（刷新环境变量）"
    Write-Host "  2. 运行: claude login"
    Write-Host "  3. 配置 API（推荐阿里云百炼）"
    Write-Host "  4. 运行: claude chat 开始对话"
    Write-Host ""
    Write-Host "推荐 API 配置：" -ForegroundColor Yellow
    Write-Host "  - Base URL: https://coding.dashscope.aliyuncs.com/api/anthropic"
    Write-Host "  - API Key: https://dashscope.console.aliyun.com/"
    Write-Host ""
}

# 主安装流程
function Main {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Claude Code 全能一键安装脚本 v2.0" -ForegroundColor Cyan
    Write-Host "  支持 Windows 10/11 (PowerShell)" -ForegroundColor Cyan
    Write-Host "  集成 MCP + Skills + CC Switch CLI" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # 初始化日志
    "安装日志 - $(Get-Date)" | Set-Content -Path $InstallLog
    
    # 检测系统
    Detect-System
    
    # 安装 Chocolatey
    Install-Chocolatey
    
    # 安装依赖
    Install-NodeJS
    Install-Git
    Configure-NPM-Mirror
    
    # 安装 Claude Code
    Install-ClaudeCode
    
    # 安装 MCP 服务器
    Install-MCPServers
    
    # 安装 CC Switch CLI
    Install-CCSwitchCLI
    
    # 安装 Skills
    Install-Skills
    
    # 创建桌面文档
    New-DesktopDocs
    
    # 验证安装
    $errors = Test-Installation
    
    # 显示使用说明
    if ($errors -eq 0) {
        Show-Usage
    }
}

# 运行主程序
Main
