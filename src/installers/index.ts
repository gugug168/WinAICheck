import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 安装器类型定义
 */
export interface Installer {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 是否需要管理员权限 */
  needsAdmin: boolean;
  /** 执行安装，通过 SSE 推送进度 */
  run(onProgress: (event: InstallEvent) => void): Promise<InstallResult>;
}

export interface InstallEvent {
  type: 'progress' | 'log' | 'done';
  step?: string;
  pct?: number;
  line?: string;
  success?: boolean;
  message?: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
}

// ==================== Claude Code 安装器 ====================

const CLAUDE_CODE_PS1 = `# WinAICheck - Claude Code 一键安装脚本
#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$ClaudeDir = "$env:USERPROFILE\\.claude"
$McpConfig = "$ClaudeDir\\mcp_settings.json"
$InstallLog = "$env:TEMP\\claude-code-install.log"
function Write-Info { param($msg) Write-Host "[INFO] $msg" }
function Write-Success { param($msg) Write-Host "[SUCCESS] $msg" }
function Write-Warning { param($msg) Write-Host "[WARNING] $msg" }
function Write-Error { param($msg) Write-Host "[ERROR] $msg" }
function Test-Command { param($command) $null -ne (Get-Command $command -ErrorAction SilentlyContinue) }

# 1. Chocolatey
if (Test-Command choco) { Write-Success "Chocolatey OK" } else {
  Write-Info "Installing Chocolatey..."
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}

# 2. Node.js
if (Test-Command node) { Write-Success "Node.js $(node -v) OK" } else {
  Write-Info "Installing Node.js v20..."
  choco install nodejs-lts -y --version=20.11.0
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 3. Git
if (Test-Command git) { Write-Success "Git OK" } else {
  Write-Info "Installing Git..."
  choco install git -y
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 4. npm mirror
Write-Info "Configuring npm mirror..."
npm config set registry https://registry.npmmirror.com 2>$null

# 5. Claude Code
Write-Info "Installing Claude Code..."
npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com 2>&1 | Tee-Object -FilePath $InstallLog
if (Test-Command claude) { Write-Success "Claude Code $(claude --version 2>&1) installed" }
else { Write-Error "Claude Code install FAILED"; exit 1 }

# 6. MCP Servers
Write-Info "Installing MCP servers..."
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
$MCPServers = @("@modelcontextprotocol/server-filesystem","@modelcontextprotocol/server-memory","@modelcontextprotocol/server-sequential-thinking")
foreach ($mcp in $MCPServers) {
  $name = $mcp -replace "@modelcontextprotocol/server-",""
  Write-Info "  Installing $name..."
  try { npm install -g $mcp --registry=https://registry.npmmirror.com 2>&1 | Tee-Object -FilePath $InstallLog }
  catch { Write-Warning "$name failed, skipping" }
}
# MCP config
$cfg = @{mcpServers=@{filesystem=@{command="npx";args=@("-y","@modelcontextprotocol/server-filesystem","C:\\\\ClaudeWorkspace")};memory=@{command="npx";args=@("-y","@modelcontextprotocol/server-memory")};"sequential-thinking"=@{command="npx";args=@("-y","@modelcontextprotocol/server-sequential-thinking")}}}
$cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $McpConfig -Encoding UTF8
New-Item -ItemType Directory -Force -Path "C:\\ClaudeWorkspace" | Out-Null
Write-Success "MCP servers done"

# 7. CC Switch CLI
Write-Info "Installing CC Switch CLI..."
$ccUrl = "https://ghfast.top/https://github.com/SaladDay/cc-switch-cli/releases/download/v4.8.0/cc-switch-cli-windows-x64.zip"
$tmpZip = "$env:TEMP\\cc-switch-cli.zip"
$ccDir = "$env:ProgramFiles\\CC-Switch-CLI"
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-WebRequest -Uri $ccUrl -OutFile $tmpZip -UseBasicParsing
  New-Item -ItemType Directory -Force -Path $ccDir | Out-Null
  Expand-Archive -Path $tmpZip -DestinationPath $ccDir -Force
  $env:Path += ";$ccDir"
  [Environment]::SetEnvironmentVariable("Path",$env:Path,"User")
  Remove-Item $tmpZip -Force
  Write-Success "CC Switch CLI done"
} catch { Write-Warning "CC Switch CLI failed: $_" }

# 8. Desktop docs
$desktopDir = "$env:USERPROFILE\\Desktop\\ClaudeCode"
New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null
"# Claude Code installed!\\nRun: claude login\\nThen: claude chat" | Set-Content "$desktopDir\\README.md" -Encoding UTF8

Write-Success "ALL DONE"
`;

const claudeCodeInstaller: Installer = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Claude Code CLI + MCP 服务器 + CC Switch，包含 Node.js/Git 环境安装',
  icon: '🤖',
  needsAdmin: true,

  async run(onProgress): Promise<InstallResult> {
    // 写 PS1 到临时文件
    const tmpDir = join(process.env.TEMP || '/tmp', 'winacheck-install');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const ps1Path = join(tmpDir, 'install-claude-code.ps1');
    writeFileSync(ps1Path, CLAUDE_CODE_PS1, 'utf-8');

    return new Promise((resolve) => {
      const proc = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let lastStep = '启动中';

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.includes('[SUCCESS]')) lastStep = trimmed.replace('[SUCCESS] ', '');
          else if (trimmed.includes('[INFO]')) lastStep = trimmed.replace('[INFO] ', '');
          onProgress({ type: 'log', line: trimmed });
          onProgress({ type: 'progress', step: lastStep, pct: 50 });
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress({ type: 'log', line: `[stderr] ${trimmed}` });
        }
      });

      proc.on('close', (code) => {
        const success = code === 0;
        onProgress({
          type: 'done',
          success,
          message: success ? 'Claude Code 安装完成！请重启终端后使用。' : `安装失败 (退出码 ${code})，请查看日志`,
        });
        resolve({ success, message: success ? '安装完成' : `安装失败 (${code})` });
      });

      proc.on('error', (err) => {
        onProgress({ type: 'done', success: false, message: `启动失败: ${err.message}` });
        resolve({ success: false, message: err.message });
      });
    });
  },
};

