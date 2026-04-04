import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 uv 包管理器（Python MCP 服务器必需）
 * Claude Code 和 OpenClaw 都依赖 uv 运行 Python MCP 服务器
 */
const scanner: Scanner = {
  id: 'uv-package-manager',
  name: 'uv 包管理器检测',
  category: 'toolchain',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    if (!commandExists('uv')) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'uv 未安装，Claude Code 的 Python MCP 服务器将无法运行',
        detail: 'uv 是高性能 Python 包管理器，Claude Code/OpenClaw 依赖它运行 Python MCP 服务器。\n\n安装方法:\n  PowerShell: irm https://astral.sh/uv/install.ps1 | iex\n  pip: pip install uv\n  winget: winget install astral-sh.uv\n  国内加速: pip install uv -i https://pypi.tuna.tsinghua.edu.cn/simple',
      };
    }

    const { stdout } = runCommand('uv --version', 5000);
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `uv 已安装 (${stdout.trim()})`,
    };
  },
};

registerScanner(scanner);
