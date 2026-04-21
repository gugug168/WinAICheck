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
        error_type: 'misconfigured',
        message: '无法查询时间同步状态',
        detail: '可能时间服务未启动',
      };
    }

    const sourceValue = stdout.match(/time\.windows\.com[^\r\n]*|VMIC Provider[^\r\n]*|Free-running System Clock[^\r\n]*|Local CMOS Clock[^\r\n]*/i)?.[0]?.trim() || 'unknown';
    const syncValue = stdout.match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/)?.[0]?.trim() || 'unknown';
    const untrustedSource = /Free-running System Clock|Local CMOS Clock|unknown/i.test(sourceValue);
    const unsynced = syncValue === 'unknown';

    if (untrustedSource || unsynced) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        error_type: 'misconfigured',
        message: '时间同步源可能不可靠',
        detail: `源: ${sourceValue}\n上次同步: ${syncValue}`,
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '系统时间同步正常',
      detail: `源: ${sourceValue}\n上次同步: ${syncValue}`,
    };
  },
};

registerScanner(scanner);
