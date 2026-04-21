import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测常用 Unix 命令可用性（ls, grep, curl） */
const scanner: Scanner = {
  id: 'unix-commands',
  name: 'Unix 命令检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const commands = ['ls', 'grep', 'curl', 'ssh', 'tar'];
    const missing: string[] = [];
    const available: string[] = [];

    for (const cmd of commands) {
      const { exitCode } = runCommand(`where.exe ${cmd}`, 3000);
      if (exitCode === 0) {
        available.push(cmd);
      } else {
        missing.push(cmd);
      }
    }

    if (missing.length === commands.length) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'missing',
        message: '所有常用 Unix 命令均不可用',
      };
    }
    if (missing.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'missing',
        message: `缺少命令: ${missing.join(', ')}`,
        detail: `可用: ${available.join(', ')}`,
      };
    }
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `所有 Unix 命令可用 (${available.join(', ')})`,
    };
  },
};

registerScanner(scanner);
