import type { ScanResult, Scanner } from './types';
import { registerScanner } from './registry';
import { runCommand } from '../executor/index';

function getRoot(pathValue: string): string {
  const normalized = pathValue.trim().toLowerCase();
  const markers = ['\\nvm\\', '\\fnm\\', '\\program files\\nodejs\\', '\\volta\\', '\\scoop\\apps\\nodejs\\'];
  const marker = markers.find(item => normalized.includes(item));
  if (!marker) return normalized;
  return normalized.slice(0, normalized.indexOf(marker) + marker.length);
}

const scanner: Scanner = {
  id: 'node-manager-conflict',
  name: 'Node 版本管理冲突检测',
  category: 'toolchain',

  async scan(): Promise<ScanResult> {
    const whereNode = runCommand('where.exe node', 5000);
    if (whereNode.exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '未检测到 Node，可跳过版本管理冲突检查',
      };
    }

    const locations = whereNode.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const roots = new Set(locations.map(getRoot));
    const managerHints = [process.env.NVM_HOME, process.env.FNM_DIR, process.env.VOLTA_HOME].filter(Boolean);

    if (roots.size > 1 || managerHints.length > 1) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'conflict',
        message: '检测到多个 Node 管理链路，可能导致命令漂移',
        detail: `node 路径:\n${locations.join('\n')}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: 'Node 版本管理链路单一',
      detail: locations.join('\n'),
    };
  },
};

registerScanner(scanner);
