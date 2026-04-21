import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 NVIDIA GPU 驱动版本 */
const scanner: Scanner = {
  id: 'gpu-driver',
  name: 'GPU 驱动检测',
  category: 'gpu',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand(
      'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader',
      10000,
    );

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '未检测到可用的 NVIDIA GPU 信息',
      };
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    const gpus = lines.map(line => {
      const [name, driver] = line.split(',').map(s => s.trim());
      return { name, driver };
    });

    // 检查驱动版本（建议 >= 525）
    let driverOk = true;
    for (const gpu of gpus) {
      const majorVer = parseInt(gpu.driver.split('.')[0], 10);
      if (majorVer < 525) driverOk = false;
    }

    const detail = gpus.map(g => `${g.name} (驱动 ${g.driver})`).join('\n');

    if (!driverOk) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'warn',
        message: 'NVIDIA 驱动版本较旧，建议更新到 525+',
        detail,
        error_type: 'outdated',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'pass',
      message: `NVIDIA GPU 正常 (${gpus.length} 张)`,
      detail,
    };
  },
};

registerScanner(scanner);