// ==================== OpenClaw 安装器 ====================

const openclawInstaller: Installer = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: '开源 Claude Code 替代品，支持 OpenRouter 等兼容 API',
  icon: '🦀',
  needsAdmin: false,

  async run(onProgress): Promise<InstallResult> {
    return new Promise((resolve) => {
      onProgress({ type: 'progress', step: '正在通过 npmmirror 安装 OpenClaw...', pct: 30 });
      onProgress({ type: 'log', line: '$ npm install -g openclaw --registry=https://registry.npmmirror.com' });

      const proc = spawn('npm', [
        'install', '-g', 'openclaw', '--registry=https://registry.npmmirror.com',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress({ type: 'log', line: trimmed });
        }
        onProgress({ type: 'progress', step: '安装 OpenClaw 中...', pct: 60 });
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('npm warn')) {
            onProgress({ type: 'log', line: trimmed });
          }
        }
      });

      proc.on('close', (code) => {
        const success = code === 0;
        onProgress({ type: 'done', success, message: success ? 'OpenClaw 安装完成！运行 openclaw 命令启动。' : '安装失败' });
        resolve({ success, message: success ? '安装完成' : `安装失败 (${code})` });
      });

      proc.on('error', (err) => {
        onProgress({ type: 'done', success: false, message: `启动失败: ${err.message}` });
        resolve({ success: false, message: err.message });
      });
    });
  },
};

// ==================== CCSwitch 安装器 ====================

const CCSWITCH_PS1 = `# WinAICheck - CC Switch CLI 安装脚本
$ErrorActionPreference = "Continue"
Write-Host "[INFO] Downloading CC Switch CLI via ghfast.top mirror..."
$ccUrl = "https://ghfast.top/https://github.com/SaladDay/cc-switch-cli/releases/download/v4.8.0/cc-switch-cli-windows-x64.zip"
$tmpZip = "$env:TEMP\\cc-switch-cli.zip"
$ccDir = "$env:ProgramFiles\\CC-Switch-CLI"
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-WebRequest -Uri $ccUrl -OutFile $tmpZip -UseBasicParsing
  Write-Host "[INFO] Download complete, extracting..."
  New-Item -ItemType Directory -Force -Path $ccDir | Out-Null
  Expand-Archive -Path $tmpZip -DestinationPath $ccDir -Force
  $env:Path += ";$ccDir"
  [Environment]::SetEnvironmentVariable("Path",$env:Path,"User")
  Remove-Item $tmpZip -Force
  Write-Host "[SUCCESS] CC Switch CLI installed to $ccDir"
} catch {
  Write-Host "[ERROR] Failed: $_"
  exit 1
}`;

const ccswitchInstaller: Installer = {
  id: 'ccswitch',
  name: 'CCSwitch',
  description: 'Claude Code 多账号/API Key 切换工具（ghfast.top 镜像加速）',
  icon: '🔄',
  needsAdmin: true,

  async run(onProgress): Promise<InstallResult> {
    const tmpDir = join(process.env.TEMP || '/tmp', 'winacheck-install');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const ps1Path = join(tmpDir, 'install-ccswitch.ps1');
    writeFileSync(ps1Path, CCSWITCH_PS1, 'utf-8');

    return new Promise((resolve) => {
      onProgress({ type: 'progress', step: '正在通过 ghfast.top 镜像下载 CCSwitch...', pct: 20 });
      onProgress({ type: 'log', line: '下载源: ghfast.top (GitHub 国内加速)' });

      const proc = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          onProgress({ type: 'log', line: trimmed });
          if (trimmed.includes('extracting')) onProgress({ type: 'progress', step: '解压中...', pct: 60 });
          if (trimmed.includes('[SUCCESS]')) onProgress({ type: 'progress', step: '完成', pct: 90 });
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress({ type: 'log', line: `[stderr] ${trimmed}` });
        }
      });

      proc.on('close', (code) => {
        const success = code === 0;
        onProgress({ type: 'done', success, message: success ? 'CCSwitch 安装完成！' : '安装失败，请检查网络连接' });
        resolve({ success, message: success ? '安装完成' : `安装失败 (${code})` });
      });

      proc.on('error', (err) => {
        onProgress({ type: 'done', success: false, message: `启动失败: ${err.message}` });
        resolve({ success: false, message: err.message });
      });
    });
  },
};

// ==================== 注册表 ====================

const ALL_INSTALLERS: Installer[] = [claudeCodeInstaller, openclawInstaller, ccswitchInstaller];

export function getInstallers(): Installer[] {
  return [...ALL_INSTALLERS];
}

export function getInstallerById(id: string): Installer | undefined {
  return ALL_INSTALLERS.find(i => i.id === id);
}
