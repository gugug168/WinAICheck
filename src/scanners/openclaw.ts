import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 OpenClaw（开源 Claude Code 替代品）
 * 通过 npm 安装，使用 OpenRouter 等兼容 API
 */
const scanner: Scanner = {
  id: 'openclaw',
  name: 'OpenClaw 检测',
  category: 'toolchain',
  affectsScore: false,
  defaultEnabled: false,

  async scan(): Promise<ScanResult> {
    if (!commandExists('openclaw')) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'OpenClaw 未安装（可选）',
        detail: 'OpenClaw 是开源的 Claude Code 替代品，支持 OpenRouter/兼容 API。\n\n安装方法:\n  npm install -g openclaw\n  国内镜像: npm install -g openclaw --registry https://registry.npmmirror.com\n\n使用: openclaw\n需要配置 API Key（支持多种提供商）',
      };
    }

    const { stdout, exitCode } = runCommand('openclaw --version', 8000);
    if (exitCode === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `OpenClaw 已安装 (${stdout.trim()})`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'OpenClaw 已安装',
    };
  },
};

registerScanner(scanner);
