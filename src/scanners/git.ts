import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';
import { THRESHOLDS, compareVersions } from './thresholds';

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

    if (version === 'unknown') {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Git 已安装但版本号无法解析 (${stdout})`,
      };
    }

    if (compareVersions(version, THRESHOLDS.git.minVersion) < 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Git 版本过旧 (${version})，建议升级到 ${THRESHOLDS.git.minVersion}+`,
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
