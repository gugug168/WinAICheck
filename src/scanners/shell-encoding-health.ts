import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { runCommand } from '../executor/index';

const scanner: Scanner = {
  id: 'shell-encoding-health',
  name: '终端编码兼容检测',
  category: 'permission',

  async scan(): Promise<ScanResult> {
    const chcp = runCommand('chcp', 5000);
    if (chcp.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法读取当前终端代码页',
      };
    }

    const codePage = chcp.stdout.match(/:\s*(\d+)/)?.[1] || chcp.stdout.match(/(\d{3,5})/)?.[1] || 'unknown';
    if (codePage !== '65001') {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `当前终端代码页为 ${codePage}，可能出现中文或 JSON 输出乱码`,
        detail: '建议使用 chcp 65001、PowerShell 7 或 Windows Terminal UTF-8 配置。',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '终端编码为 UTF-8',
    };
  },
};

registerScanner(scanner);
