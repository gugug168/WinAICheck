import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { commandExists, runCommand } from '../executor/index';

const scanner: Scanner = {
  id: 'node-global-bin-path',
  name: 'Node 全局命令路径检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const prefix = runCommand('npm config get prefix', 8000);
    if (prefix.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'fail',
        error_type: 'misconfigured',
        message: '无法获取 npm 全局安装路径',
      };
    }

    const globalPrefix = prefix.stdout.split(/\r?\n/)[0].trim();
    const pathEnv = (process.env.PATH || '').toLowerCase();
    const inPath = pathEnv.includes(globalPrefix.toLowerCase());
    const hasNpx = commandExists('npx');

    if (!inPath || !hasNpx) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: 'Node 全局 CLI 环境不完整',
        detail: `npm prefix: ${globalPrefix}\n在 PATH 中: ${inPath ? '是' : '否'}\nnpx 可用: ${hasNpx ? '是' : '否'}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Node 全局 CLI 环境正常',
      detail: `npm prefix: ${globalPrefix}`,
    };
  },
};

registerScanner(scanner);
