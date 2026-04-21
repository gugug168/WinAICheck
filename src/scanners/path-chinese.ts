import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检查用户路径是否含非 ASCII 字符（中文路径） */
const scanner: Scanner = {
  id: 'path-chinese',
  name: '用户路径中文检测',
  category: 'path',

  async scan(): Promise<ScanResult> {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const hasNonAscii = /[^\x00-\x7F]/.test(home);

    if (hasNonAscii) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'misconfigured',
        message: '用户目录包含非 ASCII 字符（中文路径），可能导致部分 AI 工具异常',
        detail: `路径: ${home}`,
      };
    }
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '用户目录路径正常（纯 ASCII）',
    };
  },
};

registerScanner(scanner);
