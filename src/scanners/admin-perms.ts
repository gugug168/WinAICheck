import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测管理员权限 */
const scanner: Scanner = {
  id: 'admin-perms',
  name: '管理员权限检测',
  category: 'permission',

  async scan(): Promise<ScanResult> {
    const { exitCode } = runCommand('net session', 5000);

    if (exitCode === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: '当前以管理员权限运行',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: '当前非管理员权限，部分修复操作需要提升权限',
      detail: '建议以管理员身份运行本工具以获得完整修复能力',
    };
  },
};

registerScanner(scanner);
