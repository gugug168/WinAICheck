import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测包管理器（pip, npm, bun） */
const scanner: Scanner = {
  id: 'package-managers',
  name: '包管理器检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const managers: { cmd: string; name: string }[] = [
      { cmd: 'pip --version', name: 'pip' },
      { cmd: 'npm --version', name: 'npm' },
      { cmd: 'bun --version', name: 'bun' },
      { cmd: 'pnpm --version', name: 'pnpm' },
      { cmd: 'yarn --version', name: 'yarn' },
    ];

    const found: string[] = [];
    const missing: string[] = [];
    const foundNames = new Set<string>();

    for (const m of managers) {
      const { stdout, exitCode } = runCommand(m.cmd, 5000);
      if (exitCode === 0) {
        found.push(`${m.name}: ${stdout.split('\n')[0]}`);
        foundNames.add(m.name);
      } else {
        missing.push(m.name);
      }
    }

    if (found.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'missing',
        message: '未检测到任何包管理器',
      };
    }

    const hasPython = foundNames.has('pip');
    const hasNode = foundNames.has('npm');

    if (!hasPython || !hasNode) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: `核心包管理器不完整（${!hasPython ? '缺少 pip' : ''}${!hasPython && !hasNode ? '，' : ''}${!hasNode ? '缺少 npm' : ''}）`,
        detail: `已安装: ${found.join(', ')}${missing.length > 0 ? `\n未安装: ${missing.join(', ')}` : ''}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `已安装: ${found.join(', ')}`,
      detail: missing.length > 0 ? `未安装: ${missing.join(', ')}` : undefined,
    };
  },
};

registerScanner(scanner);
