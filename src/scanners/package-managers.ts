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

    for (const m of managers) {
      const { stdout, exitCode } = runCommand(m.cmd, 5000);
      if (exitCode === 0) {
        found.push(`${m.name}: ${stdout.split('\n')[0]}`);
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
        message: '未检测到任何包管理器',
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
