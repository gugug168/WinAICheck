import type { Scanner, ScanResult } from './types';
import { runCommand, commandExists } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 Git 安装与版本 */
const scanner: Scanner = {
  id: 'git',
  name: 'Git 检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand('git --version', 5000);
    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Git 未安装或不在 PATH 中',
        error_type: 'missing',
      };
    }

    const versionMatch = stdout.match(/git version (\d+\.\d+\.\d+)/);
    const version = versionMatch?.[1] || 'unknown';

    // 检查版本是否过旧（< 2.30）
    const [major, minor] = version.split('.').map(Number);
    if (major < 2 || (major === 2 && minor < 30)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Git 版本过旧 (${version})，建议升级到 2.30+`,
        error_type: 'outdated',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `Git 正常 (${version})`,
    };
  },
};

registerScanner(scanner);
