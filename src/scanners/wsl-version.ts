import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 WSL 版本 */
const scanner: Scanner = {
  id: 'wsl-version',
  name: 'WSL 版本检测',
  category: 'gpu',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand('wsl --status', 8000);

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'WSL 未安装或未初始化',
        detail: '建议安装 WSL2: wsl --install',
      };
    }

    const isWsl2 = /默认版本:\s*2|default version:\s*2/i.test(stdout);
    const hasDistro = stdout.includes('默认分发') || stdout.includes('default distribution');

    if (isWsl2) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: 'WSL2 已安装并配置正确',
        detail: stdout.split('\n').slice(0, 5).join('\n'),
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: 'WSL 已安装但可能使用 WSL1，建议升级到 WSL2',
      detail: stdout.split('\n').slice(0, 5).join('\n'),
    };
  },
};

registerScanner(scanner);
