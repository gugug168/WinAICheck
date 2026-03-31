import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测系统时间同步状态 */
const scanner: Scanner = {
  id: 'time-sync',
  name: '时间同步检测',
  category: 'permission',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand('w32tm /query /status', 8000);

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: '无法查询时间同步状态',
        detail: '可能时间服务未启动',
      };
    }

    // 检查上次同步时间
    const lastSync = stdout.match(/Last Successful Sync Time:\s*(.+)/i);
    const source = stdout.match(/Source:\s*(.+)/i);
    const ntpOk = /VMIC Provider|time.windows.com/i.test(stdout);

    if (!ntpOk) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: '时间同步源可能不可靠',
        detail: `源: ${source?.[1] || 'unknown'}\n上次同步: ${lastSync?.[1] || 'unknown'}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '系统时间同步正常',
      detail: `源: ${source?.[1] || 'NTP'}\n上次同步: ${lastSync?.[1] || 'unknown'}`,
    };
  },
};

registerScanner(scanner);
