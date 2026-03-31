import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 Python 版本及多版本冲突 */
const scanner: Scanner = {
  id: 'python-versions',
  name: 'Python 版本检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const found: { command: string; version: string; path: string }[] = [];

    for (const cmd of ['python', 'python3']) {
      const ver = runCommand(`${cmd} --version`, 5000);
      if (ver.exitCode === 0) {
        const vMatch = ver.stdout.match(/Python (\d+\.\d+\.\d+)/);
        const where = runCommand(`where.exe ${cmd}`, 3000);
        const path = where.stdout.split('\n')[0].trim();
        found.push({
          command: cmd,
          version: vMatch?.[1] || 'unknown',
          path,
        });
      }
    }

    if (found.length === 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Python 未安装',
      };
    }

    // 检查多版本冲突
    if (found.length > 1) {
      const versions = found.map(f => `${f.command} = ${f.version} (${f.path})`);
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `检测到多个 Python 版本，可能存在冲突`,
        detail: versions.join('\n'),
      };
    }

    // 检查版本是否过旧
    const ver = found[0].version;
    const [major, minor] = ver.split('.').map(Number);
    if (major < 3 || (major === 3 && minor < 8)) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Python 版本过旧 (${ver})，建议 3.8+`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `Python 正常 (${ver})`,
    };
  },
};

registerScanner(scanner);
