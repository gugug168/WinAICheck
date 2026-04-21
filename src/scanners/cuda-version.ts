import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测 CUDA 版本 */
const scanner: Scanner = {
  id: 'cuda-version',
  name: 'CUDA 版本检测',
  category: 'gpu',
  affectsScore: false,

  async scan(): Promise<ScanResult> {
    // 方法1: nvcc
    const nvcc = runCommand('nvcc --version', 5000);
    if (nvcc.exitCode === 0) {
      const verMatch = nvcc.stdout.match(/release\s+(\d+\.\d+)/);
      const cudaVer = verMatch?.[1] || 'unknown';

      // 检查与驱动兼容性
      const driver = runCommand(
        'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
        5000,
      );
      let detail = `CUDA ${cudaVer}`;
      if (driver.exitCode === 0) {
        detail += ` | 驱动 ${driver.stdout.trim()}`;
      }

      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: `CUDA 已安装 (${cudaVer})`,
        detail,
      };
    }

    // 方法2: nvidia-smi 显示的 CUDA 版本
    const smi = runCommand('nvidia-smi', 5000);
    if (smi.exitCode === 0) {
      const cudaMatch = smi.stdout.match(/CUDA Version:\s*(\d+\.\d+)/);
      if (cudaMatch) {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          status: 'warn',
          message: `驱动支持 CUDA ${cudaMatch[1]}，但 CUDA Toolkit 未安装`,
          detail: 'nvcc 不可用，建议安装 CUDA Toolkit',
          error_type: 'outdated',
        };
      }
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'unknown',
      message: '未检测到本地 CUDA Toolkit',
      detail: '如需本地 NVIDIA GPU 加速，可安装 CUDA Toolkit；纯 CPU 或远程 GPU 场景可忽略。',
    };
  },
};

registerScanner(scanner);
