import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 Claude Code CLI
 * Anthropic 官方命令行工具，通过 npm 安装
 */
const scanner: Scanner = {
  id: 'claude-cli',
  name: 'Claude Code CLI 检测',
  category: 'toolchain',
  affectsScore: false,
  defaultEnabled: false,

  async scan(): Promise<ScanResult> {
    if (!commandExists('claude')) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'missing',
        message: 'Claude Code CLI 未安装',
        detail: 'Claude Code 是 Anthropic 官方命令行 AI 编程助手。\n\n安装方法:\n  npm install -g @anthropic-ai/claude-code\n  国内镜像: npm install -g @anthropic-ai/claude-code --registry https://registry.npmmirror.com\n\n使用: claude\n首次运行需要登录 Anthropic 账号或配置 API Key',
      };
    }

    const { stdout, exitCode } = runCommand('claude --version', 8000);
    if (exitCode === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `Claude Code 已安装 (${stdout.trim()})`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Claude Code 已安装',
    };
  },
};

registerScanner(scanner);
