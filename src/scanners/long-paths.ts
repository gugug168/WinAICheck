import type { Scanner, ScanResult } from './types';
import { runReg } from '../executor/index';
import { registerScanner } from './registry';

/** 检查 Windows 长路径支持是否启用 */
const scanner: Scanner = {
  id: 'long-paths',
  name: '长路径支持检测',
  category: 'path',

  async scan(): Promise<ScanResult> {
    try {
      const output = runReg(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem',
        'LongPathsEnabled',
      );
      const enabled = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(output);

      if (enabled) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'pass',
          message: 'Windows 长路径支持已启用',
        };
      }
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Windows 长路径支持未启用，可能导致 npm/git 长路径问题',
        detail: '注册表 LongPathsEnabled = 0',
      };
    } catch {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法读取注册表长路径设置',
      };
    }
  },
};

registerScanner(scanner);
