import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检查关键工具安装路径是否含空格 */
const scanner: Scanner = {
  id: 'path-spaces',
  name: '安装路径空格检测',
  category: 'path',

  async scan(): Promise<ScanResult> {
    const tools = ['git', 'node', 'python'];
    const problems: string[] = [];
    const safeRoots = [/^C:\\Program Files( \(x86\))?\\/i];

    for (const tool of tools) {
      const { stdout, exitCode } = runCommand(`where.exe ${tool}`, 5000);
      if (exitCode === 0 && stdout) {
        const firstPath = stdout.split('\n')[0].trim();
        const isSafeSpacePath = safeRoots.some(pattern => pattern.test(firstPath));
        if (firstPath.includes(' ') && !isSafeSpacePath) {
          problems.push(`${tool}: ${firstPath}`);
        }
      }
    }

    if (problems.length > 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: `${problems.length} 个工具安装在含空格的路径下`,
        detail: problems.join('\n'),
      };
    }
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '所有工具安装路径无空格问题',
    };
  },
};

registerScanner(scanner);
