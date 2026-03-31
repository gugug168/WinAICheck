import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 GPU 显存使用情况 */
const scanner: Scanner = {
  id: 'vram-usage',
  name: '显存使用检测',
  category: 'gpu',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      10000,
    );

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法读取显存信息',
      };
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    let overloaded = false;
    const details: string[] = [];

    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      const used = parseInt(parts[0], 10);
      const total = parseInt(parts[1], 10);
      const pct = Math.round((used / total) * 100);

      details.push(`显存: ${used}/${total} MB (${pct}%)`);
      if (pct > 90) overloaded = true;
    }

    // 查看占用进程
    const proc = runCommand(
      'nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv,noheader',
      5000,
    );
    if (proc.exitCode === 0 && proc.stdout.trim()) {
      details.push('\n占用进程:\n' + proc.stdout);
    }

    if (overloaded) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: '显存使用率 > 90%，可能影响 AI 训练/推理',
        detail: details.join('\n'),
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: '显存使用正常',
      detail: details.join('\n'),
    };
  },
};

registerScanner(scanner);
