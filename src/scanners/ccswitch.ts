import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/**
 * 检测 CCSwitch（Claude Code 多账号切换工具）
 * 用于在多个 Anthropic 账号/API Key 之间快速切换
 */
const scanner: Scanner = {
  id: 'ccswitch',
  name: 'CCSwitch 检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    if (!commandExists('ccswitch')) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'CCSwitch 未安装（可选，多账号管理工具）',
        detail: 'CCSwitch 是 Claude Code 多账号/API Key 切换工具。\n\n安装方法:\n  npm install -g ccswitch\n  国内镜像: npm install -g ccswitch --registry https://registry.npmmirror.com\n\n使用: ccswitch\n支持在多个 Anthropic 账号之间快速切换',
      };
    }

    const { stdout, exitCode } = runCommand('ccswitch --version', 8000);
    if (exitCode === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `CCSwitch 已安装 (${stdout.trim()})`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'CCSwitch 已安装',
    };
  },
};

registerScanner(scanner);
