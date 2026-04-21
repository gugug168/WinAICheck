import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 Node.js 版本 */
const scanner: Scanner = {
  id: 'node-version',
  name: 'Node.js 版本检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand('node --version', 5000);
    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        message: 'Node.js 未安装',
        error_type: 'missing',
      };
    }

    const version = stdout.replace('v', '');
    const [major] = version.split('.').map(Number);

    if (major < 18) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `Node.js 版本过旧 (v${version})，建议 v18+`,
        error_type: 'outdated',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `Node.js 正常 (v${version})`,
    };
  },
};

registerScanner(scanner);
