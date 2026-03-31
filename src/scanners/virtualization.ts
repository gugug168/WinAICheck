import type { Scanner, ScanResult } from './types';
import { runCommand } from '../executor/index';
import { registerScanner } from './registry';

/** 检测虚拟化支持状态 */
const scanner: Scanner = {
  id: 'virtualization',
  name: '虚拟化支持检测',
  category: 'gpu',

  async scan(): Promise<ScanResult> {
    const { stdout, exitCode } = runCommand(
      'wmic computersystem get HyperVisorPresent /value',
      8000,
    );

    if (exitCode !== 0) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'unknown',
        message: '无法检测虚拟化状态',
      };
    }

    const enabled = /HyperVisorPresent=TRUE/i.test(stdout);

    if (enabled) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        status: 'pass',
        message: 'Hyper-V 虚拟化已启用',
      };
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: 'warn',
      message: '虚拟化未启用，WSL2/Docker 需要 Hyper-V 或 WSL2 后端',
      detail: '请在 BIOS 中启用虚拟化 (Intel VT-x / AMD-V)，并在 Windows 功能中启用 Hyper-V 或 WSL',
    };
  },
};

registerScanner(scanner);
